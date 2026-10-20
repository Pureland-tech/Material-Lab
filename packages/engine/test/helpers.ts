import { createLayer, createRecipe, type Recipe } from '../src';

/** FNV-1a hash of rendered bytes, as hex. */
export function hashBytes(bytes: Uint8ClampedArray | Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function sampleRecipe(): Recipe {
  return createRecipe({
    name: 'Test paper',
    family: 'paper',
    seed: 482913,
    width: 320,
    height: 200,
    now: new Date('2026-10-20T00:00:00.000Z'),
    layers: [
      createLayer('base-color', { id: 'layer_base', seedOffset: 1, parameters: { color: '#E8D9BD' } }),
      createLayer('paper-fiber', { id: 'layer_paper', seedOffset: 15, opacity: 0.65 }),
      createLayer('grain', { id: 'layer_grain', seedOffset: 31, opacity: 0.2 }),
    ],
  });
}
