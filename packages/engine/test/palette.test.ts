import { describe, expect, it } from 'vitest';
import { applyPalette, createLayer, createRecipe, getPreset, hexToRgb, instantiatePreset, luma, recipeColors, shiftHue } from '../src';

describe('palette recoloring', () => {
  it('maps colors by lightness rank and records each change', () => {
    const recipe = instantiatePreset(getPreset('liquid-ink-marble')!);
    const palette = ['#F4ECE1', '#2B2420', '#8C735B'];
    const { recipe: next, changes } = applyPalette(recipe, palette);
    const layer = next.layers[0]!;
    // Darkest original (colorA) → darkest palette color; lightest (colorC) → lightest.
    expect(layer.parameters.colorA).toBe('#2B2420');
    expect(layer.parameters.colorC).toBe('#F4ECE1');
    expect(changes.length).toBe(3);
    // Non-color parameters are untouched.
    expect(layer.parameters.distortion).toBe(recipe.layers[0]!.parameters.distortion);
  });

  it('keeps the original order of lightness', () => {
    const recipe = instantiatePreset(getPreset('liquid-iridescent')!);
    const before = recipeColors(recipe);
    const after = applyPalette(recipe, ['#0B1F33', '#1D5C8A', '#4FB3C8', '#E3F4F7']).recipe;
    const layer = after.layers[0]!;
    const lumas = before.map((hex) => {
      const key = Object.keys(recipe.layers[0]!.parameters).find((k) => recipe.layers[0]!.parameters[k] === hex)!;
      return luma(hexToRgb(String(layer.parameters[key])));
    });
    for (let i = 1; i < lumas.length; i++) expect(lumas[i]!).toBeGreaterThanOrEqual(lumas[i - 1]!);
  });

  it('turns metal presets into a custom alloy color', () => {
    const recipe = instantiatePreset(getPreset('metal-champagne-gold')!);
    const { recipe: next } = applyPalette(recipe, ['#4FB3C8']);
    expect(next.layers[0]!.parameters.metal).toBe('custom');
    expect(next.layers[0]!.parameters.tint).toBe('#4FB3C8');
  });

  it('blends by strength, can target selected layers, and ignores invalid colors', () => {
    const recipe = createRecipe({
      layers: [createLayer('base-color', { id: 'a', parameters: { color: '#000000' } }), createLayer('noise', { id: 'b' })],
    });
    const half = applyPalette(recipe, ['#FFFFFF', 'not-a-color'], { strength: 0.5, layerIds: ['a'] });
    expect(half.recipe.layers[0]!.parameters.color).toBe('#808080');
    expect(half.recipe.layers[1]).toEqual(recipe.layers[1]);
    expect(applyPalette(recipe, ['nope']).changes).toEqual([]);
  });

  it('shifts hue without changing anything else', () => {
    const recipe = createRecipe({ layers: [createLayer('base-color', { parameters: { color: '#FF0000' } })] });
    expect(shiftHue(recipe, 120).layers[0]!.parameters.color).toBe('#00FF00');
  });
});
