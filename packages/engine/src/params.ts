import type { BlendMode, FamilyId, LayerParameters, LayerType, ParamValue } from './types';

/** Properties panel sections, in display order. */
export const PARAM_SECTIONS = ['appearance', 'structure', 'color', 'lighting', 'advanced'] as const;
export type ParamSection = (typeof PARAM_SECTIONS)[number];

export const PARAM_SECTION_LABELS: Record<ParamSection, string> = {
  appearance: 'Appearance',
  structure: 'Structure',
  color: 'Color',
  lighting: 'Lighting',
  advanced: 'Advanced',
};

/**
 * Which "Create variations" dimension a parameter belongs to. Parameters
 * without a group never change during variation.
 */
export type VariationGroup = 'palette' | 'intensity' | 'scale' | 'structure';

interface ParamBase {
  id: string;
  label: string;
  section: ParamSection;
  /** Short helper text for technical terms (shown as a tooltip/description). */
  help?: string;
  variation?: VariationGroup;
  /** Only show (and apply) this control when another parameter has one of these values. */
  visibleWhen?: { param: string; equals: readonly ParamValue[] };
}

export interface NumberParamDef extends ParamBase {
  kind: 'number';
  min: number;
  max: number;
  step: number;
  default: number;
  /** `%` values are stored as 0–1 and displayed ×100. */
  unit?: 'px' | '%' | '°' | '×';
  /** Display/entry precision when unit is not `%`. */
  integer?: boolean;
}

export interface ColorParamDef extends ParamBase {
  kind: 'color';
  default: string;
}

export interface BooleanParamDef extends ParamBase {
  kind: 'boolean';
  default: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectParamDef extends ParamBase {
  kind: 'select';
  options: readonly SelectOption[];
  default: string;
}

export type ParamDef = NumberParamDef | ColorParamDef | BooleanParamDef | SelectParamDef;

/** Premultiplied RGBA rows from the layers beneath, for layers that sample them. */
export interface BelowBuffer {
  data: Float32Array;
  /** First row (inclusive) held in `data`. */
  y0: number;
  /** Last row (exclusive) held in `data`. */
  y1: number;
}

export interface LayerRenderContext {
  /** Output size in device pixels. */
  width: number;
  height: number;
  /** Device pixels per logical px. Features are sized in logical px. */
  pixelRatio: number;
  /** Band of rows to render, [y0, y1). */
  y0: number;
  y1: number;
  /** Seed for this layer (recipe seed combined with the layer's seed offset). */
  seed: number;
  /** Parameters already validated and normalized against the definition. */
  params: LayerParameters;
  /** Content beneath this layer; only provided to layers that declare a margin. */
  below: BelowBuffer | null;
}

export interface LayerDefinition {
  type: LayerType;
  /** Texture family this layer belongs to; null for utility layers. */
  family: FamilyId | null;
  label: string;
  description: string;
  params: readonly ParamDef[];
  defaultBlendMode: BlendMode;
  defaultOpacity: number;
  /** The look depends on what is underneath (e.g. glass blurs the layers below). */
  backgroundDependent?: boolean;
  /** Honest note about what the effect is (and is not), shown in the UI. */
  note?: string;
  /** True when this layer, at full opacity, makes every pixel opaque. */
  coversCanvas(params: LayerParameters): boolean;
  /**
   * Rows of context (device px) needed from the layers below, above and below
   * the band. Layers that return > 0 receive `below`.
   */
  margin?(params: LayerParameters, pixelRatio: number): number;
  /** Write straight-alpha RGBA (0–1) for rows [y0, y1) into `out`. */
  render(ctx: LayerRenderContext, out: Float32Array): void;
}

export function isParamVisible(def: ParamDef, params: LayerParameters): boolean {
  if (!def.visibleWhen) return true;
  const value = params[def.visibleWhen.param];
  return def.visibleWhen.equals.includes(value as ParamValue);
}

export function defaultParameters(params: readonly ParamDef[]): LayerParameters {
  const out: LayerParameters = {};
  for (const p of params) out[p.id] = p.default;
  return out;
}
