import { describe, expect, it } from 'vitest';
import { FAMILY_IDS, instantiatePreset, PRESETS, searchPresets, validateRecipe } from '../src';

describe('presets', () => {
  it('ship at least two presets for every texture family', () => {
    for (const family of FAMILY_IDS) {
      expect(PRESETS.filter((p) => p.family === family).length, family).toBeGreaterThanOrEqual(2);
    }
  });

  it('have unique ids and valid recipes built from the shared schema', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const preset of PRESETS) {
      const r = validateRecipe(JSON.parse(JSON.stringify(preset.recipe)));
      expect(r.ok, preset.id).toBe(true);
      if (r.ok) expect(r.warnings, preset.id).toEqual([]);
      expect(preset.recipe.metadata.presetId).toBe(preset.id);
    }
  });

  it('opening a preset creates an editable copy and never changes the preset', () => {
    const preset = PRESETS[0]!;
    const before = JSON.stringify(preset.recipe);
    const recipe = instantiatePreset(preset);
    recipe.layers[0]!.opacity = 0.1;
    recipe.name = 'Changed';
    expect(JSON.stringify(preset.recipe)).toBe(before);
    expect(recipe.recipeId).not.toBe(preset.recipe.recipeId);
    expect(recipe.metadata.presetId).toBe(preset.id);
  });

  it('searches by name, family, tag and use case', () => {
    expect(searchPresets('linen').map((p) => p.id)).toContain('fabric-natural-linen');
    expect(searchPresets('', 'metallic').every((p) => p.family === 'metallic')).toBe(true);
    expect(searchPresets('ui background').length).toBeGreaterThan(2);
    expect(searchPresets('subtle paper').map((p) => p.id)).toContain('paper-modern-white');
    expect(searchPresets('zzz-nothing')).toEqual([]);
  });

  it('filters by style, palette and seamless support', () => {
    expect(searchPresets('', { style: 'glossy' }).every((p) => p.style === 'glossy')).toBe(true);
    const dark = searchPresets('', { palette: 'dark' });
    expect(dark.length).toBeGreaterThan(1);
    expect(dark.every((p) => p.palette.includes('dark'))).toBe(true);
    const tiles = searchPresets('', { seamless: true }).map((p) => p.id);
    expect(tiles).toContain('noise-topo-ridges');
    expect(tiles).not.toContain('glass-aurora-panel');
    expect(searchPresets('', { family: 'paper', palette: 'warm' }).map((p) => p.id)).toEqual(['paper-warm-recycled', 'paper-vintage-kraft']);
  });
});
