import { createLayer, createRecipe, cloneRecipe, type CreateLayerOptions } from './recipe';
import { analyzeSeamless } from './seamless';
import { createId } from './validate';
import type { FamilyId, LayerType, Recipe } from './types';

export type PresetStatus = 'ready' | 'beta';

export const PRESET_STYLES = ['subtle', 'tactile', 'glossy', 'organic', 'industrial', 'expressive'] as const;
export type PresetStyle = (typeof PRESET_STYLES)[number];

export const PRESET_PALETTES = ['light', 'dark', 'warm', 'cool', 'neutral', 'colorful'] as const;
export type PresetPalette = (typeof PRESET_PALETTES)[number];

export interface Preset {
  id: string;
  name: string;
  family: FamilyId;
  /** Short purpose description shown on the card. */
  description: string;
  /** Style and search tags, e.g. subtle, tactile, glossy, organic, industrial. */
  tags: readonly string[];
  /** What the texture is good for, e.g. "UI background". */
  useCases: readonly string[];
  status: PresetStatus;
  /** Overall character, for filtering (PRD FR-004). */
  style: PresetStyle;
  /** Dominant palette traits, for filtering. */
  palette: readonly PresetPalette[];
  /** Known limitations, shown for beta presets. */
  limitations?: string;
  /** Canonical recipe. Never edit it directly; use instantiatePreset(). */
  recipe: Recipe;
}

interface PresetSpec extends Omit<Preset, 'recipe'> {
  seed: number;
  width?: number;
  height?: number;
  transparent?: boolean;
  layers: [LayerType, CreateLayerOptions][];
}

const PRESET_DATE = new Date('2026-10-20T00:00:00.000Z');

function definePreset(spec: PresetSpec): Preset {
  const recipe = createRecipe({
    name: spec.name,
    family: spec.family,
    seed: spec.seed,
    width: spec.width ?? 1600,
    height: spec.height ?? 1000,
    transparentBackground: spec.transparent ?? false,
    presetId: spec.id,
    tags: [...spec.tags],
    now: PRESET_DATE,
    layers: spec.layers.map(([type, options], index) =>
      createLayer(type, { id: `layer_${index + 1}`, seedOffset: (index + 1) * 17, ...options }),
    ),
  });
  recipe.recipeId = `preset_${spec.id}`;
  const { seed: _seed, width: _w, height: _h, transparent: _t, layers: _l, ...meta } = spec;
  return { ...meta, recipe };
}

export const PRESETS: readonly Preset[] = [
  // Glass
  definePreset({
    id: 'glass-aurora-panel',
    name: 'Aurora glass panel',
    family: 'glass',
    description: 'Frosted glass card floating over aurora color, with a lit edge.',
    tags: ['glossy', 'premium', 'colorful'],
    useCases: ['Hero section', 'Card background', 'Product launch'],
    status: 'ready',
    style: 'glossy',
    palette: ['cool', 'colorful'],
    seed: 7731,
    layers: [
      ['liquid', { name: 'Aurora', parameters: { colorA: '#0E1530', colorB: '#4B5BEA', colorC: '#FF8FCB', swirlScale: 460, distortion: 0.45, smoothness: 0.8, edgeDetail: 0, accent: 0.75 } }],
      ['glass', { name: 'Glass card', parameters: { frost: 36, tintStrength: 0.16, sheen: 0.3, edgeHighlight: 0.6, edgeWidth: 10, grainAmount: 0.25, refraction: 0.15, inset: 170, cornerRadius: 36 } }],
    ],
  }),
  definePreset({
    id: 'glass-clear-haze',
    name: 'Clear haze',
    family: 'glass',
    description: 'Light, airy frosted glass over a pale gradient. Calm enough for text.',
    tags: ['subtle', 'light', 'minimal'],
    useCases: ['UI background', 'Dashboard panel', 'Presentation'],
    status: 'ready',
    style: 'subtle',
    palette: ['light', 'cool'],
    seed: 1204,
    layers: [
      ['base-color', { name: 'Gradient', parameters: { fill: 'linear', color: '#C9D8F2', color2: '#F3E3F1', angle: 35 } }],
      ['noise', { name: 'Soft blobs', opacity: 0.85, parameters: { noiseType: 'gradient', scale: 380, octaves: 2, colorA: '#9FB8EE', colorB: '#FFD9E8', contrast: 0.7 } }],
      ['glass', { name: 'Haze', parameters: { frost: 34, tintStrength: 0.2, sheen: 0.35, edgeHighlight: 0.35, grainAmount: 0.12, refraction: 0.05 } }],
    ],
  }),
  definePreset({
    id: 'glass-smoked',
    name: 'Smoked glass',
    family: 'glass',
    description: 'Dark tinted glass with a bright rim, for premium dark interfaces.',
    tags: ['glossy', 'dark', 'premium'],
    useCases: ['Dark mode card', 'Product page', 'Music or media UI'],
    status: 'ready',
    style: 'glossy',
    palette: ['dark'],
    seed: 50213,
    layers: [
      ['liquid', { name: 'Ember flow', parameters: { colorA: '#06060A', colorB: '#4A2577', colorC: '#F07A3C', swirlScale: 420, distortion: 0.55, smoothness: 0.75, edgeDetail: 0.15, accent: 0.65 } }],
      ['glass', { name: 'Smoked glass', parameters: { frost: 30, tint: '#121318', tintStrength: 0.45, sheen: 0.18, edgeHighlight: 0.75, edgeWidth: 6, grainAmount: 0.3, refraction: 0.25, inset: 120, cornerRadius: 20 } }],
    ],
  }),

  // Grain
  definePreset({
    id: 'grain-soft-ui',
    name: 'Soft UI grain',
    family: 'grain',
    description: 'Barely-there monochrome grain on a warm neutral. Safe behind text.',
    tags: ['subtle', 'minimal', 'light'],
    useCases: ['UI background', 'Empty state', 'Card background'],
    status: 'ready',
    style: 'subtle',
    palette: ['light', 'neutral'],
    seed: 3301,
    layers: [
      ['base-color', { name: 'Warm neutral', parameters: { color: '#F2EEE8' } }],
      ['grain', { name: 'Fine grain', parameters: { amount: 0.16, size: 1, clumping: 0.15, contrast: 0.3 } }],
    ],
  }),
  definePreset({
    id: 'grain-night-film',
    name: 'Night film',
    family: 'grain',
    description: 'Dark gradient with colored film grain and gentle clumping.',
    tags: ['tactile', 'dark', 'analog'],
    useCases: ['Hero section', 'Social graphic', 'Video thumbnail'],
    status: 'ready',
    style: 'tactile',
    palette: ['dark', 'cool'],
    seed: 9902,
    layers: [
      ['base-color', { name: 'Night gradient', parameters: { fill: 'radial', color: '#2B2D42', color2: '#0B0C12' } }],
      ['grain', { name: 'Film grain', parameters: { amount: 0.38, size: 1.6, monochrome: false, clumping: 0.45, contrast: 0.5 } }],
    ],
  }),
  definePreset({
    id: 'grain-sunwashed',
    name: 'Sun-washed print',
    family: 'grain',
    description: 'Warm gradient with coarse soft grain, like an analog print.',
    tags: ['tactile', 'warm', 'analog'],
    useCases: ['Campaign graphic', 'Poster', 'Presentation'],
    status: 'ready',
    style: 'tactile',
    palette: ['warm', 'colorful'],
    seed: 4417,
    layers: [
      ['base-color', { name: 'Sunset', parameters: { fill: 'linear', color: '#F4A259', color2: '#E86F68', angle: 120 } }],
      ['grain', { name: 'Coarse grain', parameters: { amount: 0.13, size: 1.8, clumping: 0.3, contrast: 0.25 } }],
    ],
  }),

  // Paper
  definePreset({
    id: 'paper-warm-recycled',
    name: 'Warm recycled paper',
    family: 'paper',
    description: 'Recycled stock with visible fibers, speckles and fine grain.',
    tags: ['tactile', 'warm', 'organic'],
    useCases: ['Editorial layout', 'Packaging mockup', 'Brand background'],
    status: 'ready',
    style: 'tactile',
    palette: ['warm', 'light'],
    seed: 482913,
    layers: [
      ['paper-fiber', { name: 'Paper fibers', parameters: { tone: '#E8D9BD', fiberDensity: 0.55, fiberScale: 0.55, speckleAmount: 0.35, speckleSize: 1.1, warmth: 0.5, roughness: 0.45 } }],
      ['grain', { name: 'Fine grain', opacity: 0.6, parameters: { amount: 0.12, size: 1, contrast: 0.2, clumping: 0 } }],
    ],
  }),
  definePreset({
    id: 'paper-modern-white',
    name: 'Modern off-white',
    family: 'paper',
    description: 'Clean, subtle uncoated paper. Quiet enough for UI and reading.',
    tags: ['subtle', 'minimal', 'light'],
    useCases: ['UI background', 'Document', 'Portfolio'],
    status: 'ready',
    style: 'subtle',
    palette: ['light', 'neutral'],
    seed: 77012,
    layers: [
      ['paper-fiber', { name: 'Uncoated paper', parameters: { tone: '#F6F4EF', fiberDensity: 0.3, fiberScale: 0.3, fiberLength: 0.4, speckleAmount: 0.06, speckleSize: 0.7, warmth: 0, roughness: 0.25, directionality: 0.5 } }],
    ],
  }),
  definePreset({
    id: 'paper-vintage-kraft',
    name: 'Vintage kraft',
    family: 'paper',
    description: 'Expressive aged kraft paper with long fibers and soft folds.',
    tags: ['tactile', 'warm', 'vintage'],
    useCases: ['Packaging mockup', 'Poster', 'Craft brand'],
    status: 'ready',
    style: 'tactile',
    palette: ['warm'],
    seed: 21808,
    layers: [
      ['paper-fiber', { name: 'Kraft', parameters: { tone: '#C49A6C', fiberDensity: 0.75, fiberScale: 0.7, fiberLength: 0.8, directionality: 0.55, speckleAmount: 0.5, speckleSize: 1.4, warmth: 0.8, roughness: 0.6, wrinkle: 0.45 } }],
    ],
  }),

  // Metallic
  definePreset({
    id: 'metal-brushed-silver',
    name: 'Brushed silver',
    family: 'metallic',
    description: 'Horizontal brushed aluminium with a soft diagonal highlight.',
    tags: ['industrial', 'glossy', 'neutral'],
    useCases: ['Product mockup', 'Tech hero', 'Device background'],
    status: 'ready',
    style: 'industrial',
    palette: ['neutral', 'cool'],
    seed: 1600,
    layers: [['metallic', { name: 'Brushed silver', parameters: { metal: 'silver', bands: 2, highlightAngle: 60, brushStrength: 0.75, brushScale: 0.5, roughness: 0.4, scratches: 0.05 } }]],
  }),
  definePreset({
    id: 'metal-champagne-gold',
    name: 'Champagne gold',
    family: 'metallic',
    description: 'Polished gold with broad reflection bands for premium accents.',
    tags: ['glossy', 'premium', 'warm'],
    useCases: ['Invitation', 'Luxury brand', 'Award graphic'],
    status: 'ready',
    style: 'glossy',
    palette: ['warm'],
    seed: 3112,
    layers: [['metallic', { name: 'Gold', parameters: { metal: 'gold', bands: 3, highlightAngle: 35, highlightWidth: 0.45, brushStrength: 0.25, roughness: 0.25, contrast: 0.65, scratches: 0 } }]],
  }),
  definePreset({
    id: 'metal-anodized-copper',
    name: 'Worn copper',
    family: 'metallic',
    description: 'Rough copper with scratches and a muted sheen.',
    tags: ['industrial', 'warm', 'tactile'],
    useCases: ['Game UI', 'Packaging', 'Craft brand'],
    status: 'ready',
    style: 'industrial',
    palette: ['warm'],
    seed: 80123,
    layers: [['metallic', { name: 'Copper', parameters: { metal: 'copper', bands: 2, highlightAngle: 110, roughness: 0.7, contrast: 0.45, brushStrength: 0.4, brushAngle: 20, scratches: 0.35 } }]],
  }),

  // Fabric
  definePreset({
    id: 'fabric-natural-linen',
    name: 'Natural linen',
    family: 'fabric',
    description: 'Irregular linen weave with slubs and gentle color variation.',
    tags: ['tactile', 'organic', 'neutral'],
    useCases: ['Brand background', 'Packaging mockup', 'Interior mood board'],
    status: 'ready',
    style: 'organic',
    palette: ['neutral', 'light'],
    seed: 6060,
    layers: [['fabric', { name: 'Linen', parameters: { weave: 'linen', threadScale: 5, threadDensity: 0.85, warpColor: '#D8CDB8', weftColor: '#CBBFA7', colorVariation: 0.35, fiberVariation: 0.55, roughness: 0.4, contrast: 0.45 } }]],
  }),
  definePreset({
    id: 'fabric-indigo-twill',
    name: 'Indigo twill',
    family: 'fabric',
    description: 'Denim-like diagonal twill in indigo and ecru.',
    tags: ['tactile', 'industrial', 'cool'],
    useCases: ['Fashion graphic', 'Product mockup', 'Social graphic'],
    status: 'ready',
    style: 'tactile',
    palette: ['cool'],
    seed: 1450,
    layers: [['fabric', { name: 'Twill', parameters: { weave: 'twill', threadScale: 4, threadDensity: 0.92, warpColor: '#2E4A7D', weftColor: '#C9C3B4', colorVariation: 0.3, fiberVariation: 0.5, roughness: 0.35, contrast: 0.55, rotation: 0 } }]],
  }),
  definePreset({
    id: 'fabric-canvas-basket',
    name: 'Artist canvas',
    family: 'fabric',
    description: 'Coarse basket-weave canvas with open gaps.',
    tags: ['tactile', 'neutral', 'craft'],
    useCases: ['Art print', 'Portfolio', 'Poster'],
    status: 'ready',
    style: 'tactile',
    palette: ['light', 'neutral'],
    seed: 30303,
    layers: [['fabric', { name: 'Canvas', parameters: { weave: 'basket', threadScale: 7, threadDensity: 0.7, warpColor: '#E9E1D0', weftColor: '#E2D8C4', colorVariation: 0.15, fiberVariation: 0.4, roughness: 0.3, contrast: 0.6 } }]],
  }),

  // Noise
  definePreset({
    id: 'noise-fine-mono',
    name: 'Fine mono noise',
    family: 'noise',
    description: 'Transparent fine noise overlay to drop over any design.',
    tags: ['subtle', 'overlay', 'minimal'],
    useCases: ['Overlay', 'UI background', 'Gradient dithering'],
    status: 'ready',
    style: 'subtle',
    palette: ['neutral'],
    seed: 1,
    transparent: true,
    layers: [['noise', { name: 'Noise overlay', opacity: 0.3, parameters: { noiseType: 'white', scale: 1, colorB: '#000000', alphaOutput: true } }]],
  }),
  definePreset({
    id: 'noise-cellular-mist',
    name: 'Cellular mist',
    family: 'noise',
    description: 'Soft cellular field in cool grays, like frosted stone.',
    tags: ['organic', 'cool', 'subtle'],
    useCases: ['Hero section', 'Section divider', 'Presentation'],
    status: 'ready',
    style: 'organic',
    palette: ['cool', 'light'],
    seed: 52011,
    layers: [['noise', { name: 'Cells', parameters: { noiseType: 'cellular', scale: 140, octaves: 3, detail: 0.45, colorA: '#7C8794', colorB: '#E8ECF0', contrast: 0.2 } }]],
  }),
  definePreset({
    id: 'noise-topo-ridges',
    name: 'Topographic ridges',
    family: 'noise',
    description: 'Ridged noise on deep green, reminiscent of terrain relief.',
    tags: ['organic', 'dark', 'expressive'],
    useCases: ['Outdoor brand', 'Hero section', 'Data story'],
    status: 'ready',
    style: 'organic',
    palette: ['dark', 'cool'],
    seed: 2718,
    layers: [['noise', { name: 'Ridges', parameters: { noiseType: 'ridged', scale: 320, octaves: 5, detail: 0.5, colorA: '#0F2A22', colorB: '#9FD6A8', contrast: 0.3 } }]],
  }),

  // Liquid
  definePreset({
    id: 'liquid-ink-marble',
    name: 'Ink marble',
    family: 'liquid',
    description: 'High-contrast marbling with bright contour lines.',
    tags: ['expressive', 'organic', 'dark'],
    useCases: ['Album art', 'Poster', 'Campaign graphic'],
    status: 'ready',
    style: 'expressive',
    palette: ['dark'],
    seed: 13013,
    layers: [['liquid', { name: 'Marble', parameters: { colorA: '#0B0B12', colorB: '#2D3561', colorC: '#E8D8C3', swirlScale: 300, distortion: 0.8, smoothness: 0.6, edgeDetail: 0.6, accent: 0.6 } }]],
  }),
  definePreset({
    id: 'liquid-calm-flow',
    name: 'Calm flow',
    family: 'liquid',
    description: 'Low-distortion pastel flow that stays readable behind content.',
    tags: ['subtle', 'organic', 'light'],
    useCases: ['UI background', 'Landing page', 'Presentation'],
    status: 'ready',
    style: 'subtle',
    palette: ['light', 'cool'],
    seed: 808,
    layers: [['liquid', { name: 'Flow', parameters: { colorA: '#E3E9FB', colorB: '#AFC3F5', colorC: '#FBD3C0', swirlScale: 700, distortion: 0.3, smoothness: 0.9, edgeDetail: 0, accent: 0.6 } }]],
  }),
  definePreset({
    id: 'liquid-iridescent',
    name: 'Iridescent swirl',
    family: 'liquid',
    description: 'Saturated holographic swirl with soft grain on top.',
    tags: ['expressive', 'colorful', 'glossy'],
    useCases: ['Social graphic', 'Event promo', 'Music artwork'],
    status: 'ready',
    style: 'expressive',
    palette: ['colorful'],
    seed: 24680,
    layers: [
      ['liquid', { name: 'Swirl', parameters: { colorA: '#3B1C8C', colorB: '#21C8D8', colorC: '#FF8AC9', swirlScale: 360, distortion: 0.7, smoothness: 0.6, edgeDetail: 0.2, accent: 0.6, flowAngle: 140 } }],
      ['grain', { name: 'Grain', opacity: 0.7, parameters: { amount: 0.18, size: 1.2, contrast: 0.3 } }],
    ],
  }),
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * Create an editable recipe from a preset. The canonical preset is never
 * modified; the copy gets its own identity.
 */
export function instantiatePreset(preset: Preset, now: Date = new Date()): Recipe {
  const recipe = cloneRecipe(preset.recipe);
  recipe.recipeId = createId('recipe');
  recipe.metadata.createdAt = now.toISOString();
  recipe.metadata.updatedAt = recipe.metadata.createdAt;
  recipe.metadata.presetId = preset.id;
  return recipe;
}

/** Whether a preset tiles without seams as it is (no settings need changing). */
export function presetTilesSeamlessly(preset: Preset): boolean {
  return analyzeSeamless(preset.recipe).seams.length === 0;
}

export interface PresetFilters {
  family?: FamilyId | null;
  style?: PresetStyle | null;
  palette?: PresetPalette | null;
  /** Only presets that tile without seams. */
  seamless?: boolean;
}

/** Case-insensitive search across name, family, style, palette, tags, use cases and description. */
export function searchPresets(query: string, filters: FamilyId | null | PresetFilters = {}, presets: readonly Preset[] = PRESETS): Preset[] {
  const f: PresetFilters = typeof filters === 'string' || filters === null ? { family: filters } : filters;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return presets.filter((p) => {
    if (f.family && p.family !== f.family) return false;
    if (f.style && p.style !== f.style) return false;
    if (f.palette && !p.palette.includes(f.palette)) return false;
    if (f.seamless && !presetTilesSeamlessly(p)) return false;
    if (terms.length === 0) return true;
    const haystack = [p.name, p.family, p.style, ...p.palette, p.description, ...p.tags, ...p.useCases].join(' ').toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}
