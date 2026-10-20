/**
 * Pure recipe edits used by the editor. Each returns a new recipe and never
 * mutates its input, so every edit can be recorded for undo/redo.
 */
import {
  createId,
  createLayer,
  getLayerDefinition,
  inferFamily,
  nextSeedOffset,
  normalizeSeed,
  RECIPE_LIMITS,
  type BlendMode,
  type Layer,
  type LayerType,
  type ParamValue,
  type Recipe,
} from '@material-lab/engine';

function withLayers(recipe: Recipe, layers: Layer[]): Recipe {
  const next = { ...recipe, layers };
  // Keep the recipe's family in step with its content unless it was set explicitly.
  return recipe.family === 'custom' || recipe.family === inferFamily(recipe) ? { ...next, family: inferFamily(next) } : next;
}

function mapLayer(recipe: Recipe, id: string, fn: (layer: Layer) => Layer): Recipe {
  return { ...recipe, layers: recipe.layers.map((l) => (l.id === id ? fn(l) : l)) };
}

export function canAddLayer(recipe: Recipe): boolean {
  return recipe.layers.length < RECIPE_LIMITS.maxLayers;
}

/** Add a layer above `aboveId` (or on top). Returns the recipe and new layer id. */
export function addLayer(recipe: Recipe, type: LayerType, aboveId?: string): { recipe: Recipe; layerId: string } {
  if (!canAddLayer(recipe)) return { recipe, layerId: '' };
  const layer = createLayer(type, { seedOffset: nextSeedOffset(recipe) });
  // Name duplicates "Grain 2", "Grain 3"… so layers stay distinguishable.
  const sameName = recipe.layers.filter((l) => l.name === layer.name || l.name.startsWith(`${layer.name} `)).length;
  if (sameName > 0) layer.name = `${layer.name} ${sameName + 1}`;
  const layers = [...recipe.layers];
  const index = aboveId ? layers.findIndex((l) => l.id === aboveId) : -1;
  layers.splice(index >= 0 ? index + 1 : layers.length, 0, layer);
  return { recipe: withLayers(recipe, layers), layerId: layer.id };
}

export function removeLayer(recipe: Recipe, id: string): Recipe {
  return withLayers(
    recipe,
    recipe.layers.filter((l) => l.id !== id),
  );
}

/** Duplicate a layer directly above the original. The copy looks identical (same seed offset). */
export function duplicateLayer(recipe: Recipe, id: string): { recipe: Recipe; layerId: string } {
  const index = recipe.layers.findIndex((l) => l.id === id);
  const original = recipe.layers[index];
  if (!original || !canAddLayer(recipe)) return { recipe, layerId: '' };
  const copy: Layer = { ...structuredClone(original), id: createId('layer'), name: `${original.name} copy`.slice(0, RECIPE_LIMITS.maxLayerNameLength) };
  const layers = [...recipe.layers];
  layers.splice(index + 1, 0, copy);
  return { recipe: withLayers(recipe, layers), layerId: copy.id };
}

export function renameLayer(recipe: Recipe, id: string, name: string): Recipe {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, RECIPE_LIMITS.maxLayerNameLength);
  if (!clean) return recipe;
  return mapLayer(recipe, id, (l) => (l.name === clean ? l : { ...l, name: clean }));
}

/** Move a layer to a new index in the stack (0 = bottom). */
export function moveLayerTo(recipe: Recipe, id: string, toIndex: number): Recipe {
  const from = recipe.layers.findIndex((l) => l.id === id);
  const to = Math.max(0, Math.min(recipe.layers.length - 1, toIndex));
  if (from < 0 || from === to) return recipe;
  const layers = [...recipe.layers];
  const [layer] = layers.splice(from, 1);
  layers.splice(to, 0, layer as Layer);
  return withLayers(recipe, layers);
}

/** Move up (+1, toward the top of the stack) or down (−1). */
export function moveLayerBy(recipe: Recipe, id: string, delta: number): Recipe {
  const index = recipe.layers.findIndex((l) => l.id === id);
  return index < 0 ? recipe : moveLayerTo(recipe, id, index + delta);
}

export function setLayerEnabled(recipe: Recipe, id: string, enabled: boolean): Recipe {
  return withLayers(
    recipe,
    recipe.layers.map((l) => (l.id === id ? { ...l, enabled } : l)),
  );
}

export function setLayerOpacity(recipe: Recipe, id: string, opacity: number): Recipe {
  const v = Math.min(1, Math.max(0, opacity));
  return mapLayer(recipe, id, (l) => (l.opacity === v ? l : { ...l, opacity: v }));
}

export function setLayerBlend(recipe: Recipe, id: string, blendMode: BlendMode): Recipe {
  return mapLayer(recipe, id, (l) => (l.blendMode === blendMode ? l : { ...l, blendMode }));
}

export function setLayerSeedOffset(recipe: Recipe, id: string, seedOffset: number): Recipe {
  const v = Math.trunc(seedOffset);
  return mapLayer(recipe, id, (l) => (l.seedOffset === v ? l : { ...l, seedOffset: v }));
}

export function setParam(recipe: Recipe, id: string, paramId: string, value: ParamValue): Recipe {
  return mapLayer(recipe, id, (l) => (l.parameters[paramId] === value ? l : { ...l, parameters: { ...l.parameters, [paramId]: value } }));
}

export function resetParam(recipe: Recipe, id: string, paramId: string): Recipe {
  const layer = recipe.layers.find((l) => l.id === id);
  const def = layer ? getLayerDefinition(layer.type)?.params.find((p) => p.id === paramId) : undefined;
  return def ? setParam(recipe, id, paramId, def.default) : recipe;
}

/** Restore every parameter, opacity and blend mode of a layer to its defaults. */
export function resetLayer(recipe: Recipe, id: string): Recipe {
  return mapLayer(recipe, id, (l) => {
    const def = getLayerDefinition(l.type);
    if (!def) return l;
    const parameters: Layer['parameters'] = {};
    for (const p of def.params) parameters[p.id] = p.default;
    return { ...l, parameters, opacity: def.defaultOpacity, blendMode: def.defaultBlendMode };
  });
}

export function setSeed(recipe: Recipe, seed: number): Recipe {
  const v = normalizeSeed(seed);
  return recipe.seed === v ? recipe : { ...recipe, seed: v };
}

export function setName(recipe: Recipe, name: string): Recipe {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, RECIPE_LIMITS.maxNameLength);
  return !clean || clean === recipe.name ? recipe : { ...recipe, name: clean };
}

export function setCanvasSize(recipe: Recipe, width: number, height: number): Recipe {
  const clamp = (v: number) => Math.round(Math.min(RECIPE_LIMITS.maxCanvasSide, Math.max(RECIPE_LIMITS.minCanvasSide, v)));
  const w = clamp(width);
  const h = clamp(height);
  if (w === recipe.canvas.width && h === recipe.canvas.height) return recipe;
  // Export defaults follow the canvas when they matched it before.
  const followed = recipe.exportDefaults.width === recipe.canvas.width && recipe.exportDefaults.height === recipe.canvas.height;
  return {
    ...recipe,
    canvas: { ...recipe.canvas, width: w, height: h },
    exportDefaults: followed ? { ...recipe.exportDefaults, width: w, height: h } : recipe.exportDefaults,
  };
}

export function setTransparentBackground(recipe: Recipe, transparent: boolean): Recipe {
  return recipe.canvas.transparentBackground === transparent ? recipe : { ...recipe, canvas: { ...recipe.canvas, transparentBackground: transparent } };
}
