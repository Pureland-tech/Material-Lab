/**
 * Render every preset to PNG for visual QA.
 *
 *   npm run render:presets -- [outDir] [--width=800] [--scale=1] [--only=id,id]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PRESETS, renderRecipe } from '@material-lab/engine';
import { encodePng } from './lib/png';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'out/presets');
const width = Number(flag('width') ?? 800);
const scale = Number(flag('scale') ?? 1);
const only = flag('only')?.split(',');

mkdirSync(outDir, { recursive: true });
for (const preset of PRESETS) {
  if (only && !only.includes(preset.id)) continue;
  const { recipe } = preset;
  const height = Math.round((width * recipe.canvas.height) / recipe.canvas.width);
  const start = performance.now();
  const result = renderRecipe(recipe, { width: width * scale, height: height * scale, pixelRatio: scale });
  const ms = performance.now() - start;
  const file = join(outDir, `${preset.family}-${preset.id}.png`);
  writeFileSync(file, encodePng(result.width, result.height, result.data));
  console.log(`${preset.id.padEnd(28)} ${result.width}×${result.height}  ${ms.toFixed(0).padStart(5)} ms  ${file}`);
}
