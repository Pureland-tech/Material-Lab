/**
 * Deterministic integer hashing and seeded random numbers.
 *
 * Everything here uses 32-bit integer arithmetic (Math.imul, shifts), so the
 * same inputs produce the same outputs on every JavaScript engine and platform.
 */

const INV_2_32 = 1 / 4294967296;
/** Mixed into every hash so that all-zero inputs do not hash to zero. */
export const HASH_SALT = 0x632be5ab;

/** Avalanche a 32-bit integer (murmur3 finalizer). */
export function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash two integer coordinates and a seed into an unsigned 32-bit integer. */
export function hash2(x: number, y: number, seed: number): number {
  // Two mixing rounds: a single round over x*A ^ y*B shows faint diagonal
  // correlations in white noise.
  const h = mix32(Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1) ^ HASH_SALT);
  return mix32(h ^ Math.imul(y | 0, 0x165667b1));
}

/** Hash two integer coordinates and a seed into [0, 1). */
export function hash01(x: number, y: number, seed: number): number {
  return hash2(x, y, seed) * INV_2_32;
}

/** Hash a single integer and a seed into [0, 1). */
export function hash1(x: number, seed: number): number {
  return mix32(Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1) ^ HASH_SALT) * INV_2_32;
}

/** Combine a recipe seed with a per-layer offset into a new 32-bit seed. */
export function deriveSeed(seed: number, offset: number): number {
  return mix32(Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((offset | 0) + 0x632be5ab, 0x85ebca6b));
}

/** Seeded PRNG (mulberry32) returning floats in [0, 1). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) * INV_2_32;
  };
}

export const MAX_SEED = 999_999_999;

/** Normalize any number into a valid recipe seed (integer in [0, MAX_SEED]). */
export function normalizeSeed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const n = Math.abs(Math.trunc(value));
  return n % (MAX_SEED + 1);
}

/**
 * Pick a fresh seed. The result is recorded in the recipe, so output stays
 * reproducible even though this choice itself is random.
 */
export function randomSeed(random: () => number = Math.random): number {
  return Math.floor(random() * (MAX_SEED + 1));
}
