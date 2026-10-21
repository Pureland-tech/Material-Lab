export const FAMILY_IDS = ['glass', 'grain', 'paper', 'metallic', 'fabric', 'noise', 'liquid'] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

/** A recipe's family is one of the texture families, or `custom` for blank compositions. */
export type RecipeFamily = FamilyId | 'custom';

export const LAYER_TYPES = [
  'base-color',
  'glass',
  'grain',
  'paper-fiber',
  'metallic',
  'fabric',
  'noise',
  'liquid',
] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export type ParamValue = number | string | boolean;
export type LayerParameters = Record<string, ParamValue>;

export interface Layer {
  /** Stable identifier, unique within the recipe. */
  id: string;
  /** Layer type. Kept as a string so recipes with unknown types still load (and warn). */
  type: string;
  name: string;
  enabled: boolean;
  /** 0–1 */
  opacity: number;
  blendMode: BlendMode;
  /** Explicit offset combined with the recipe seed for this layer's randomness. */
  seedOffset: number;
  parameters: LayerParameters;
}

export interface RecipeCanvas {
  /** Logical width in px. Texture features are sized in logical px. */
  width: number;
  height: number;
  colorSpace: 'sRGB';
  transparentBackground: boolean;
}

export const EXPORT_FORMATS = ['png', 'jpeg', 'svg'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface RecipeExportDefaults {
  format: ExportFormat;
  width: number;
  height: number;
  scale: number;
  /** Render as a seamless tile (see seamless.ts). */
  seamless: boolean;
}

export interface RecipeMetadata {
  createdAt: string;
  updatedAt: string;
  /** Preset this recipe was created from, when applicable. */
  presetId?: string;
  tags?: string[];
}

export interface Recipe {
  schemaVersion: number;
  recipeId: string;
  name: string;
  family: RecipeFamily;
  engineVersion: string;
  seed: number;
  canvas: RecipeCanvas;
  layers: Layer[];
  exportDefaults: RecipeExportDefaults;
  metadata: RecipeMetadata;
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Dotted path to the offending field, e.g. `layers[1].parameters.amount`. */
  path: string;
  code: string;
  message: string;
}
