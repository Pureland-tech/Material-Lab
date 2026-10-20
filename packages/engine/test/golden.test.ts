/**
 * Golden-image test: renders every preset at a small size and compares a
 * hash of the pixels with the committed value. A mismatch means rendering
 * output changed. If that is intended, bump ENGINE_VERSION and run
 * `npm run golden:update`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, PRESETS, renderRecipe } from '../src';
import { hashBytes } from './helpers';

const FILE = fileURLToPath(new URL('./golden/preset-hashes.json', import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === '1';

interface GoldenFile {
  engineVersion: string;
  size: { width: number; height: number; pixelRatio: number };
  hashes: Record<string, string>;
}

const SIZE = { width: 160, height: 100, pixelRatio: 0.1 };

function renderAll(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const preset of PRESETS) hashes[preset.id] = hashBytes(renderRecipe(preset.recipe, SIZE).data);
  return hashes;
}

describe('golden preset renders', () => {
  const hashes = renderAll();

  if (UPDATE) {
    it('updates golden hashes', () => {
      const golden: GoldenFile = { engineVersion: ENGINE_VERSION, size: SIZE, hashes };
      writeFileSync(FILE, `${JSON.stringify(golden, null, 2)}\n`);
    });
    return;
  }

  const golden: GoldenFile | null = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as GoldenFile) : null;

  it('has a golden file for the current engine version', () => {
    expect(golden, 'Run `npm run golden:update` to create golden hashes').not.toBeNull();
    expect(golden?.engineVersion).toBe(ENGINE_VERSION);
  });

  for (const preset of PRESETS) {
    it(`${preset.id} matches its golden hash`, () => {
      expect(hashes[preset.id], 'Rendering changed. If intended, bump ENGINE_VERSION and run `npm run golden:update`.').toBe(
        golden?.hashes[preset.id],
      );
    });
  }
});
