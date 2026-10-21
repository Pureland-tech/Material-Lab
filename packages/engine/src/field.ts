/**
 * Sampling helpers that let a layer ask for "features of size S" without
 * caring whether it renders a plain texture or a seamless tile.
 *
 * In seamless mode every feature size is snapped so a whole number of
 * features fits the tile, and noise lattices wrap at the tile edges, so the
 * texture repeats without seams. In plain mode the helpers fall back to the
 * ordinary (non-repeating) noise functions.
 */
import { direction, type Direction } from './math';
import {
  cellularNoise,
  cellularNoiseTiled,
  fbm,
  fbmTiled,
  gradientNoise,
  gradientNoiseTiled,
  ridged,
  ridgedTiled,
  valueNoise,
  valueNoiseTiled,
  whiteNoise,
  whiteNoiseTiled,
  wrapIndex,
  type NoiseFn,
  type TiledNoiseFn,
} from './noise';

/** Logical size of one seamless tile. */
export interface Tile {
  width: number;
  height: number;
}

/** Coordinate multipliers (and integer periods in seamless mode, else 0). */
export interface Axes {
  kx: number;
  ky: number;
  px: number;
  py: number;
}

export type NoiseKind = 'value' | 'gradient' | 'cellular' | 'white';

const PLAIN: Record<NoiseKind, NoiseFn> = {
  value: valueNoise,
  gradient: gradientNoise,
  cellular: cellularNoise,
  white: whiteNoise,
};

const TILED: Record<NoiseKind, TiledNoiseFn> = {
  value: valueNoiseTiled,
  gradient: gradientNoiseTiled,
  cellular: cellularNoiseTiled,
  white: whiteNoiseTiled,
};

/** Features of size sx × sy logical px; snapped to the tile in seamless mode. */
export function axes(tile: Tile | null, sx: number, sy: number = sx): Axes {
  if (!tile) return { kx: 1 / sx, ky: 1 / sy, px: 0, py: 0 };
  const px = Math.max(1, Math.round(tile.width / sx));
  const py = Math.max(1, Math.round(tile.height / sy));
  return { kx: px / tile.width, ky: py / tile.height, px, py };
}

/** Integer periods also divisible by `multiple` (e.g. a 4-thread twill repeat). */
export function axesMultiple(tile: Tile | null, sx: number, sy: number, multiple: number): Axes {
  if (!tile) return axes(null, sx, sy);
  const px = Math.max(multiple, Math.round(tile.width / sx / multiple) * multiple);
  const py = Math.max(multiple, Math.round(tile.height / sy / multiple) * multiple);
  return { kx: px / tile.width, ky: py / tile.height, px, py };
}

export type Sampler = (lx: number, ly: number, seed: number) => number;

/** Single-octave noise of the given kind at logical coordinates. */
export function sampler(kind: NoiseKind, ax: Axes): Sampler {
  const { kx, ky, px, py } = ax;
  if (px === 0) {
    const fn = PLAIN[kind];
    return (lx, ly, seed) => fn(lx * kx, ly * ky, seed);
  }
  const fn = TILED[kind];
  return (lx, ly, seed) => fn(lx * kx, ly * ky, seed, px, py);
}

/** Fractal noise of the given kind at logical coordinates, normalized to [0, 1]. */
export function fbmSampler(kind: NoiseKind, ax: Axes, octaves: number, gain = 0.5): Sampler {
  const { kx, ky, px, py } = ax;
  if (px === 0) {
    const fn = PLAIN[kind];
    return (lx, ly, seed) => fbm(fn, lx * kx, ly * ky, seed, octaves, gain);
  }
  const fn = TILED[kind];
  return (lx, ly, seed) => fbmTiled(fn, lx * kx, ly * ky, seed, octaves, gain, px, py);
}

/** Ridged fractal noise at logical coordinates. */
export function ridgedSampler(kind: NoiseKind, ax: Axes, octaves: number, gain = 0.5): Sampler {
  const { kx, ky, px, py } = ax;
  if (px === 0) {
    const fn = PLAIN[kind];
    return (lx, ly, seed) => ridged(fn, lx * kx, ly * ky, seed, octaves, gain);
  }
  const fn = TILED[kind];
  return (lx, ly, seed) => ridgedTiled(fn, lx * kx, ly * ky, seed, octaves, gain, px, py);
}

/** Wrap a cell index in seamless mode (period 0 leaves it unchanged). */
export function wrapCell(i: number, period: number): number {
  return period > 0 ? wrapIndex(i, period) : i;
}

/**
 * A rotated coordinate frame (a along `d`, b across it). Seamless tiles only
 * repeat under 90° rotations, so in seamless mode the angle snaps to the
 * nearest multiple of 90° and the tile extents follow the axes.
 */
export interface Frame {
  d: Direction;
  /** Tile extents along a and b (null in plain mode). */
  tile: Tile | null;
}

export function frame(angleDegrees: number, tile: Tile | null): Frame {
  if (!tile) return { d: direction(angleDegrees), tile: null };
  const quarter = ((Math.round(angleDegrees / 90) % 4) + 4) % 4;
  const d: Direction = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ][quarter] as Direction;
  const swapped = quarter % 2 === 1;
  return { d, tile: swapped ? { width: tile.height, height: tile.width } : tile };
}

/**
 * Fractal noise in noise units (coordinates already scaled by an Axes'
 * kx/ky), for domain warping where offsets are added in noise units.
 */
export function unitFbm(kind: NoiseKind, ax: Axes, octaves: number, gain = 0.5): (x: number, y: number, seed: number) => number {
  const { px, py } = ax;
  if (px === 0) {
    const fn = PLAIN[kind];
    return (x, y, seed) => fbm(fn, x, y, seed, octaves, gain);
  }
  const fn = TILED[kind];
  return (x, y, seed) => fbmTiled(fn, x, y, seed, octaves, gain, px, py);
}

/** Swap a tile's extents (for samplers whose first argument runs along the second axis). */
export function transpose(tile: Tile | null): Tile | null {
  return tile ? { width: tile.height, height: tile.width } : null;
}

/**
 * Number of whole periods of `size` along `extent` in seamless mode, used to
 * snap stretched coordinates; returns the multiplier and period.
 */
export function snap(extent: number | null, size: number): { k: number; period: number } {
  if (extent === null) return { k: 1 / size, period: 0 };
  const period = Math.max(1, Math.round(extent / size));
  return { k: period / extent, period };
}

/** Seamless-mode report for a layer: what will seam, and what was approximated. */
export interface SeamlessReport {
  /** Settings that will show visible seams at the tile edges. */
  seams: string[];
  /** Settings adjusted (e.g. angles rounded to 90°) so the tile repeats. */
  notes: string[];
}

/**
 * Offset along a circle for loop position `time` (0–1). Moving a noise
 * domain around a circle returns it to the start at time 1, so animations
 * loop without a jump. Trigonometry runs once per frame, rounded to keep it
 * reproducible across engines.
 */
export function loopOffset(time: number | null, radius: number): { x: number; y: number } {
  if (time === null || radius === 0) return { x: 0, y: 0 };
  const a = time * 2 * Math.PI;
  return { x: (Math.round(Math.cos(a) * 1e12) / 1e12) * radius, y: (Math.round(Math.sin(a) * 1e12) / 1e12) * radius };
}
