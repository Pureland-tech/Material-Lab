/**
 * Seeded 2D noise functions. All outputs are deterministic for a given
 * (x, y, seed) and have no practical period, so textures do not show
 * repeating tiles at common canvas sizes.
 */
import { HASH_SALT, hash2, hash01, mix32 } from './random';

const INV_2_32 = 1 / 4294967296;

export type NoiseFn = (x: number, y: number, seed: number) => number;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Interpolated lattice noise in [0, 1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  // Same values as hash01(xi, yi, seed) etc., sharing the x half of the hash.
  const s = Math.imul(seed | 0, 0x9e3779b1) ^ HASH_SALT;
  const hx0 = mix32(Math.imul(xi | 0, 0x27d4eb2d) ^ s);
  const hx1 = mix32(Math.imul((xi + 1) | 0, 0x27d4eb2d) ^ s);
  const y0 = Math.imul(yi | 0, 0x165667b1);
  const y1 = Math.imul((yi + 1) | 0, 0x165667b1);
  const a = mix32(hx0 ^ y0) * INV_2_32;
  const b = mix32(hx1 ^ y0) * INV_2_32;
  const c = mix32(hx0 ^ y1) * INV_2_32;
  const d = mix32(hx1 ^ y1) * INV_2_32;
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

const S = 0.7071067811865476;
const GRAD_X = [1, -1, 0, 0, S, -S, S, -S];
const GRAD_Y = [0, 0, 1, -1, S, S, -S, -S];

function gradDot(h: number, dx: number, dy: number): number {
  const g = h & 7;
  return (GRAD_X[g] as number) * dx + (GRAD_Y[g] as number) * dy;
}

/** Perlin-style gradient noise mapped to [0, 1]. Smoother and less blocky than value noise. */
export function gradientNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const s = Math.imul(seed | 0, 0x9e3779b1) ^ HASH_SALT;
  const hx0 = mix32(Math.imul(xi | 0, 0x27d4eb2d) ^ s);
  const hx1 = mix32(Math.imul((xi + 1) | 0, 0x27d4eb2d) ^ s);
  const y0 = Math.imul(yi | 0, 0x165667b1);
  const y1 = Math.imul((yi + 1) | 0, 0x165667b1);
  const a = gradDot(mix32(hx0 ^ y0), xf, yf);
  const b = gradDot(mix32(hx1 ^ y0), xf - 1, yf);
  const c = gradDot(mix32(hx0 ^ y1), xf, yf - 1);
  const d = gradDot(mix32(hx1 ^ y1), xf - 1, yf - 1);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  const n = (top + (bottom - top) * v) * 0.7071067811865476 + 0.5;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Worley (cellular) noise: distance to the nearest feature point, roughly [0, 1]. */
export function cellularNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 8;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const h = hash2(cx, cy, seed);
      const px = cx + (h & 0xffff) / 65536;
      const py = cy + (h >>> 16) / 65536;
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  const dist = Math.sqrt(best);
  return dist > 1 ? 1 : dist;
}

/** Per-cell white noise in [0, 1). */
export function whiteNoise(x: number, y: number, seed: number): number {
  return hash01(Math.floor(x), Math.floor(y), seed);
}

// Fixed rotation between octaves (a 3-4-5 triangle keeps the constants exact)
// so lattice axes do not line up across octaves.
const ROT_C = 0.8;
const ROT_S = 0.6;

/**
 * Fractal sum of octaves of `noise`, normalized back to [0, 1].
 * `gain` controls how much each finer octave contributes.
 */
export function fbm(
  noise: NoiseFn,
  x: number,
  y: number,
  seed: number,
  octaves: number,
  gain = 0.5,
  lacunarity = 2,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let px = x;
  let py = y;
  const count = Math.max(1, Math.floor(octaves));
  for (let i = 0; i < count; i++) {
    sum += noise(px, py, seed + i * 0x9e37) * amp;
    norm += amp;
    amp *= gain;
    const nx = (px * ROT_C - py * ROT_S) * lacunarity + 17.31;
    py = (px * ROT_S + py * ROT_C) * lacunarity + 5.79;
    px = nx;
  }
  return sum / norm;
}

/** Ridged multifractal: sharp creases where the base noise crosses its midpoint. */
export function ridged(
  noise: NoiseFn,
  x: number,
  y: number,
  seed: number,
  octaves: number,
  gain = 0.5,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let px = x;
  let py = y;
  const count = Math.max(1, Math.floor(octaves));
  for (let i = 0; i < count; i++) {
    const n = 1 - Math.abs(noise(px, py, seed + i * 0x9e37) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    const nx = (px * ROT_C - py * ROT_S) * 2 + 17.31;
    py = (px * ROT_S + py * ROT_C) * 2 + 5.79;
    px = nx;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Periodic ("tiled") variants for seamless textures. Lattice indices wrap with
// integer periods px and py, so the noise repeats exactly every px × py units.
// ---------------------------------------------------------------------------

export type TiledNoiseFn = (x: number, y: number, seed: number, px: number, py: number) => number;

/** Positive modulo for lattice indices. */
export function wrapIndex(i: number, period: number): number {
  const r = i % period;
  return r < 0 ? r + period : r;
}

export function valueNoiseTiled(x: number, y: number, seed: number, px: number, py: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const s = Math.imul(seed | 0, 0x9e3779b1) ^ HASH_SALT;
  const hx0 = mix32(Math.imul(wrapIndex(xi, px), 0x27d4eb2d) ^ s);
  const hx1 = mix32(Math.imul(wrapIndex(xi + 1, px), 0x27d4eb2d) ^ s);
  const y0 = Math.imul(wrapIndex(yi, py), 0x165667b1);
  const y1 = Math.imul(wrapIndex(yi + 1, py), 0x165667b1);
  const a = mix32(hx0 ^ y0) * INV_2_32;
  const b = mix32(hx1 ^ y0) * INV_2_32;
  const c = mix32(hx0 ^ y1) * INV_2_32;
  const d = mix32(hx1 ^ y1) * INV_2_32;
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

export function gradientNoiseTiled(x: number, y: number, seed: number, px: number, py: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const s = Math.imul(seed | 0, 0x9e3779b1) ^ HASH_SALT;
  const hx0 = mix32(Math.imul(wrapIndex(xi, px), 0x27d4eb2d) ^ s);
  const hx1 = mix32(Math.imul(wrapIndex(xi + 1, px), 0x27d4eb2d) ^ s);
  const y0 = Math.imul(wrapIndex(yi, py), 0x165667b1);
  const y1 = Math.imul(wrapIndex(yi + 1, py), 0x165667b1);
  const a = gradDot(mix32(hx0 ^ y0), xf, yf);
  const b = gradDot(mix32(hx1 ^ y0), xf - 1, yf);
  const c = gradDot(mix32(hx0 ^ y1), xf, yf - 1);
  const d = gradDot(mix32(hx1 ^ y1), xf - 1, yf - 1);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  const n = (top + (bottom - top) * v) * 0.7071067811865476 + 0.5;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function cellularNoiseTiled(x: number, y: number, seed: number, px: number, py: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 8;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      // Feature points come from the wrapped cell; positions stay unwrapped.
      const h = hash2(wrapIndex(cx, px), wrapIndex(cy, py), seed);
      const fx = cx + (h & 0xffff) / 65536;
      const fy = cy + (h >>> 16) / 65536;
      const dx = fx - x;
      const dy = fy - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  const dist = Math.sqrt(best);
  return dist > 1 ? 1 : dist;
}

export function whiteNoiseTiled(x: number, y: number, seed: number, px: number, py: number): number {
  return hash01(wrapIndex(Math.floor(x), px), wrapIndex(Math.floor(y), py), seed);
}

/**
 * Periodic fBm. Octaves double the frequency and the period together, so the
 * sum keeps the base period. (No inter-octave rotation: it would break the
 * period; per-octave offsets keep lattices from lining up exactly.)
 */
export function fbmTiled(
  noise: TiledNoiseFn,
  x: number,
  y: number,
  seed: number,
  octaves: number,
  gain: number,
  px: number,
  py: number,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let cx = x;
  let cy = y;
  let ppx = px;
  let ppy = py;
  const count = Math.max(1, Math.floor(octaves));
  for (let i = 0; i < count; i++) {
    sum += noise(cx, cy, seed + i * 0x9e37, ppx, ppy) * amp;
    norm += amp;
    amp *= gain;
    cx = cx * 2 + 17.31;
    cy = cy * 2 + 5.79;
    ppx *= 2;
    ppy *= 2;
  }
  return sum / norm;
}

export function ridgedTiled(
  noise: TiledNoiseFn,
  x: number,
  y: number,
  seed: number,
  octaves: number,
  gain: number,
  px: number,
  py: number,
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let cx = x;
  let cy = y;
  let ppx = px;
  let ppy = py;
  const count = Math.max(1, Math.floor(octaves));
  for (let i = 0; i < count; i++) {
    const n = 1 - Math.abs(noise(cx, cy, seed + i * 0x9e37, ppx, ppy) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    cx = cx * 2 + 17.31;
    cy = cy * 2 + 5.79;
    ppx *= 2;
    ppy *= 2;
  }
  return sum / norm;
}
