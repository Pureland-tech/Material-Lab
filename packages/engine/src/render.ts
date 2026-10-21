import { hexToRgb } from './color';
import type { Tile } from './field';
import { compositeInto } from './compose';
import { getLayerDefinition } from './layers';
import type { BelowBuffer, LayerDefinition } from './params';
import { deriveSeed, hash01 } from './random';
import type { BlendMode, LayerParameters, Recipe } from './types';
import { normalizeLayerParameters } from './validate';

export interface RenderOptions {
  /** Output width in device pixels. */
  width: number;
  /** Output height in device pixels. */
  height: number;
  /**
   * Device pixels per logical px. 1 for a 1× export, 2 for 2×, below 1 for
   * reduced-resolution previews. Texture features keep their logical size.
   */
  pixelRatio?: number;
  /** Keep transparency. Defaults to the recipe's `canvas.transparentBackground`. */
  transparent?: boolean;
  /** Color to flatten onto when not transparent. Defaults to white. */
  background?: string;
  /** Called after each band of rows with the completed fraction (0–1). */
  onProgress?: (fraction: number) => void;
  /** Checked between bands; return true to abort with RenderCancelledError. */
  shouldCancel?: () => boolean;
  /**
   * Render only rows [start, end) of the full image (for splitting work across
   * workers). The result holds just those rows. Output is identical to the
   * same rows of a full render.
   */
  rows?: { start: number; end: number };
  /** Override band height (testing). Output does not depend on it. */
  bandRows?: number;
  /**
   * Render as a seamless tile. `true` makes the whole output one tile;
   * an explicit logical size repeats the texture with that period (larger
   * outputs then contain several repeats).
   */
  tile?: boolean | Tile;
  /** Animation frame: position in the loop, 0–1. Omit for a still image. */
  time?: number;
  /** Animation strength, 0–1 (default 0.5). */
  motion?: number;
  /**
   * Precomputed composite of the first `layerCount` active layers (see
   * renderComposite), so a parallel renderer can render the layers beneath a
   * glass layer once instead of once per chunk. Must cover every row the
   * render needs, including the glass layer's context margin.
   */
  below?: PrecomputedComposite;
}

/** Premultiplied RGBA float rows [y0, y1) of the first `layerCount` active layers. */
export interface PrecomputedComposite {
  data: Float32Array;
  y0: number;
  y1: number;
  layerCount: number;
}

export interface RenderWarning {
  code: 'unsupported-layer';
  layerId: string;
  message: string;
}

export interface RenderResult {
  width: number;
  /** Rows in `data` (the full height, or the requested row range). */
  height: number;
  /** Straight (non-premultiplied) RGBA, 8 bits per channel, like ImageData. */
  data: Uint8ClampedArray<ArrayBuffer>;
  warnings: RenderWarning[];
}

export class RenderCancelledError extends Error {
  constructor() {
    super('Render cancelled');
    this.name = 'RenderCancelledError';
  }
}

interface PreparedLayer {
  id: string;
  def: LayerDefinition;
  params: LayerParameters;
  seed: number;
  blendMode: BlendMode;
  opacity: number;
  /** Whether this layer samples the layers beneath it. */
  needsBelow: boolean;
  margin: number;
}

const BASE_BAND_ROWS = 64;
/**
 * When layers sample context rows (glass), rendering the whole image as one
 * band avoids re-rendering the layers beneath for every band's margin.
 * Do that while the float buffers stay under this budget.
 */
const SINGLE_BAND_BUDGET_BYTES = 192 * 1024 * 1024;

function chooseBandRows(layers: PreparedLayer[], width: number, height: number): number {
  const maxMargin = layers.reduce((m, l) => Math.max(m, l.margin), 0);
  if (maxMargin === 0) return Math.min(height, BASE_BAND_ROWS);
  // Context layers keep roughly three full-size float buffers alive.
  if (width * height * 16 * 3 <= SINGLE_BAND_BUDGET_BYTES) return height;
  // Otherwise use large bands so margin overhead stays small.
  return Math.min(height, Math.max(BASE_BAND_ROWS, maxMargin * 4));
}
const DITHER_SEED = 0x5eed1;

/** Fixed dimension limits shared by the renderer and export validation. */
export const RENDER_LIMITS = {
  minSide: 1,
  maxSide: 8192,
} as const;

export function prepareLayers(recipe: Recipe, pixelRatio: number): { layers: PreparedLayer[]; warnings: RenderWarning[] } {
  const layers: PreparedLayer[] = [];
  const warnings: RenderWarning[] = [];
  for (const layer of recipe.layers) {
    if (!layer.enabled || !(layer.opacity > 0)) continue;
    const def = getLayerDefinition(layer.type);
    if (!def) {
      warnings.push({
        code: 'unsupported-layer',
        layerId: layer.id,
        message: `Layer "${layer.name}" uses unsupported type "${layer.type}" and was skipped.`,
      });
      continue;
    }
    const params = normalizeLayerParameters(def, layer.parameters).parameters;
    const margin = def.margin ? Math.max(0, Math.ceil(def.margin(params, pixelRatio))) : 0;
    layers.push({
      id: layer.id,
      def,
      params,
      seed: deriveSeed(recipe.seed, layer.seedOffset),
      blendMode: layer.blendMode,
      opacity: Math.min(1, layer.opacity),
      needsBelow: def.margin !== undefined,
      margin,
    });
  }
  return { layers, warnings };
}

/**
 * Render a recipe to 8-bit RGBA.
 *
 * Rendering is CPU-only and uses deterministic arithmetic, so the same recipe,
 * seed, engine version and options produce identical pixels in browsers,
 * workers and Node. The image is processed in bands of rows to bound memory
 * and to report progress.
 */
export function renderRecipe(recipe: Recipe, options: RenderOptions): RenderResult {
  const width = Math.floor(options.width);
  const height = Math.floor(options.height);
  if (!(width >= RENDER_LIMITS.minSide && height >= RENDER_LIMITS.minSide)) {
    throw new RangeError(`Invalid render size ${options.width}×${options.height}`);
  }
  if (width > RENDER_LIMITS.maxSide || height > RENDER_LIMITS.maxSide) {
    throw new RangeError(`Render size ${width}×${height} exceeds the ${RENDER_LIMITS.maxSide}px limit`);
  }
  const pixelRatio = options.pixelRatio ?? 1;
  if (!(pixelRatio > 0) || !Number.isFinite(pixelRatio)) throw new RangeError('pixelRatio must be positive');
  const transparent = options.transparent ?? recipe.canvas.transparentBackground;
  const bg = hexToRgb(options.background ?? '#FFFFFF');

  const { layers, warnings } = prepareLayers(recipe, pixelRatio);
  const rowStart = options.rows ? Math.max(0, Math.floor(options.rows.start)) : 0;
  const rowEnd = options.rows ? Math.min(height, Math.floor(options.rows.end)) : height;
  if (!(rowEnd > rowStart)) throw new RangeError('Empty row range');
  const rowCount = rowEnd - rowStart;
  const hasContext = layers.some((l) => l.needsBelow);
  // Seamless context layers read the whole image, so one band avoids recomputing it.
  const bandRows = Math.max(1, Math.floor(options.bandRows ?? (options.tile && hasContext ? rowCount : chooseBandRows(layers, width, rowCount))));

  const out = new Uint8ClampedArray(width * rowCount * 4);
  const tile = resolveTile(options.tile, width, height, pixelRatio);
  const geometry: Geometry = {
    width,
    height,
    pixelRatio,
    pre: options.below ?? null,
    tile,
    time: options.time ?? null,
    motion: options.motion ?? 0.5,
  };
  // In seamless mode dithering repeats with the tile too.
  const ditherPeriod = tile
    ? { x: Math.max(1, Math.round(tile.width * pixelRatio)), y: Math.max(1, Math.round(tile.height * pixelRatio)) }
    : null;

  for (let y0 = rowStart; y0 < rowEnd; y0 += bandRows) {
    if (options.shouldCancel?.()) throw new RenderCancelledError();
    const y1 = Math.min(rowEnd, y0 + bandRows);
    const band = compositeRange(layers, layers.length, y0, y1, geometry);
    quantizeBand(band, out, width, y0, y1, rowStart, transparent, bg, ditherPeriod);
    options.onProgress?.((y1 - rowStart) / rowCount);
  }
  return { width, height: rowCount, data: out, warnings };
}

interface Geometry {
  width: number;
  height: number;
  pixelRatio: number;
  pre: PrecomputedComposite | null;
  tile: Tile | null;
  time: number | null;
  motion: number;
}

function resolveTile(tile: boolean | Tile | undefined, width: number, height: number, pixelRatio: number): Tile | null {
  if (!tile) return null;
  if (tile === true) return { width: width / pixelRatio, height: height / pixelRatio };
  return { width: tile.width, height: tile.height };
}

/** Premultiplied composite of layers [0, end) for rows [y0, y1). */
function compositeRange(layers: PreparedLayer[], end: number, y0: number, y1: number, geo: Geometry): Float32Array {
  const { width } = geo;
  const size = width * (y1 - y0) * 4;

  const pre = geo.pre;
  if (pre && end === pre.layerCount && y0 >= pre.y0 && y1 <= pre.y1) {
    return pre.data.slice((y0 - pre.y0) * width * 4, (y1 - pre.y0) * width * 4);
  }

  // The topmost layer that samples what is beneath it splits the stack: the
  // layers under it are composited over a wider row range first.
  let split = -1;
  for (let i = end - 1; i >= 0; i--) {
    if ((layers[i] as PreparedLayer).needsBelow) {
      split = i;
      break;
    }
  }

  let buf: Float32Array;
  let start: number;
  if (split === -1) {
    buf = new Float32Array(size);
    start = 0;
  } else {
    const layer = layers[split] as PreparedLayer;
    // Seamless tiles need the full height so context can wrap around edges.
    const ya = geo.tile ? 0 : Math.max(0, y0 - layer.margin);
    const yb = geo.tile ? geo.height : Math.min(geo.height, y1 + layer.margin);
    const wide = compositeRange(layers, split, ya, yb, geo);
    const below: BelowBuffer = { data: wide, y0: ya, y1: yb };
    buf = wide.slice((y0 - ya) * width * 4, (y1 - ya) * width * 4);
    applyLayer(layer, buf, y0, y1, geo, below);
    start = split + 1;
  }
  for (let i = start; i < end; i++) applyLayer(layers[i] as PreparedLayer, buf, y0, y1, geo, null);
  return buf;
}

function applyLayer(
  layer: PreparedLayer,
  buf: Float32Array,
  y0: number,
  y1: number,
  geo: Geometry,
  below: BelowBuffer | null,
): void {
  const layerOut = new Float32Array(buf.length);
  layer.def.render(
    {
      width: geo.width,
      height: geo.height,
      pixelRatio: geo.pixelRatio,
      y0,
      y1,
      seed: layer.seed,
      params: layer.params,
      below,
      tile: geo.tile,
      time: geo.time,
      motion: geo.motion,
    },
    layerOut,
  );
  compositeInto(buf, layerOut, layer.blendMode, layer.opacity);
}

/**
 * Convert a premultiplied float band to 8-bit straight RGBA. A per-pixel
 * random offset before truncation (dither) prevents banding in smooth
 * gradients; it is seeded, so output stays deterministic.
 */
function quantizeBand(
  band: Float32Array,
  out: Uint8ClampedArray,
  width: number,
  y0: number,
  y1: number,
  outStartRow: number,
  transparent: boolean,
  bg: [number, number, number],
  ditherPeriod: { x: number; y: number } | null,
): void {
  let i = 0;
  let o = (y0 - outStartRow) * width * 4;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++, i += 4, o += 4) {
      const d = ditherPeriod ? hash01(x % ditherPeriod.x, y % ditherPeriod.y, DITHER_SEED) : hash01(x, y, DITHER_SEED);
      let a = band[i + 3] as number;
      if (a > 1) a = 1;
      else if (!(a > 0)) a = 0;
      let r: number;
      let g: number;
      let b: number;
      if (transparent) {
        const inv = a > 0 ? 1 / a : 0;
        r = (band[i] as number) * inv;
        g = (band[i + 1] as number) * inv;
        b = (band[i + 2] as number) * inv;
        out[o + 3] = Math.floor(a * 255 + d);
      } else {
        const k = 1 - a;
        r = (band[i] as number) + bg[0] * k;
        g = (band[i + 1] as number) + bg[1] * k;
        b = (band[i + 2] as number) + bg[2] * k;
        out[o + 3] = 255;
      }
      out[o] = Math.floor(r * 255 + d);
      out[o + 1] = Math.floor(g * 255 + d);
      out[o + 2] = Math.floor(b * 255 + d);
    }
  }
}

/**
 * Composite of the first `layerCount` active (prepared) layers for a row
 * range, as premultiplied float RGBA. Used with RenderOptions.below.
 */
export function renderComposite(
  recipe: Recipe,
  options: {
    width: number;
    height: number;
    pixelRatio: number;
    rows: { start: number; end: number };
    layerCount: number;
    tile?: boolean | Tile;
    time?: number;
    motion?: number;
  },
): Float32Array {
  const { layers } = prepareLayers(recipe, options.pixelRatio);
  const geometry: Geometry = {
    width: options.width,
    height: options.height,
    pixelRatio: options.pixelRatio,
    pre: null,
    tile: resolveTile(options.tile, options.width, options.height, options.pixelRatio),
    time: options.time ?? null,
    motion: options.motion ?? 0.5,
  };
  const count = Math.max(0, Math.min(layers.length, options.layerCount));
  return compositeRange(layers, count, options.rows.start, options.rows.end, geometry);
}

/**
 * The topmost active layer that samples the layers beneath it (glass), as an
 * index into the active layers, with its context margin in rows. Null when
 * no such layer exists or nothing is beneath it.
 */
export function findContextSplit(
  recipe: Recipe,
  pixelRatio: number,
  options: { tile?: boolean; height?: number } = {},
): { layerCount: number; margin: number } | null {
  const { layers } = prepareLayers(recipe, pixelRatio);
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i] as PreparedLayer;
    if (!layer.needsBelow) continue;
    if (i === 0) return null;
    // Seamless tiles read context from the whole image (it wraps around).
    const margin = options.tile ? Math.max(layer.margin, options.height ?? Number.MAX_SAFE_INTEGER) : layer.margin;
    return { layerCount: i, margin };
  }
  return null;
}

/**
 * Rough upper bound on renderer memory for a render, in bytes: the output
 * buffer plus the float band buffers (including context rows).
 */
export function estimateRenderMemory(recipe: Recipe, width: number, height: number, pixelRatio: number): number {
  const { layers } = prepareLayers(recipe, pixelRatio);
  const maxMargin = layers.reduce((m, l) => Math.max(m, l.margin), 0);
  const bandRows = chooseBandRows(layers, width, height);
  const glassCount = layers.filter((l) => l.needsBelow).length;
  const contextRows = Math.min(height, bandRows + maxMargin * 2);
  const floatRows = bandRows * 2 + contextRows * (glassCount > 0 ? 3 * glassCount : 0);
  return width * height * 4 + width * floatRows * 16;
}
