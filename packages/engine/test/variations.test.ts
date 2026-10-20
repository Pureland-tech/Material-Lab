import { describe, expect, it } from 'vitest';
import { generateVariations, getLayerDefinition, withNewSeed } from '../src';
import { sampleRecipe } from './helpers';

describe('variations', () => {
  it('"New variation" changes only the seed', () => {
    const recipe = sampleRecipe();
    const next = withNewSeed(recipe, 99);
    expect(next.seed).toBe(99);
    expect({ ...next, seed: recipe.seed }).toEqual(recipe);
  });

  it('is deterministic for the same variation seed', () => {
    const recipe = sampleRecipe();
    const opts = { count: 4, dimensions: ['seed', 'palette'] as const, strength: 0.5, variationSeed: 7 };
    expect(generateVariations(recipe, opts)).toEqual(generateVariations(recipe, opts));
    expect(generateVariations(recipe, { ...opts, variationSeed: 8 })).not.toEqual(generateVariations(recipe, opts));
  });

  it('only changes parameters in the selected dimensions, and records every change', () => {
    const recipe = sampleRecipe();
    const candidates = generateVariations(recipe, { count: 8, dimensions: ['palette'], strength: 1, variationSeed: 3 });
    expect(candidates).toHaveLength(8);
    for (const c of candidates) {
      expect(c.seed).toBe(recipe.seed);
      c.recipe.layers.forEach((layer, i) => {
        const original = recipe.layers[i]!;
        expect(layer.opacity).toBe(original.opacity);
        const def = getLayerDefinition(layer.type)!;
        for (const p of def.params) {
          const changed = layer.parameters[p.id] !== original.parameters[p.id];
          if (changed) {
            expect(p.variation).toBe('palette');
            expect(c.changes.some((ch) => ch.layerId === layer.id && ch.paramId === p.id)).toBe(true);
          }
        }
      });
    }
    expect(candidates.some((c) => c.changes.length > 0)).toBe(true);
  });

  it('can restrict changes to selected layers', () => {
    const recipe = sampleRecipe();
    const candidates = generateVariations(recipe, { count: 4, dimensions: ['intensity'], strength: 1, layerIds: ['layer_grain'], variationSeed: 1 });
    for (const c of candidates) {
      expect(c.recipe.layers[0]).toEqual(recipe.layers[0]);
      expect(c.recipe.layers[1]).toEqual(recipe.layers[1]);
      expect(c.changes.every((ch) => ch.layerId === 'layer_grain')).toBe(true);
    }
  });

  it('keeps numeric values within their ranges', () => {
    const candidates = generateVariations(sampleRecipe(), { count: 12, dimensions: ['intensity', 'scale', 'structure'], strength: 1, variationSeed: 11 });
    for (const c of candidates) {
      for (const layer of c.recipe.layers) {
        const def = getLayerDefinition(layer.type)!;
        for (const p of def.params) {
          if (p.kind !== 'number') continue;
          const v = layer.parameters[p.id] as number;
          expect(v).toBeGreaterThanOrEqual(p.min);
          expect(v).toBeLessThanOrEqual(p.max);
        }
      }
    }
  });
});
