import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from './color';
import { getLayerDefinition } from './layers';
import { isParamVisible, type ParamDef, type VariationGroup } from './params';
import { cloneRecipe } from './recipe';
import { createRandom, deriveSeed, normalizeSeed, randomSeed } from './random';
import type { ParamValue, Recipe } from './types';

export type VariationDimension = 'seed' | VariationGroup;

export const VARIATION_DIMENSIONS: readonly { id: VariationDimension; label: string; description: string }[] = [
  { id: 'seed', label: 'Seed', description: 'New random structure, same settings.' },
  { id: 'palette', label: 'Palette / tint', description: 'Shift colors and tints.' },
  { id: 'intensity', label: 'Intensity', description: 'Amounts, contrast and layer opacity.' },
  { id: 'scale', label: 'Scale', description: 'Grain, fiber, thread and feature sizes.' },
  { id: 'structure', label: 'Structure', description: 'Shape-related settings such as directionality or weave.' },
];

/** Supported candidate counts, from cheapest to most expensive. */
export const VARIATION_COUNTS = [4, 8, 12] as const;

export interface VariationOptions {
  count: number;
  dimensions: readonly VariationDimension[];
  /** 0–1: how far parameters may move from their current values. */
  strength: number;
  /** Restrict parameter changes to these layers (all layers when omitted). */
  layerIds?: readonly string[];
  /** Seed for choosing variations; recorded so the batch can be regenerated. */
  variationSeed: number;
}

export interface ParameterChange {
  layerId: string | null;
  layerName: string;
  paramId: string;
  label: string;
  from: ParamValue;
  to: ParamValue;
}

export interface VariationCandidate {
  index: number;
  recipe: Recipe;
  seed: number;
  changes: ParameterChange[];
  /** Short human-readable description of what changed. */
  summary: string;
}

function varyNumber(def: Extract<ParamDef, { kind: 'number' }>, value: number, strength: number, rand: () => number): number {
  const span = (def.max - def.min) * 0.35 * strength;
  let v = value + (rand() * 2 - 1) * span;
  v = Math.min(def.max, Math.max(def.min, v));
  if (def.integer) return Math.round(v);
  // Snap to the parameter's step to keep values tidy and editable.
  const steps = Math.round((v - def.min) / def.step);
  return Math.min(def.max, Math.max(def.min, Number((def.min + steps * def.step).toFixed(6))));
}

function varyColor(hex: string, strength: number, rand: () => number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl.h += (rand() * 2 - 1) * 60 * strength;
  hsl.s = Math.min(1, Math.max(0, hsl.s + (rand() * 2 - 1) * 0.25 * strength));
  hsl.l = Math.min(0.97, Math.max(0.03, hsl.l + (rand() * 2 - 1) * 0.12 * strength));
  return rgbToHex(hslToRgb(hsl));
}

/** Format a parameter value for display, using the definition's unit. */
export function formatParamValue(def: ParamDef | null, value: ParamValue): string {
  if (typeof value === 'number') {
    if (def?.kind === 'number' && def.unit === '%') return `${Math.round(value * 100)}%`;
    const unit = def?.kind === 'number' && def.unit && def.unit !== '%' ? def.unit : '';
    return `${Number(value.toFixed(2))}${unit}`;
  }
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (def?.kind === 'select') return def.options.find((o) => o.value === value)?.label ?? value;
  return value;
}

/**
 * Generate candidate recipes that differ from `recipe` only in the chosen
 * dimensions. Every change is recorded, and unrelated properties are never
 * touched. The same options always produce the same candidates.
 */
export function generateVariations(recipe: Recipe, options: VariationOptions): VariationCandidate[] {
  const count = Math.max(1, Math.min(VARIATION_COUNTS[VARIATION_COUNTS.length - 1] as number, Math.floor(options.count)));
  const strength = Math.min(1, Math.max(0, options.strength));
  const dims = new Set(options.dimensions);
  const layerFilter = options.layerIds ? new Set(options.layerIds) : null;
  const candidates: VariationCandidate[] = [];

  for (let index = 0; index < count; index++) {
    const rand = createRandom(deriveSeed(options.variationSeed, index));
    const next = cloneRecipe(recipe);
    const changes: ParameterChange[] = [];
    const describe: string[] = [];

    if (dims.has('seed')) {
      const seed = normalizeSeed(randomSeed(rand));
      changes.push({ layerId: null, layerName: 'Recipe', paramId: 'seed', label: 'Seed', from: recipe.seed, to: seed });
      describe.push(`seed ${seed}`);
      next.seed = seed;
    }

    for (const layer of next.layers) {
      if (layerFilter && !layerFilter.has(layer.id)) continue;
      const def = getLayerDefinition(layer.type);
      if (!def) continue;
      for (const p of def.params) {
        if (!p.variation || !dims.has(p.variation)) continue;
        if (!isParamVisible(p, layer.parameters)) continue;
        const from = layer.parameters[p.id] as ParamValue;
        let to: ParamValue = from;
        if (p.kind === 'number' && typeof from === 'number') to = varyNumber(p, from, strength, rand);
        else if (p.kind === 'color' && typeof from === 'string') to = varyColor(from, strength, rand);
        else if (p.kind === 'select' && rand() < strength * 0.6) {
          const options = p.options.filter((o) => o.value !== from);
          const pick = options[Math.floor(rand() * options.length)];
          if (pick) to = pick.value;
        }
        if (to !== from) {
          layer.parameters[p.id] = to;
          changes.push({ layerId: layer.id, layerName: layer.name, paramId: p.id, label: p.label, from, to });
          describe.push(`${layer.name}: ${p.label} ${formatParamValue(p, from)} → ${formatParamValue(p, to)}`);
        }
      }
      if (dims.has('intensity')) {
        const from = layer.opacity;
        const to = Math.min(1, Math.max(0.05, Number((from + (rand() * 2 - 1) * 0.3 * strength).toFixed(2))));
        if (to !== from) {
          layer.opacity = to;
          changes.push({ layerId: layer.id, layerName: layer.name, paramId: 'opacity', label: 'Opacity', from, to });
          describe.push(`${layer.name}: Opacity ${Math.round(from * 100)}% → ${Math.round(to * 100)}%`);
        }
      }
    }

    candidates.push({
      index,
      recipe: next,
      seed: next.seed,
      changes,
      summary: describe.length > 0 ? describe.join('; ') : 'No changes for the selected dimensions',
    });
  }
  return candidates;
}

/**
 * "New variation": changes only the recipe seed. Every other property stays
 * exactly as it was.
 */
export function withNewSeed(recipe: Recipe, seed: number = randomSeed()): Recipe {
  const next = cloneRecipe(recipe);
  next.seed = normalizeSeed(seed);
  return next;
}
