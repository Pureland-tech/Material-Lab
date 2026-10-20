import { describe, expect, it } from 'vitest';
import { createRandom, deriveSeed, hash01, MAX_SEED, normalizeSeed } from '../src';

describe('seeded randomness', () => {
  it('hashes deterministically into [0, 1)', () => {
    for (let i = -50; i < 50; i++) {
      const v = hash01(i, i * 7, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash01(i, i * 7, 42)).toBe(v);
    }
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
  });

  it('has known reference values', () => {
    expect(hash01(0, 0, 0)).not.toBe(0);
    expect(hash01(12, -7, 99)).toMatchInlineSnapshot(`0.32874109875410795`);
    expect(deriveSeed(482913, 15)).toMatchInlineSnapshot(`3984768156`);
  });

  it('produces repeatable PRNG sequences', () => {
    const a = createRandom(123);
    const b = createRandom(123);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, createRandom(124))).not.toEqual(seqA);
  });

  it('normalizes seeds into the valid range', () => {
    expect(normalizeSeed(12.9)).toBe(12);
    expect(normalizeSeed(-5)).toBe(5);
    expect(normalizeSeed(Number.NaN)).toBe(0);
    expect(normalizeSeed(MAX_SEED + 3)).toBe(2);
  });
});
