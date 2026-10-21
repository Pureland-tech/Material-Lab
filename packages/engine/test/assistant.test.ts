import { describe, expect, it } from 'vitest';
import {
  isSeamless,
  LAYER_TYPES,
  recipeFromSpec,
  renderRecipe,
  suggestLocally,
  suggestionFromSpec,
  textureSpecInstructions,
  textureSpecSchema,
  validateRecipe,
} from '../src';

const NOW = new Date('2026-10-21T00:00:00Z');

/** Walk a schema and collect keywords structured outputs do not accept. */
function unsupportedKeywords(node: unknown, path = '$'): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => unsupportedKeywords(n, `${path}[${i}]`));
  if (typeof node !== 'object' || node === null) return [];
  const found: string[] = [];
  const obj = node as Record<string, unknown>;
  for (const key of ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems']) {
    if (key in obj) found.push(`${path}.${key}`);
  }
  if (obj.type === 'object' && obj.additionalProperties !== false) found.push(`${path}: object without additionalProperties:false`);
  for (const [k, v] of Object.entries(obj)) if (k !== 'enum' && k !== 'const') found.push(...unsupportedKeywords(v, `${path}.${k}`));
  return found;
}

describe('text-to-recipe', () => {
  it('builds a schema with one variant per layer type and only supported keywords', () => {
    const schema = textureSpecSchema() as { properties: { layers: { items: { anyOf: unknown[] } } } };
    expect(schema.properties.layers.items.anyOf).toHaveLength(LAYER_TYPES.length);
    expect(unsupportedKeywords(schema)).toEqual([]);
    expect(textureSpecInstructions()).toContain('paper-fiber');
  });

  it('turns a spec into a valid recipe, clamping and dropping bad values', () => {
    const recipe = recipeFromSpec(
      {
        name: 'Warm paper',
        explanation: 'A warm recycled paper.',
        transparentBackground: false,
        seamless: false,
        layers: [
          { type: 'paper-fiber', name: 'Paper', opacity: 3, blendMode: 'normal', parameters: { fiberDensity: 99, paperColor: '#d9c3a5', bogus: 1 } },
          { type: 'not-a-layer', name: 'x', opacity: 1, blendMode: 'normal', parameters: {} },
          { type: 'grain', name: 'Grain', opacity: 0.4, blendMode: 'hard-light', parameters: { amount: 'lots', monochrome: true } },
        ],
      },
      { seed: 42, now: NOW },
    );
    expect(validateRecipe(recipe).ok).toBe(true);
    expect(recipe.layers.map((l) => l.type)).toEqual(['paper-fiber', 'grain']);
    expect(recipe.layers[0]!.opacity).toBe(1);
    expect(recipe.layers[1]!.blendMode).toBe('overlay'); // invalid blend falls back to the default
    expect(recipe.layers[0]!.parameters.bogus).toBeUndefined();
    expect(recipe.family).toBe('paper');
    expect(() => recipeFromSpec({ layers: [] })).toThrow();
    expect(() => recipeFromSpec('nope')).toThrow();
  });

  it('honors seamless requests in specs', () => {
    const recipe = recipeFromSpec({ name: 't', explanation: '', transparentBackground: false, seamless: true, layers: [{ type: 'noise', name: 'n', opacity: 1, blendMode: 'normal', parameters: {} }] });
    expect(isSeamless(recipe)).toBe(true);
  });

  it('suggests locally and deterministically from keywords', () => {
    const a = suggestLocally('warm recycled paper with subtle dark fibers', { now: NOW });
    const b = suggestLocally('warm recycled paper with subtle dark fibers', { now: NOW });
    expect(a.source).toBe('local');
    expect(a.recipe.family).toBe('paper');
    expect({ ...a.recipe, recipeId: '' }).toEqual({ ...b.recipe, recipeId: '' });
    expect(validateRecipe(a.recipe).ok).toBe(true);
    expect(a.notes.join(' ')).toMatch(/subtler/);
    expect(a.choices.length).toBeGreaterThan(0);

    expect(suggestLocally('brushed gold metal', { now: NOW }).recipe.family).toBe('metallic');
    expect(suggestLocally('frosted glass panel', { now: NOW }).recipe.family).toBe('glass');
    expect(suggestLocally('navy linen weave', { now: NOW }).recipe.family).toBe('fabric');
    const tile = suggestLocally('seamless topographic pattern', { now: NOW });
    expect(isSeamless(tile.recipe)).toBe(true);
    expect(suggestLocally('zzz qqq', { now: NOW }).notes[0]).toMatch(/No texture words matched/);
  });

  it('renders suggestions', () => {
    const s = suggestLocally('pink marble swirl', { now: NOW });
    const out = renderRecipe(s.recipe, { width: 32, height: 20, pixelRatio: 0.02 });
    expect(out.data.length).toBe(32 * 20 * 4);
    const ai = suggestionFromSpec({ name: 'n', explanation: 'Because.', transparentBackground: false, seamless: false, layers: [{ type: 'liquid', name: 'L', opacity: 1, blendMode: 'normal', parameters: {} }] });
    expect(ai.source).toBe('ai');
    expect(ai.summary).toBe('Because.');
  });
});
