import { getLayerDefinition } from './layers';
import { normalizeLayerParameters } from './validate';
import type { Recipe } from './types';

export interface SeamlessIssue {
  layerId: string;
  layerName: string;
  message: string;
}

export interface SeamlessAnalysis {
  /** Visible layers whose settings will show seams at tile edges. */
  seams: SeamlessIssue[];
  /** Settings approximated so the tile repeats (angles, counts). */
  notes: SeamlessIssue[];
}

/** Whether the recipe renders as a seamless tile (stored with its export defaults). */
export function isSeamless(recipe: Recipe): boolean {
  return recipe.exportDefaults.seamless === true;
}

export function setSeamless(recipe: Recipe, seamless: boolean): Recipe {
  if (recipe.exportDefaults.seamless === seamless) return recipe;
  // A tile is the canvas: exports render at the canvas size.
  const exportDefaults = seamless
    ? { ...recipe.exportDefaults, seamless, width: recipe.canvas.width, height: recipe.canvas.height }
    : { ...recipe.exportDefaults, seamless };
  return { ...recipe, exportDefaults };
}

/** What would seam, and what gets approximated, if this recipe renders as a tile. */
export function analyzeSeamless(recipe: Recipe): SeamlessAnalysis {
  const seams: SeamlessIssue[] = [];
  const notes: SeamlessIssue[] = [];
  for (const layer of recipe.layers) {
    if (!layer.enabled || !(layer.opacity > 0)) continue;
    const def = getLayerDefinition(layer.type);
    if (!def) continue;
    const report = def.seamless(normalizeLayerParameters(def, layer.parameters).parameters);
    for (const message of report.seams) seams.push({ layerId: layer.id, layerName: layer.name, message });
    for (const message of report.notes) notes.push({ layerId: layer.id, layerName: layer.name, message });
  }
  return { seams, notes };
}

/** Change only the settings that cause seams (e.g. gradient → solid, glass edges off). */
export function fixSeamlessSeams(recipe: Recipe): Recipe {
  let changed = false;
  const layers = recipe.layers.map((layer) => {
    const def = getLayerDefinition(layer.type);
    if (!def?.makeSeamless || !layer.enabled) return layer;
    const params = normalizeLayerParameters(def, layer.parameters).parameters;
    if (def.seamless(params).seams.length === 0) return layer;
    changed = true;
    return { ...layer, parameters: def.makeSeamless(params) };
  });
  return changed ? { ...recipe, layers } : recipe;
}
