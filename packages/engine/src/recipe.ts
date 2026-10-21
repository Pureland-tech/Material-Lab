import { getLayerDefinition, LAYER_DEFINITIONS } from './layers';
import { defaultParameters } from './params';
import { normalizeSeed, randomSeed } from './random';
import type { BlendMode, Layer, LayerParameters, LayerType, Recipe, RecipeFamily } from './types';
import { createId } from './validate';
import { ENGINE_VERSION, SCHEMA_VERSION } from './version';

export const DEFAULT_CANVAS = { width: 1600, height: 1000 } as const;

export interface CreateLayerOptions {
  name?: string;
  seedOffset?: number;
  opacity?: number;
  blendMode?: BlendMode;
  enabled?: boolean;
  parameters?: Partial<LayerParameters>;
  id?: string;
}

export function createLayer(type: LayerType, options: CreateLayerOptions = {}): Layer {
  const def = LAYER_DEFINITIONS[type];
  const parameters = defaultParameters(def.params);
  for (const [key, value] of Object.entries(options.parameters ?? {})) {
    if (value !== undefined && def.params.some((p) => p.id === key)) parameters[key] = value;
  }
  return {
    id: options.id ?? createId('layer'),
    type,
    name: options.name ?? def.label,
    enabled: options.enabled ?? true,
    opacity: options.opacity ?? def.defaultOpacity,
    blendMode: options.blendMode ?? def.defaultBlendMode,
    seedOffset: options.seedOffset ?? 17,
    parameters,
  };
}

export interface CreateRecipeOptions {
  name?: string;
  family?: RecipeFamily;
  seed?: number;
  width?: number;
  height?: number;
  transparentBackground?: boolean;
  layers?: Layer[];
  presetId?: string;
  tags?: string[];
  now?: Date;
}

export function createRecipe(options: CreateRecipeOptions = {}): Recipe {
  const now = (options.now ?? new Date()).toISOString();
  const width = options.width ?? DEFAULT_CANVAS.width;
  const height = options.height ?? DEFAULT_CANVAS.height;
  const recipe: Recipe = {
    schemaVersion: SCHEMA_VERSION,
    recipeId: createId('recipe'),
    name: options.name ?? 'Untitled texture',
    family: options.family ?? 'custom',
    engineVersion: ENGINE_VERSION,
    seed: normalizeSeed(options.seed ?? randomSeed()),
    canvas: {
      width,
      height,
      colorSpace: 'sRGB',
      transparentBackground: options.transparentBackground ?? false,
    },
    layers: options.layers ?? [],
    exportDefaults: { format: 'png', width, height, scale: 1, seamless: false },
    metadata: { createdAt: now, updatedAt: now },
  };
  if (options.presetId) recipe.metadata.presetId = options.presetId;
  if (options.tags) recipe.metadata.tags = [...options.tags];
  return recipe;
}

export function cloneRecipe(recipe: Recipe): Recipe {
  return JSON.parse(JSON.stringify(recipe)) as Recipe;
}

/** Copy a recipe under a new identity. The original is never modified. */
export function duplicateRecipe(recipe: Recipe, name?: string, now: Date = new Date()): Recipe {
  const copy = cloneRecipe(recipe);
  copy.recipeId = createId('recipe');
  copy.name = name ?? `${recipe.name} copy`.slice(0, 80);
  copy.metadata.createdAt = now.toISOString();
  copy.metadata.updatedAt = copy.metadata.createdAt;
  return copy;
}

/** An explicit seed offset not used by any existing layer. */
export function nextSeedOffset(recipe: Recipe): number {
  return recipe.layers.reduce((max, l) => Math.max(max, l.seedOffset), 0) + 17;
}

/** The family a recipe reads as: its topmost enabled texture layer. */
export function inferFamily(recipe: Recipe): RecipeFamily {
  for (let i = recipe.layers.length - 1; i >= 0; i--) {
    const layer = recipe.layers[i] as Layer;
    if (!layer.enabled) continue;
    const family = getLayerDefinition(layer.type)?.family;
    if (family) return family;
  }
  return 'custom';
}

/**
 * Stable string of everything that affects rendered pixels, for caching
 * previews and comparing renders.
 */
export function renderFingerprint(recipe: Recipe): string {
  return JSON.stringify([recipe.engineVersion, recipe.seed, recipe.canvas, recipe.layers, recipe.exportDefaults.seamless]);
}

/** Stable string of everything a user would consider "their edits". */
export function contentFingerprint(recipe: Recipe): string {
  return JSON.stringify([recipe.name, recipe.family, recipe.seed, recipe.canvas, recipe.layers, recipe.exportDefaults]);
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'texture';
}
