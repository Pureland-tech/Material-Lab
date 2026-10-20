import { describe, expect, it } from 'vitest';
import { cloneRecipe, createLayer, createRecipe, findContextSplit, LAYER_TYPE_ORDER, renderComposite, renderRecipe, RenderCancelledError, type LayerType } from '../src';
import { hashBytes, sampleRecipe } from './helpers';

const SIZE = { width: 96, height: 64 };

function recipeWith(type: LayerType) {
  const layers = type === 'glass' ? [createLayer('liquid', { seedOffset: 3 }), createLayer('glass', { seedOffset: 9 })] : [createLayer(type, { seedOffset: 5 })];
  return createRecipe({ seed: 1234, width: 96, height: 64, layers, now: new Date(0) });
}

describe('renderRecipe', () => {
  it('produces RGBA output of the requested size', () => {
    const r = renderRecipe(sampleRecipe(), SIZE);
    expect(r.width).toBe(96);
    expect(r.height).toBe(64);
    expect(r.data.length).toBe(96 * 64 * 4);
  });

  it('is deterministic for the same recipe, seed and options', () => {
    const a = renderRecipe(sampleRecipe(), SIZE);
    const b = renderRecipe(sampleRecipe(), SIZE);
    expect(hashBytes(a.data)).toBe(hashBytes(b.data));
  });

  it('changes when the seed changes', () => {
    const recipe = sampleRecipe();
    const other = cloneRecipe(recipe);
    other.seed += 1;
    expect(hashBytes(renderRecipe(recipe, SIZE).data)).not.toBe(hashBytes(renderRecipe(other, SIZE).data));
  });

  for (const type of LAYER_TYPE_ORDER) {
    it(`renders ${type} identically regardless of band and row partitioning`, () => {
      const recipe = recipeWith(type);
      const full = renderRecipe(recipe, SIZE);
      const banded = renderRecipe(recipe, { ...SIZE, bandRows: 7 });
      expect(hashBytes(banded.data)).toBe(hashBytes(full.data));
      // Rows rendered separately (as parallel workers do) and stitched together.
      const top = renderRecipe(recipe, { ...SIZE, rows: { start: 0, end: 23 } });
      const bottom = renderRecipe(recipe, { ...SIZE, rows: { start: 23, end: 64 }, bandRows: 5 });
      const stitched = new Uint8ClampedArray(full.data.length);
      stitched.set(top.data, 0);
      stitched.set(bottom.data, top.data.length);
      expect(hashBytes(stitched)).toBe(hashBytes(full.data));
    });
  }

  it('renders identically from a precomputed composite of the layers beneath glass', () => {
    const recipe = recipeWith('glass');
    recipe.layers.push(createLayer('grain', { seedOffset: 21 }));
    const full = renderRecipe(recipe, SIZE);
    const split = findContextSplit(recipe, 1)!;
    expect(split.layerCount).toBe(1);
    // Phase 1: the layers beneath the glass, rendered once in two row ranges.
    const below = new Float32Array(SIZE.width * SIZE.height * 4);
    below.set(renderComposite(recipe, { ...SIZE, pixelRatio: 1, rows: { start: 0, end: 30 }, layerCount: 1 }), 0);
    below.set(renderComposite(recipe, { ...SIZE, pixelRatio: 1, rows: { start: 30, end: 64 }, layerCount: 1 }), 30 * SIZE.width * 4);
    // Phase 2: each chunk gets the rows it needs (its range plus the margin).
    const chunk = (start: number, end: number) => {
      const y0 = Math.max(0, start - split.margin);
      const y1 = Math.min(SIZE.height, end + split.margin);
      return renderRecipe(recipe, {
        ...SIZE,
        rows: { start, end },
        below: { data: below.slice(y0 * SIZE.width * 4, y1 * SIZE.width * 4), y0, y1, layerCount: split.layerCount },
      }).data;
    };
    const stitched = new Uint8ClampedArray(full.data.length);
    stitched.set(chunk(0, 20), 0);
    stitched.set(chunk(20, 64), 20 * SIZE.width * 4);
    expect(hashBytes(stitched)).toBe(hashBytes(full.data));
  });

  it('ignores disabled and zero-opacity layers', () => {
    const recipe = sampleRecipe();
    const baseOnly = cloneRecipe(recipe);
    baseOnly.layers = baseOnly.layers.slice(0, 1);
    const disabled = cloneRecipe(recipe);
    disabled.layers[1]!.enabled = false;
    disabled.layers[2]!.opacity = 0;
    expect(hashBytes(renderRecipe(disabled, SIZE).data)).toBe(hashBytes(renderRecipe(baseOnly, SIZE).data));
  });

  it('skips unsupported layers with a warning', () => {
    const recipe = sampleRecipe();
    recipe.layers.push({ id: 'x', type: 'future-foil', name: 'Foil', enabled: true, opacity: 1, blendMode: 'normal', seedOffset: 1, parameters: {} });
    const r = renderRecipe(recipe, SIZE);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]?.code).toBe('unsupported-layer');
    expect(hashBytes(r.data)).toBe(hashBytes(renderRecipe(sampleRecipe(), SIZE).data));
  });

  it('keeps transparency only when asked', () => {
    const recipe = createRecipe({
      seed: 3,
      transparentBackground: true,
      layers: [createLayer('noise', { parameters: { alphaOutput: true, colorB: '#000000' } })],
    });
    const transparent = renderRecipe(recipe, SIZE);
    const alphas = new Set<number>();
    for (let i = 3; i < transparent.data.length; i += 4) alphas.add(transparent.data[i] as number);
    expect(alphas.size).toBeGreaterThan(10);
    const flat = renderRecipe(recipe, { ...SIZE, transparent: false, background: '#FFFFFF' });
    for (let i = 3; i < flat.data.length; i += 4) expect(flat.data[i]).toBe(255);
  });

  it('renders an empty recipe as fully transparent', () => {
    const r = renderRecipe(createRecipe({ seed: 1 }), { ...SIZE, transparent: true });
    expect(r.data.every((v) => v === 0)).toBe(true);
  });

  it('keeps the same overall look at a higher export scale', () => {
    // Preview/export consistency: a 2× render averages to the same colors as 1×.
    const recipe = recipeWith('liquid');
    const one = renderRecipe(recipe, SIZE);
    const two = renderRecipe(recipe, { width: SIZE.width * 2, height: SIZE.height * 2, pixelRatio: 2 });
    const mean = (d: Uint8ClampedArray) => {
      const m = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) m[c]! += d[i + c] as number;
      return m.map((v) => v / (d.length / 4));
    };
    const a = mean(one.data);
    const b = mean(two.data);
    for (let c = 0; c < 3; c++) expect(Math.abs(a[c]! - b[c]!)).toBeLessThan(3);
  });

  it('reports progress and supports cancellation', () => {
    const progress: number[] = [];
    renderRecipe(sampleRecipe(), { ...SIZE, bandRows: 16, onProgress: (p) => progress.push(p) });
    expect(progress).toEqual([0.25, 0.5, 0.75, 1]);
    let calls = 0;
    expect(() => renderRecipe(sampleRecipe(), { ...SIZE, bandRows: 16, shouldCancel: () => ++calls > 2 })).toThrow(RenderCancelledError);
  });

  it('rejects invalid sizes', () => {
    expect(() => renderRecipe(sampleRecipe(), { width: 0, height: 10 })).toThrow(RangeError);
    expect(() => renderRecipe(sampleRecipe(), { width: 9000, height: 10 })).toThrow(RangeError);
  });
});
