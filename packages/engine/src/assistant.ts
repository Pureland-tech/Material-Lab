/**
 * Text-to-recipe support (PRD FR-080–FR-084).
 *
 * A suggestion is always an ordinary, validated, editable recipe — never an
 * opaque image. Two sources produce the same `TextureSpec` shape:
 *
 * - an AI model constrained by `textureSpecSchema()` (run by a server; this
 *   module makes no network calls), and
 * - `suggestLocally()`, a deterministic keyword matcher over the presets that
 *   works offline and is the fallback whenever AI is unavailable or declined.
 */
import { hexToRgb, luma, normalizeHex } from './color';
import { getLayerDefinition, LAYER_DEFINITIONS, LAYER_TYPE_ORDER } from './layers';
import { applyPalette, BUILT_IN_PALETTES } from './palette';
import type { NumberParamDef, ParamDef } from './params';
import { instantiatePreset, PRESETS, type Preset } from './presets';
import { createLayer, createRecipe, inferFamily } from './recipe';
import { randomSeed } from './random';
import { analyzeSeamless, fixSeamlessSeams, setSeamless } from './seamless';
import { BLEND_MODES, type BlendMode, type LayerType, type ParamValue, type Recipe } from './types';
import { validateRecipe, RECIPE_LIMITS } from './validate';
import { formatParamValue } from './variations';

export const SUGGESTION_LIMITS = { minPromptLength: 3, maxPromptLength: 300 } as const;

export interface TextureSpecLayer {
  type: LayerType;
  name: string;
  opacity: number;
  blendMode: BlendMode;
  parameters: Record<string, ParamValue>;
}

/** What a suggestion source returns: a layer stack, bottom layer first. */
export interface TextureSpec {
  name: string;
  /** One or two sentences on the choices made. */
  explanation: string;
  transparentBackground: boolean;
  seamless: boolean;
  layers: TextureSpecLayer[];
}

export interface SuggestionChoice {
  layerId: string;
  layerName: string;
  param: string;
  label: string;
  /** Display values, using the parameter's unit. */
  value: string;
  defaultValue: string;
}

export interface RecipeSuggestion {
  recipe: Recipe;
  source: 'ai' | 'local';
  summary: string;
  notes: string[];
  /** Parameters set away from their defaults, so the user can review them (FR-082). */
  choices: SuggestionChoice[];
}

type JsonSchema = Record<string, unknown>;

function paramSchema(p: ParamDef): JsonSchema {
  const help = p.help ? ` ${p.help}` : '';
  switch (p.kind) {
    case 'number': {
      const range = p.unit === '%' ? `${p.min}–${p.max} (a fraction; shown as %)` : `${p.min}–${p.max}${p.unit ?? ''}`;
      return { type: 'number', description: `${p.label}. Range ${range}; default ${p.default}.${help}` };
    }
    case 'color':
      return { type: 'string', description: `${p.label}. Hex color #RRGGBB; default ${p.default}.${help}` };
    case 'boolean':
      return { type: 'boolean', description: `${p.label}. Default ${p.default}.${help}` };
    case 'select':
      return {
        type: 'string',
        enum: p.options.map((o) => o.value),
        description: `${p.label}: ${p.options.map((o) => `${o.value} (${o.label})`).join(', ')}; default ${p.default}.${help}`,
      };
  }
}

/**
 * JSON schema for a TextureSpec, generated from the layer definitions so it
 * always matches this engine. Uses only constructs that structured-output
 * APIs support (no numeric ranges: they are in descriptions, and values are
 * clamped on validation).
 */
export function textureSpecSchema(): JsonSchema {
  const layerVariants = LAYER_TYPE_ORDER.map((type) => {
    const def = LAYER_DEFINITIONS[type];
    const properties: Record<string, JsonSchema> = {};
    for (const p of def.params) properties[p.id] = paramSchema(p);
    return {
      type: 'object',
      description: `${def.label} layer: ${def.description} Default blend ${def.defaultBlendMode}.`,
      properties: {
        type: { type: 'string', const: type },
        name: { type: 'string', description: 'Short layer name shown in the layer list.' },
        opacity: { type: 'number', description: 'Layer opacity 0–1.' },
        blendMode: { type: 'string', enum: [...BLEND_MODES] },
        parameters: { type: 'object', properties, required: def.params.map((p) => p.id), additionalProperties: false },
      },
      required: ['type', 'name', 'opacity', 'blendMode', 'parameters'],
      additionalProperties: false,
    };
  });
  return {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Recipe name, at most 60 characters.' },
      explanation: { type: 'string', description: 'One or two plain sentences on the main choices, for the user.' },
      transparentBackground: { type: 'boolean', description: 'True only if the user asks for a transparent or overlay texture.' },
      seamless: { type: 'boolean', description: 'True if the user asks for a seamless, tileable or repeating pattern.' },
      layers: {
        type: 'array',
        description: `1–${RECIPE_LIMITS.maxLayers} layers, bottom layer first.`,
        items: { anyOf: layerVariants },
      },
    },
    required: ['name', 'explanation', 'transparentBackground', 'seamless', 'layers'],
    additionalProperties: false,
  };
}

/** Guidance for a model producing TextureSpecs; pairs with textureSpecSchema(). */
export function textureSpecInstructions(): string {
  const layers = LAYER_TYPE_ORDER.map((type) => {
    const def = LAYER_DEFINITIONS[type];
    return `- ${type}: ${def.description}`;
  }).join('\n');
  const examples = PRESETS.slice(0, 12)
    .map((p) => `- "${p.name}" (${p.family}): ${p.recipe.layers.map((l) => `${l.type}[${l.blendMode}]`).join(' + ')}`)
    .join('\n');
  return [
    'You turn a short description of a surface texture into a layer recipe for Material Lab, a procedural texture generator for designers.',
    'The recipe is rendered deterministically by the app; you only choose layers and parameter values.',
    '',
    'Layer types:',
    layers,
    '',
    'How presets combine layers (bottom first):',
    examples,
    '',
    'Guidance:',
    '- Stack bottom to top. Start with a layer that covers the canvas (base-color, liquid, paper-fiber, metallic, fabric or noise) unless a transparent texture is requested.',
    '- Grain and noise usually go on top with overlay or soft-light blend and modest opacity.',
    '- Glass blurs and refracts what is beneath it, so put it above a colorful layer.',
    '- Keep it simple: 1–4 layers is typical. Prefer subtle values unless the description asks for something bold.',
    '- Match colors to the description; use hex colors.',
    '- Write the explanation for a designer, without parameter names or numbers.',
  ].join('\n');
}

function clampSpecValue(def: ParamDef, value: unknown): ParamValue | undefined {
  switch (def.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? Math.min(def.max, Math.max(def.min, value)) : undefined;
    case 'color':
      return typeof value === 'string' ? (normalizeHex(value) ?? undefined) : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'select':
      return typeof value === 'string' && def.options.some((o) => o.value === value) ? value : undefined;
  }
}

/**
 * Turn an untrusted TextureSpec (e.g. model output) into a validated recipe.
 * Unknown layer types and parameters are dropped and values are clamped;
 * throws only when nothing usable remains.
 */
export function recipeFromSpec(input: unknown, options: { seed?: number; now?: Date } = {}): Recipe {
  if (typeof input !== 'object' || input === null) throw new Error('Suggestion is not an object');
  const spec = input as Partial<TextureSpec>;
  const rawLayers = Array.isArray(spec.layers) ? spec.layers.slice(0, RECIPE_LIMITS.maxLayers) : [];
  const layers = rawLayers.flatMap((raw, index) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const def = getLayerDefinition(String((raw as TextureSpecLayer).type));
    if (!def) return [];
    const params: Record<string, ParamValue> = {};
    const given = (raw as TextureSpecLayer).parameters;
    for (const p of def.params) {
      const v = given && typeof given === 'object' ? clampSpecValue(p, (given as Record<string, unknown>)[p.id]) : undefined;
      if (v !== undefined) params[p.id] = v;
    }
    const opacity = (raw as TextureSpecLayer).opacity;
    const blend = (raw as TextureSpecLayer).blendMode;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, RECIPE_LIMITS.maxLayerNameLength) : def.label;
    return [
      createLayer(def.type as LayerType, {
        id: `layer_${index + 1}`,
        name,
        seedOffset: (index + 1) * 17,
        opacity: typeof opacity === 'number' && Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : undefined,
        blendMode: (BLEND_MODES as readonly string[]).includes(String(blend)) ? (blend as BlendMode) : undefined,
        parameters: params,
      }),
    ];
  });
  if (layers.length === 0) throw new Error('Suggestion has no usable layers');
  const name = typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim().slice(0, RECIPE_LIMITS.maxNameLength) : 'Suggested texture';
  let recipe = createRecipe({
    name,
    seed: options.seed ?? randomSeed(),
    transparentBackground: spec.transparentBackground === true,
    layers,
    now: options.now,
    tags: ['suggested'],
  });
  // Like the presets: the family of the main (normal-blend) material, not of a grain or noise overlay on top.
  const main = recipe.layers.find((l) => l.blendMode === 'normal' && getLayerDefinition(l.type)?.family);
  recipe.family = main ? (getLayerDefinition(main.type)?.family ?? inferFamily(recipe)) : inferFamily(recipe);
  if (spec.seamless === true) recipe = fixSeamlessSeams(setSeamless(recipe, true));
  const result = validateRecipe(recipe);
  if (!result.ok) throw new Error(result.errors[0]?.message ?? 'Suggestion is not a valid recipe');
  return result.recipe;
}

/** Parameters that differ from their defaults, for review before editing. */
export function describeChoices(recipe: Recipe): SuggestionChoice[] {
  const choices: SuggestionChoice[] = [];
  for (const layer of recipe.layers) {
    const def = getLayerDefinition(layer.type);
    if (!def) continue;
    for (const p of def.params) {
      const value = layer.parameters[p.id];
      if (value === undefined || value === p.default) continue;
      if (p.visibleWhen && !p.visibleWhen.equals.includes(layer.parameters[p.visibleWhen.param] as ParamValue)) continue;
      choices.push({
        layerId: layer.id,
        layerName: layer.name,
        param: p.id,
        label: p.label,
        value: formatParamValue(p, value),
        defaultValue: formatParamValue(p, p.default),
      });
    }
  }
  return choices;
}

// ---------------------------------------------------------------------------
// Local keyword matcher

const FAMILY_WORDS: Record<string, readonly string[]> = {
  glass: ['glass', 'frosted', 'glassy', 'translucent', 'acrylic', 'refraction', 'refractive', 'panel', 'window'],
  grain: ['grain', 'grainy', 'film', 'analog', 'analogue', 'risograph', 'speckle', 'speckled', 'noisy'],
  paper: ['paper', 'kraft', 'recycled', 'parchment', 'cardboard', 'fiber', 'fibers', 'fibre', 'fibres', 'newsprint', 'crumpled', 'handmade'],
  metallic: ['metal', 'metallic', 'brushed', 'chrome', 'steel', 'aluminium', 'aluminum', 'gold', 'silver', 'copper', 'bronze', 'brass', 'foil'],
  fabric: ['fabric', 'linen', 'canvas', 'denim', 'woven', 'weave', 'wool', 'cotton', 'textile', 'cloth', 'burlap', 'twill', 'tweed'],
  noise: ['noise', 'static', 'topographic', 'topo', 'contour', 'clouds', 'cloudy', 'ridges', 'terrain', 'perlin'],
  liquid: ['liquid', 'fluid', 'marble', 'marbled', 'swirl', 'swirly', 'ink', 'flow', 'flowing', 'iridescent', 'gradient', 'aurora', 'mesh', 'oil'],
};

const COLOR_WORDS: Record<string, string> = {
  red: '#B3261E',
  crimson: '#8E1B2C',
  orange: '#E8743B',
  amber: '#E0A030',
  yellow: '#F2CC3D',
  gold: '#C9A23F',
  green: '#3C8D5A',
  olive: '#6B7036',
  sage: '#9CAF88',
  mint: '#A8E6CF',
  teal: '#1F7A7A',
  cyan: '#38B6D6',
  blue: '#2F5DC8',
  navy: '#14234B',
  indigo: '#3D2E8C',
  purple: '#6A3FA0',
  violet: '#7B5CE0',
  lilac: '#B7A9F7',
  lavender: '#C8B8EE',
  pink: '#F28DB2',
  magenta: '#C2297A',
  rose: '#D98A94',
  peach: '#F6B99A',
  brown: '#6B4A2E',
  tan: '#C2A27C',
  beige: '#D9C3A5',
  cream: '#F2E8D5',
  ivory: '#F6F1E3',
  white: '#F7F7F5',
  black: '#121212',
  charcoal: '#2B2B2E',
  gray: '#8A8A8A',
  grey: '#8A8A8A',
  silver: '#BFC3C8',
  copper: '#B8703F',
  bronze: '#8C6239',
};

const WARMTH: Record<string, readonly string[]> = {
  warm: ['#3A2418', '#A0623A', '#E3B07A', '#F7E6CF'],
  cool: ['#0F1E33', '#2F5D8A', '#8FB8D8', '#E6F0F7'],
  pastel: ['#8C7AA9', '#B8D8D0', '#F4C7C3', '#FBF3E4'],
};

const STYLE_WORDS: Record<string, readonly string[]> = {
  subtle: ['subtle', 'soft', 'gentle', 'faint', 'minimal', 'quiet', 'light'],
  tactile: ['tactile', 'rough', 'textured', 'gritty', 'coarse', 'organic'],
  glossy: ['glossy', 'shiny', 'polished', 'reflective', 'sleek'],
  expressive: ['bold', 'vibrant', 'loud', 'expressive', 'dramatic', 'psychedelic'],
  industrial: ['industrial', 'brutal', 'raw', 'concrete'],
};

const STRONGER = ['strong', 'heavy', 'bold', 'intense', 'rough', 'gritty', 'dramatic', 'deep', 'thick'];
const WEAKER = ['subtle', 'soft', 'gentle', 'faint', 'light', 'slight', 'delicate', 'minimal'];
const SMALLER = ['fine', 'small', 'tiny', 'micro', 'tight', 'dense'];
const LARGER = ['large', 'big', 'coarse', 'chunky', 'wide', 'loose', 'broad'];
const SEAMLESS = ['seamless', 'tileable', 'tiling', 'repeating', 'repeat', 'pattern'];
const TRANSPARENT = ['transparent', 'overlay'];

const STOP = new Set(['a', 'an', 'and', 'the', 'with', 'without', 'over', 'under', 'on', 'in', 'of', 'for', 'to', 'some', 'very', 'bit', 'like', 'that', 'this', 'into', 'from', 'by', 'texture', 'background']);

function words(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
}

function scorePreset(preset: Preset, w: Set<string>): { score: number; matched: string[] } {
  const matched = new Set<string>();
  let score = 0;
  for (const word of FAMILY_WORDS[preset.family] ?? []) {
    if (w.has(word)) {
      score += 3;
      matched.add(word);
    }
  }
  const text = words([preset.name, preset.description, ...preset.tags, ...preset.useCases].join(' '));
  for (const t of new Set(text)) {
    if (t.length > 2 && !STOP.has(t) && w.has(t)) {
      score += 2;
      matched.add(t);
    }
  }
  for (const [style, list] of Object.entries(STYLE_WORDS)) {
    if (preset.style === style && list.some((x) => w.has(x))) score += 1;
  }
  for (const trait of preset.palette) {
    if (w.has(trait)) {
      score += 1;
      matched.add(trait);
    }
  }
  if (preset.status === 'beta') score -= 0.5;
  return { score, matched: [...matched] };
}

function scaleGroup(recipe: Recipe, group: 'intensity' | 'scale', factor: number): number {
  let changed = 0;
  for (const layer of recipe.layers) {
    const def = getLayerDefinition(layer.type);
    if (!def) continue;
    for (const p of def.params) {
      if (p.kind !== 'number' || p.variation !== group) continue;
      const current = layer.parameters[p.id];
      if (typeof current !== 'number') continue;
      const n = p as NumberParamDef;
      const next = Math.min(n.max, Math.max(n.min, current * factor));
      if (next !== current) {
        layer.parameters[p.id] = n.integer ? Math.round(next) : Number(next.toFixed(4));
        changed++;
      }
    }
  }
  return changed;
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Deterministic text-to-recipe: picks the closest preset by keywords, then
 * applies color words, intensity and scale words, and seamless/transparent
 * requests. Works offline; the same prompt always gives the same recipe.
 */
export function suggestLocally(prompt: string, options: { now?: Date } = {}): RecipeSuggestion {
  const text = prompt.trim().slice(0, SUGGESTION_LIMITS.maxPromptLength);
  const list = words(text);
  const w = new Set(list);
  const notes: string[] = [];

  let best: { preset: Preset; score: number; matched: string[] } | null = null;
  for (const preset of PRESETS) {
    const s = scorePreset(preset, w);
    if (!best || s.score > best.score) best = { preset, ...s };
  }
  const chosen = best && best.score > 0 ? best : null;
  const preset = chosen?.preset ?? (PRESETS.find((p) => p.family === 'liquid') as Preset);
  let recipe = instantiatePreset(preset, options.now);
  recipe.metadata = { ...recipe.metadata, tags: [...(recipe.metadata.tags ?? []), 'suggested'] };
  notes.push(
    chosen
      ? `Started from the “${preset.name}” preset (matched ${chosen.matched.slice(0, 4).map((m) => `“${m}”`).join(', ')}).`
      : `No texture words matched, so this starts from the “${preset.name}” preset.`,
  );

  // Colors: named colors first, then warm/cool/pastel moods.
  const named = [...new Set(list.filter((x) => COLOR_WORDS[x]).map((x) => COLOR_WORDS[x] as string))];
  const mood = Object.keys(WARMTH).find((m) => w.has(m));
  const builtIn = BUILT_IN_PALETTES.find((p) => words(p.name).some((x) => x.length > 3 && x !== 'warm' && w.has(x)));
  let palette: string[] = [];
  if (named.length > 0) {
    palette = [...named];
    // A single named color gets darker and lighter companions so contrast survives.
    if (palette.length === 1) palette = ['#151515', palette[0] as string, '#F4F1EA'];
    if (w.has('dark')) palette = palette.filter((c) => luma(hexToRgb(c)) < 0.75).concat('#0E0E10');
    if (w.has('light') || w.has('pale')) palette = palette.concat('#FAFAF7');
  } else if (builtIn) {
    palette = [...builtIn.colors];
  } else if (mood) {
    palette = [...(WARMTH[mood] as string[])];
  }
  if (palette.length > 0) {
    const result = applyPalette(recipe, palette, { strength: named.length > 0 ? 1 : 0.7 });
    if (result.changes.length > 0) {
      recipe = result.recipe;
      notes.push(
        named.length > 0
          ? `Recolored with ${[...new Set(list.filter((x) => COLOR_WORDS[x]))].join(', ')} tones.`
          : builtIn
            ? `Recolored with the “${builtIn.name}” palette.`
            : `Shifted colors ${mood === 'pastel' ? 'to pastels' : `${mood}er`}.`,
      );
    }
  }

  const stronger = STRONGER.some((x) => w.has(x));
  const weaker = WEAKER.some((x) => w.has(x));
  if (stronger !== weaker && scaleGroup(recipe, 'intensity', stronger ? 1.4 : 0.6) > 0) notes.push(stronger ? 'Made the effect stronger.' : 'Made the effect subtler.');
  const smaller = SMALLER.some((x) => w.has(x));
  const larger = LARGER.some((x) => w.has(x));
  if (smaller !== larger && scaleGroup(recipe, 'scale', smaller ? 0.6 : 1.6) > 0) notes.push(smaller ? 'Made the detail finer.' : 'Made the features larger.');

  if (TRANSPARENT.some((x) => w.has(x)) && !recipe.canvas.transparentBackground) {
    notes.push('Transparency was requested; turn on “Transparent background” in Canvas settings if the layers leave areas uncovered.');
  }
  if (SEAMLESS.some((x) => w.has(x))) {
    recipe = setSeamless(recipe, true);
    if (analyzeSeamless(recipe).seams.length > 0) recipe = fixSeamlessSeams(recipe);
    notes.push('Set up as a seamless tile.');
  }

  const short = list.filter((x) => x.length > 2 && !STOP.has(x) && !SEAMLESS.includes(x)).slice(0, 4).join(' ');
  recipe.name = short ? titleCase(short).slice(0, RECIPE_LIMITS.maxNameLength) : preset.name;
  const validated = validateRecipe(recipe);
  const final = validated.ok ? validated.recipe : recipe;
  return {
    recipe: final,
    source: 'local',
    summary: `Based on “${preset.name}”, adjusted to your description.`,
    notes,
    choices: describeChoices(final),
  };
}

/** Wrap a recipe built from a model's TextureSpec as a suggestion. */
export function suggestionFromSpec(spec: unknown, options: { seed?: number; now?: Date } = {}): RecipeSuggestion {
  const recipe = recipeFromSpec(spec, options);
  const explanation = typeof (spec as TextureSpec).explanation === 'string' ? (spec as TextureSpec).explanation.trim().slice(0, 600) : '';
  return {
    recipe,
    source: 'ai',
    summary: explanation || 'Suggested from your description.',
    notes: [],
    choices: describeChoices(recipe),
  };
}
