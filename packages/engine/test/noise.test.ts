import { describe, expect, it } from 'vitest';
import { cellularNoise, fbm, gradientNoise, ridged, valueNoise, whiteNoise } from '../src';

const FNS = { valueNoise, gradientNoise, cellularNoise, whiteNoise };

describe('noise', () => {
  for (const [name, fn] of Object.entries(FNS)) {
    it(`${name} stays in [0, 1] and is deterministic`, () => {
      let min = 1;
      let max = 0;
      for (let i = 0; i < 2000; i++) {
        const x = (i % 50) * 0.37 - 9;
        const y = Math.floor(i / 50) * 0.53 - 11;
        const v = fn(x, y, 7);
        expect(fn(x, y, 7)).toBe(v);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1);
      // Uses a meaningful part of the range.
      expect(max - min).toBeGreaterThan(0.4);
    });
  }

  it('changes with the seed', () => {
    let differences = 0;
    for (let i = 0; i < 100; i++) if (gradientNoise(i * 0.31, i * 0.17, 1) !== gradientNoise(i * 0.31, i * 0.17, 2)) differences++;
    expect(differences).toBeGreaterThan(90);
  });

  it('fbm and ridged are normalized', () => {
    for (let i = 0; i < 500; i++) {
      const f = fbm(gradientNoise, i * 0.13, i * 0.07, 3, 5);
      const r = ridged(gradientNoise, i * 0.13, i * 0.07, 3, 4);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe('inlined lattice hashing', () => {
  it('matches hash01 at lattice points', async () => {
    const { hash01 } = await import('../src');
    for (let i = -20; i < 20; i++) {
      // At integer coordinates value noise returns the lattice hash exactly.
      expect(valueNoise(i, i * 3 - 5, 11)).toBe(hash01(i, i * 3 - 5, 11));
    }
  });
});
