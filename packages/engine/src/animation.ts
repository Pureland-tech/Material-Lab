import { getLayerDefinition } from './layers';
import type { Recipe } from './types';

export interface MovingLayer {
  layerId: string;
  layerName: string;
  motion: string;
}

/** Visible layers that move in animated exports, and how. */
export function analyzeAnimation(recipe: Recipe): MovingLayer[] {
  const moving: MovingLayer[] = [];
  for (const layer of recipe.layers) {
    if (!layer.enabled || !(layer.opacity > 0)) continue;
    const def = getLayerDefinition(layer.type);
    if (def?.motion) moving.push({ layerId: layer.id, layerName: layer.name, motion: def.motion });
  }
  return moving;
}
