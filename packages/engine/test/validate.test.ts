import { describe, expect, it } from 'vitest';
import { parseRecipeJson, RECIPE_LIMITS, SCHEMA_VERSION, validateRecipe } from '../src';
import { sampleRecipe } from './helpers';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('validateRecipe', () => {
  it('accepts a well-formed recipe unchanged', () => {
    const recipe = sampleRecipe();
    const result = validateRecipe(clone(recipe));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.recipe).toEqual(recipe);
  });

  it('accepts the example recipe from the PRD (blend modes and other fields default)', () => {
    const prdExample = {
      schemaVersion: 1,
      recipeId: 'recipe_local_01',
      name: 'Warm recycled paper',
      family: 'paper',
      engineVersion: '1.0.0',
      seed: 482913,
      canvas: { width: 1600, height: 1000, colorSpace: 'sRGB', transparentBackground: false },
      layers: [
        { id: 'layer_base', type: 'base-color', name: 'Warm base', enabled: true, opacity: 1, parameters: { color: '#E8D9BD' } },
        {
          id: 'layer_paper',
          type: 'paper-fiber',
          name: 'Paper fibers',
          enabled: true,
          opacity: 0.65,
          seedOffset: 15,
          parameters: { fiberDensity: 0.42, fiberScale: 0.55, speckleAmount: 0.18, warmth: 0.7, roughness: 0.38 },
        },
        { id: 'layer_grain', type: 'grain', name: 'Fine grain', enabled: true, opacity: 0.2, seedOffset: 31, parameters: { amount: 0.12, scale: 0.34, monochrome: true } },
      ],
      exportDefaults: { format: 'png', width: 1600, height: 1000, seamless: false },
      metadata: { createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' },
    };
    const result = validateRecipe(prdExample);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.layers.map((l) => l.blendMode)).toEqual(['normal', 'normal', 'overlay']);
    // The base layer had no seed offset: one is assigned explicitly.
    expect(result.recipe.layers[0]?.seedOffset).toBe(17);
    // `scale` is not a grain parameter (grain uses `size`): dropped with a warning.
    expect(result.warnings.some((w) => w.code === 'unknown-parameters' && w.path === 'layers[2].parameters')).toBe(true);
    expect(result.recipe.layers[1]?.parameters.fiberDensity).toBe(0.42);
  });

  it('rejects non-objects and missing essentials', () => {
    expect(validateRecipe(null).ok).toBe(false);
    expect(validateRecipe([]).ok).toBe(false);
    expect(validateRecipe('recipe').ok).toBe(false);
    const noSeed = clone(sampleRecipe()) as unknown as Record<string, unknown>;
    delete noSeed.seed;
    const r = validateRecipe(noSeed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('invalid-seed');
    const noLayers = { ...clone(sampleRecipe()), layers: 'nope' };
    expect(validateRecipe(noLayers).ok).toBe(false);
  });

  it('rejects recipes from a newer schema', () => {
    const r = validateRecipe({ ...clone(sampleRecipe()), schemaVersion: SCHEMA_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('newer-schema');
  });

  it('enforces the layer limit', () => {
    const recipe = clone(sampleRecipe());
    const layer = recipe.layers[0]!;
    recipe.layers = Array.from({ length: RECIPE_LIMITS.maxLayers + 1 }, (_, i) => ({ ...layer, id: `l${i}` }));
    const r = validateRecipe(recipe);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('too-many-layers');
  });

  it('clamps out-of-range values with warnings', () => {
    const recipe = clone(sampleRecipe());
    recipe.layers[1]!.parameters.fiberDensity = 7;
    recipe.layers[1]!.opacity = 3;
    recipe.canvas.width = 99999;
    const r = validateRecipe(recipe);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.layers[1]!.parameters.fiberDensity).toBe(1);
    expect(r.recipe.layers[1]!.opacity).toBe(1);
    expect(r.recipe.canvas.width).toBe(RECIPE_LIMITS.maxCanvasSide);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['out-of-range']));
  });

  it('keeps unsupported layers (with a warning) instead of failing', () => {
    const recipe = clone(sampleRecipe()) as unknown as { layers: Record<string, unknown>[] };
    recipe.layers.push({ id: 'future', type: 'holographic-foil', name: 'Foil', enabled: true, opacity: 1, seedOffset: 3, parameters: { shimmer: 0.4, nested: { a: 1 } } });
    const r = validateRecipe(recipe);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const foil = r.recipe.layers.find((l) => l.id === 'future');
    expect(foil?.type).toBe('holographic-foil');
    expect(foil?.parameters).toEqual({ shimmer: 0.4 });
    expect(r.warnings.some((w) => w.code === 'unsupported-layer')).toBe(true);
  });

  it('drops unknown and dangerous fields without executing anything', () => {
    const payload = JSON.parse(
      `{"schemaVersion":1,"recipeId":"r1","name":"x","family":"noise","engineVersion":"1.0.0","seed":1,
        "canvas":{"width":100,"height":100},"evil":"function(){}",
        "layers":[{"id":"a","type":"future-layer","name":"n","seedOffset":1,"parameters":{"__proto__":{"polluted":true},"constructor":1,"ok":2}}]}`,
    );
    const r = validateRecipe(payload);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('evil' in r.recipe).toBe(false);
    expect(r.recipe.layers[0]?.parameters).toEqual({ ok: 2 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('cleans names and replaces invalid or duplicate ids', () => {
    const recipe = clone(sampleRecipe());
    recipe.name = '   Hello\u0000   world  ';
    recipe.layers[1]!.id = recipe.layers[0]!.id;
    recipe.recipeId = 'bad id with spaces';
    const r = validateRecipe(recipe);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recipe.name).toBe('Hello world');
    expect(r.recipe.layers[1]!.id).not.toBe(r.recipe.layers[0]!.id);
    expect(r.recipe.recipeId).toMatch(/^recipe_/);
  });

  it('warns when a recipe was made with a different major engine version', () => {
    const r = validateRecipe({ ...clone(sampleRecipe()), engineVersion: '2.0.0' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.code === 'engine-version-mismatch')).toBe(true);
  });
});

describe('parseRecipeJson', () => {
  it('rejects invalid JSON', () => {
    const r = parseRecipeJson('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('invalid-json');
  });

  it('rejects oversized input before parsing', () => {
    const r = parseRecipeJson(`{"x":"${'a'.repeat(RECIPE_LIMITS.maxJsonBytes)}"}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe('too-large');
  });

  it('round-trips a recipe', () => {
    const recipe = sampleRecipe();
    const r = parseRecipeJson(JSON.stringify(recipe));
    expect(r.ok && r.recipe).toEqual(recipe);
  });
});
