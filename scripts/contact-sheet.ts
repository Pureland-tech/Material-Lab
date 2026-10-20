/**
 * Render presets into one contact-sheet PNG (3 columns) for quick visual QA.
 *
 *   npx tsx scripts/contact-sheet.ts out/sheet.png [--width=400] [--family=glass] [--zoom=1]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PRESETS, renderRecipe } from '@material-lab/engine';
import { encodePng } from './lib/png';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const outFile = resolve(args.find((a) => !a.startsWith('--')) ?? 'out/sheet.png');
const tileW = Number(flag('width') ?? 400);
// --zoom=1 renders the full recipe canvas scaled into the tile (like the editor
// preview); --zoom=N shows the top-left 1/N of the canvas at higher detail.
const zoom = Number(flag('zoom') ?? 1);
const family = flag('family');
const cols = Number(flag('cols') ?? 3);
const gap = 8;

const presets = PRESETS.filter((p) => !family || p.family === family || p.id === family);
const tileH = Math.round((tileW * 10) / 16);
const rows = Math.ceil(presets.length / cols);
const W = cols * tileW + (cols + 1) * gap;
const H = rows * tileH + (rows + 1) * gap;
const sheet = new Uint8ClampedArray(W * H * 4);
// Checkerboard background so transparency is visible.
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const v = ((x >> 3) + (y >> 3)) & 1 ? 200 : 235;
    sheet.set([v, v, v, 255], (y * W + x) * 4);
  }
presets.forEach((p, i) => {
  const pixelRatio = (tileW / p.recipe.canvas.width) * zoom;
  const r = renderRecipe(p.recipe, { width: tileW, height: tileH, pixelRatio });
  const ox = gap + (i % cols) * (tileW + gap);
  const oy = gap + Math.floor(i / cols) * (tileH + gap);
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const s = (y * r.width + x) * 4;
      const d = ((oy + y) * W + ox + x) * 4;
      const a = r.data[s + 3]! / 255;
      for (let c = 0; c < 3; c++) sheet[d + c] = r.data[s + c]! * a + sheet[d + c]! * (1 - a);
    }
  console.log(`${i + 1}. ${p.id}`);
});
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, encodePng(W, H, sheet));
console.log(outFile);
