import { describe, expect, it } from 'vitest';
import {
  analyzeSeamless,
  cloneRecipe,
  createLayer,
  createRecipe,
  fixSeamlessSeams,
  LAYER_TYPE_ORDER,
  PRESETS,
  renderRecipe,
  setSeamless,
  type LayerType,
  type Recipe,
} from '../src';

const W = 64;
const H = 48;

function recipeFor(type: LayerType): Recipe {
  const layers =
    type === 'glass'
      ? [createLayer('liquid', { seedOffset: 3, parameters: { swirlScale: 40 } }), createLayer('glass', { seedOffset: 9 })]
      : [createLayer(type, { seedOffset: 5 })];
  return fixSeamlessSeams(createRecipe({ seed: 99, width: W, height: H, layers, now: new Date(0) }));
}

/** Render 2×2 tiles in one image and compare each quadrant with the first. */
function quadrantMismatch(recipe: Recipe): { maxDiff: number; fraction: number } {
  const r = renderRecipe(recipe, { width: W * 2, height: H * 2, pixelRatio: 1, tile: { width: W, height: H } });
  let maxDiff = 0;
  let differing = 0;
  let total = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = (y * W * 2 + x) * 4;
      for (const [ox, oy] of [
        [W, 0],
        [0, H],
        [W, H],
      ] as const) {
        const b = ((y + oy) * W * 2 + x + ox) * 4;
        for (let c = 0; c < 4; c++) {
          const d = Math.abs((r.data[a + c] as number) - (r.data[b + c] as number));
          if (d > 0) differing++;
          if (d > maxDiff) maxDiff = d;
          total++;
        }
      }
    }
  }
  return { maxDiff, fraction: differing / total };
}

/** Mean absolute difference across the wrap-around seam vs between neighbouring interior columns. */
function seamRatio(recipe: Recipe): number {
  const r = renderRecipe(recipe, { width: W, height: H, pixelRatio: 1, tile: true });
  const at = (x: number, y: number, c: number) => r.data[(y * W + x) * 4 + c] as number;
  let seam = 0;
  let interior = 0;
  for (let y = 0; y < H; y++) {
    for (let c = 0; c < 3; c++) {
      seam += Math.abs(at(W - 1, y, c) - at(0, y, c));
      for (let x = 0; x < W - 1; x++) interior += Math.abs(at(x, y, c) - at(x + 1, y, c)) / (W - 1);
    }
  }
  return seam / Math.max(1, interior);
}

describe('seamless tiles', () => {
  for (const type of LAYER_TYPE_ORDER) {
    it(`${type} repeats exactly with the tile period`, () => {
      const { maxDiff, fraction } = quadrantMismatch(recipeFor(type));
      // Floating-point rounding may flip an occasional 8-bit value.
      expect(maxDiff).toBeLessThanOrEqual(1);
      expect(fraction).toBeLessThan(0.01);
    });
  }

  it('has no stronger edge across the seam than inside the tile', () => {
    for (const preset of PRESETS) {
      const recipe = fixSeamlessSeams(cloneRecipe(preset.recipe));
      recipe.canvas = { ...recipe.canvas, width: W, height: H };
      const ratio = seamRatio(recipe);
      expect(ratio, preset.id).toBeLessThan(2.5);
    }
  });

  it('reports settings that would seam and fixes only those', () => {
    const recipe = createRecipe({
      layers: [
        createLayer('base-color', { id: 'base', parameters: { fill: 'linear' } }),
        createLayer('glass', { id: 'glass', parameters: { inset: 100 } }),
        createLayer('liquid', { id: 'liquid', parameters: { flowAngle: 30 } }),
      ],
    });
    const before = analyzeSeamless(recipe);
    expect(before.seams.map((s) => s.layerId).sort()).toEqual(['base', 'glass', 'glass', 'glass']);
    expect(before.notes.some((n) => n.layerId === 'liquid')).toBe(true);
    const fixed = fixSeamlessSeams(recipe);
    expect(analyzeSeamless(fixed).seams).toEqual([]);
    expect(fixed.layers[2]).toEqual(recipe.layers[2]);
    expect(fixed.layers[0]?.parameters.color).toBe(recipe.layers[0]?.parameters.color);
  });

  it('locks exports to the canvas size when seamless is on', () => {
    const recipe = createRecipe({ width: 512, height: 256 });
    recipe.exportDefaults.width = 1920;
    const tiled = setSeamless(recipe, true);
    expect(tiled.exportDefaults).toMatchObject({ seamless: true, width: 512, height: 256 });
  });

  it('leaves plain renders unchanged when tiling is off', () => {
    const recipe = recipeFor('noise');
    const a = renderRecipe(recipe, { width: W, height: H });
    const b = renderRecipe(recipe, { width: W, height: H, tile: false });
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });
});
