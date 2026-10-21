import { hexToRgb, hslToRgb, luma, normalizeHex, rgbToHex, rgbToHsl } from './color';
import { getLayerDefinition } from './layers';
import { METAL_COLORS } from './layers/metallic';
import { cloneRecipe } from './recipe';
import type { ParameterChange } from './variations';
import type { Recipe } from './types';

export interface Palette {
  id: string;
  name: string;
  colors: readonly string[];
}

/** Starter palettes; users can also enter their own brand colors. */
export const BUILT_IN_PALETTES: readonly Palette[] = [
  { id: 'warm-neutrals', name: 'Warm neutrals', colors: ['#2B2420', '#8C735B', '#D9C3A5', '#F4ECE1'] },
  { id: 'ocean', name: 'Ocean', colors: ['#0B1F33', '#1D5C8A', '#4FB3C8', '#E3F4F7'] },
  { id: 'sunset', name: 'Sunset', colors: ['#2E1437', '#B23A48', '#F28F3B', '#FFD6A5'] },
  { id: 'forest', name: 'Forest', colors: ['#14261C', '#2F5D3A', '#8DB580', '#E8EFD9'] },
  { id: 'mono', name: 'Monochrome', colors: ['#111111', '#555555', '#AAAAAA', '#F2F2F2'] },
  { id: 'lilac', name: 'Lilac', colors: ['#1F1735', '#5B4FE0', '#B7A9F7', '#F3EFFE'] },
];

export const PALETTE_LIMITS = { min: 1, max: 8 } as const;

interface ColorSlot {
  layerIndex: number;
  paramId: string;
  label: string;
  value: string;
  /** Metal presets become a custom alloy color when recolored. */
  metal?: boolean;
}

function colorSlots(recipe: Recipe, layerIds?: readonly string[]): ColorSlot[] {
  const slots: ColorSlot[] = [];
  recipe.layers.forEach((layer, layerIndex) => {
    if (!layer.enabled || (layerIds && !layerIds.includes(layer.id))) return;
    const def = getLayerDefinition(layer.type);
    if (!def) return;
    for (const p of def.params) {
      if (p.kind === 'color') {
        // Skip colors hidden by the current settings (e.g. a gradient's second color on a solid fill).
        if (p.visibleWhen && !p.visibleWhen.equals.includes(layer.parameters[p.visibleWhen.param] as never)) continue;
        slots.push({ layerIndex, paramId: p.id, label: p.label, value: String(layer.parameters[p.id]) });
      }
    }
    if (layer.type === 'metallic' && layer.parameters.metal !== 'custom') {
      const base = METAL_COLORS[String(layer.parameters.metal)];
      if (base) slots.push({ layerIndex, paramId: 'tint', label: 'Alloy color', value: base, metal: true });
    }
  });
  return slots;
}

export interface PaletteResult {
  recipe: Recipe;
  changes: ParameterChange[];
}

/**
 * Recolor compatible layers with a palette. Colors are matched by lightness
 * rank: the recipe's darkest color takes the palette's darkest, its lightest
 * the lightest, so light/dark structure (and legibility) is preserved.
 * `strength` blends from the original (0) to the palette color (1).
 */
export function applyPalette(
  recipe: Recipe,
  paletteColors: readonly string[],
  options: { strength?: number; layerIds?: readonly string[] } = {},
): PaletteResult {
  const palette = paletteColors
    .map((c) => normalizeHex(c))
    .filter((c): c is string => c !== null)
    .slice(0, PALETTE_LIMITS.max)
    .sort((a, b) => luma(hexToRgb(a)) - luma(hexToRgb(b)));
  const strength = Math.min(1, Math.max(0, options.strength ?? 1));
  const slots = colorSlots(recipe, options.layerIds);
  if (palette.length === 0 || slots.length === 0 || strength === 0) return { recipe, changes: [] };

  const ranked = [...slots].sort((a, b) => luma(hexToRgb(a.value)) - luma(hexToRgb(b.value)));
  const next = cloneRecipe(recipe);
  const changes: ParameterChange[] = [];
  ranked.forEach((slot, rank) => {
    const position = ranked.length === 1 ? 0.5 : rank / (ranked.length - 1);
    const target = palette[Math.round(position * (palette.length - 1))] as string;
    const from = hexToRgb(slot.value);
    const to = hexToRgb(target);
    const mixed = rgbToHex([from[0] + (to[0] - from[0]) * strength, from[1] + (to[1] - from[1]) * strength, from[2] + (to[2] - from[2]) * strength]);
    const layer = next.layers[slot.layerIndex];
    if (!layer || mixed === slot.value) return;
    const before = slot.metal ? String(layer.parameters.metal) : slot.value;
    if (slot.metal) layer.parameters.metal = 'custom';
    layer.parameters[slot.paramId] = mixed;
    changes.push({ layerId: layer.id, layerName: layer.name, paramId: slot.paramId, label: slot.label, from: before, to: mixed });
  });
  return { recipe: next, changes };
}

/** Distinct colors currently used by a recipe's visible layers, darkest first. */
export function recipeColors(recipe: Recipe): string[] {
  const unique = [...new Set(colorSlots(recipe).map((s) => normalizeHex(s.value) ?? s.value))];
  return unique.sort((a, b) => luma(hexToRgb(a)) - luma(hexToRgb(b)));
}

/** Rotate every color's hue (a quick "same look, different color" shift). */
export function shiftHue(recipe: Recipe, degrees: number): Recipe {
  const next = cloneRecipe(recipe);
  for (const slot of colorSlots(recipe)) {
    const layer = next.layers[slot.layerIndex];
    if (!layer) continue;
    const hsl = rgbToHsl(hexToRgb(slot.value));
    hsl.h += degrees;
    if (slot.metal) layer.parameters.metal = 'custom';
    layer.parameters[slot.paramId] = rgbToHex(hslToRgb(hsl));
  }
  return next;
}
