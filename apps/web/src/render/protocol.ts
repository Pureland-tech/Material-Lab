import type { PrecomputedComposite, Recipe, RenderWarning } from '@material-lab/engine';

/** Request for one chunk of rows of a frame. */
export interface ChunkRequest {
  type: 'render';
  /** Unique per chunk; responses echo it. */
  taskId: number;
  /**
   * `pixels`: final 8-bit RGBA rows. `composite`: premultiplied float rows of
   * the first `layerCount` layers (phase 1 of a two-phase glass render).
   */
  mode: 'pixels' | 'composite';
  recipe: Recipe;
  width: number;
  height: number;
  pixelRatio: number;
  transparent: boolean;
  background: string;
  rows: { start: number; end: number };
  /** Render as a seamless tile (the whole output is one tile). */
  tile: boolean;
  /** Animation frame: loop position 0–1, or null for a still. */
  time: number | null;
  /** Animation strength 0–1. */
  motion: number;
  layerCount?: number;
  below?: PrecomputedComposite;
}

export type WorkerResponse =
  | { type: 'chunk'; taskId: number; data: ArrayBuffer; warnings: RenderWarning[]; ms: number }
  | { type: 'error'; taskId: number; message: string };
