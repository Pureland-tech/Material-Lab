import type { Recipe } from '@material-lab/engine';

/** Figma's documented maximum width/height for images created by plugins. */
export const FIGMA_MAX_IMAGE_SIDE = 4096;

/** Plugin data key holding the recipe reference on inserted nodes. */
export const PLUGIN_DATA_KEY = 'materialLabRecipe';

/**
 * Stored on inserted nodes so the texture can be reopened in the plugin.
 * It references the editable recipe; the node itself holds a rendered image.
 */
export interface RecipeReference {
  recipe: Recipe;
  engineVersion: string;
  output: { width: number; height: number; scale: number };
  insertedAt: string;
}

export interface SelectionInfo {
  count: number;
  /** Selected nodes that can take an image fill. */
  fillable: number;
  /** Recipe reference from the single selected node, when present. */
  reference: RecipeReference | null;
}

export type InsertMode = 'new' | 'fill';

export type UiToPlugin =
  | { type: 'ready' }
  | {
      type: 'insert';
      bytes: Uint8Array;
      /** Size of the new node in Figma units (logical px). */
      width: number;
      height: number;
      name: string;
      mode: InsertMode;
      reference: RecipeReference;
    }
  | { type: 'close' };

export type PluginToUi =
  | { type: 'selection'; info: SelectionInfo }
  | { type: 'inserted'; mode: InsertMode; count: number }
  | { type: 'insert-error'; message: string };
