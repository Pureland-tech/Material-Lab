import { direction, smoothstep, type Direction } from '../math';
import { fbm, valueNoise } from '../noise';
import type { LayerDefinition } from '../params';
import { hash01, hash2 } from '../random';
import { num, pixelGrid, rgb } from './util';

const AGED: [number, number, number] = [1, 0.9, 0.74];

/**
 * Shading for one scale of crumpled paper at (x, y): each Voronoi cell is a
 * facet tilted toward or away from the light, and cell borders are creases.
 */
function crumple(x: number, y: number, cell: number, seed: number, aa: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const xi = Math.floor(fx);
  const yi = Math.floor(fy);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const h = hash2(cx, cy, seed);
      const dx = cx + (h & 0xffff) / 65536 - fx;
      const dy = cy + (h >>> 16) / 65536 - fy;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = h;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  // Approximate distance to the cell border in logical px.
  const edge = (Math.sqrt(d2) - Math.sqrt(d1)) * cell * 0.5;
  const facet = ((id >>> 7) & 0xff) / 255 - 0.5;
  const crease = 1 - smoothstep(0, 1.2 + aa * 2, edge);
  const nearEdge = 1 - smoothstep(0, cell * 0.12, edge);
  return facet * 0.13 * (1 - nearEdge * 0.4) - crease * 0.07;
}
const SPECKLE: [number, number, number] = [0.33, 0.29, 0.25];

export const paperLayer: LayerDefinition = {
  type: 'paper-fiber',
  family: 'paper',
  label: 'Paper',
  description: 'Paper fiber, speckle, pulp and fold structure.',
  defaultBlendMode: 'normal',
  defaultOpacity: 1,
  params: [
    { id: 'tone', kind: 'color', label: 'Paper tone', section: 'color', default: '#EFE7D8', variation: 'palette' },
    {
      id: 'warmth',
      kind: 'number',
      label: 'Aging / warmth',
      section: 'color',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.2,
      unit: '%',
      variation: 'palette',
    },
    {
      id: 'fiberDensity',
      kind: 'number',
      label: 'Fiber density',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.45,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'fiberScale',
      kind: 'number',
      label: 'Fiber scale',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
      unit: '%',
      variation: 'scale',
    },
    {
      id: 'fiberLength',
      kind: 'number',
      label: 'Fiber length',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      unit: '%',
      variation: 'structure',
    },
    {
      id: 'directionality',
      kind: 'number',
      label: 'Directionality',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.3,
      unit: '%',
      variation: 'structure',
      help: 'Higher values align fibers in one direction, as in machine-made paper.',
    },
    {
      id: 'speckleAmount',
      kind: 'number',
      label: 'Speckles',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.2,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'speckleSize',
      kind: 'number',
      label: 'Speckle size',
      section: 'appearance',
      min: 0.3,
      max: 4,
      step: 0.1,
      default: 1,
      unit: 'px',
      variation: 'scale',
    },
    {
      id: 'roughness',
      kind: 'number',
      label: 'Roughness',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      unit: '%',
      variation: 'intensity',
      help: 'Unevenness of the pulp surface.',
    },
    {
      id: 'fiberAngle',
      kind: 'number',
      label: 'Fiber angle',
      section: 'advanced',
      min: 0,
      max: 180,
      step: 1,
      default: 0,
      unit: '°',
      integer: true,
    },
    {
      id: 'wrinkle',
      kind: 'number',
      label: 'Wrinkles / folds',
      section: 'advanced',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      unit: '%',
      variation: 'structure',
    },
  ],
  coversCanvas: () => true,
  render(ctx, out) {
    const { width, y0, y1, params, seed } = ctx;
    const grid = pixelGrid(width, ctx.height, ctx.pixelRatio);
    const aa = grid.inv * 0.75;

    const warmth = num(params, 'warmth');
    const toneIn = rgb(params, 'tone');
    const tone = [
      toneIn[0] * (1 + (AGED[0] - 1) * warmth * 0.55),
      toneIn[1] * (1 + (AGED[1] - 1) * warmth * 0.55),
      toneIn[2] * (1 + (AGED[2] - 1) * warmth * 0.55),
    ];
    const density = num(params, 'fiberDensity');
    const scale = 0.5 + num(params, 'fiberScale') * 2.5;
    const cell = 5 * scale;
    const stretch = 2 + num(params, 'fiberLength') * 10;
    const directionality = num(params, 'directionality');
    const speckleAmount = num(params, 'speckleAmount');
    const speckleSize = num(params, 'speckleSize');
    const roughness = num(params, 'roughness');
    const wrinkle = num(params, 'wrinkle');
    const baseAngle = num(params, 'fiberAngle');

    // Up to three fiber orientations; they converge as directionality rises.
    const spread = 60 * (1 - directionality);
    const dirs: Direction[] = [0, 1, 2].map((k) => direction(baseAngle + k * spread));
    const weights = [1, 1 - directionality, 1 - directionality];
    const warpAmount = 4 * (1 - directionality * 0.75);
    const presenceLow = 1 - density;

    const speckleCell = 16 * scale;
    const speckleChance = speckleAmount * 0.55;
    const speckleReach = speckleSize * 1.45 + aa;

    const foldCell = 260 * (0.6 + scale * 0.4);

    let i = 0;
    for (let y = y0; y < y1; y++) {
      const ly = (y + 0.5) * grid.inv;
      for (let x = 0; x < width; x++, i += 4) {
        const lx = (x + 0.5) * grid.inv;

        // Broad pulp unevenness and fine mottling.
        let shade = 1;
        shade += (fbm(valueNoise, lx / 180, ly / 180, seed + 3, 3) - 0.5) * roughness * 0.28;
        shade += (fbm(valueNoise, lx / 5, ly / 5, seed + 5, 2) - 0.5) * roughness * 0.1;
        shade += (hash01(Math.floor(lx), Math.floor(ly), seed + 9) - 0.5) * (0.015 + roughness * 0.03);

        // Fibers: thin iso-lines of noise stretched along each orientation.
        let fiber = 0;
        if (density > 0) {
          for (let k = 0; k < 3; k++) {
            const w = weights[k] as number;
            if (w <= 0) continue;
            const d = dirs[k] as Direction;
            const a = lx * d.x + ly * d.y;
            let b = -lx * d.y + ly * d.x;
            b += (valueNoise(a / 45, b / 45, seed + 11 + k) - 0.5) * warpAmount * cell;
            const n = valueNoise(a / (cell * stretch), b / cell, seed + 31 + k);
            const ridge = 1 - Math.abs(n * 2 - 1);
            const line = smoothstep(0.84, 0.97, ridge);
            if (line <= 0) continue;
            const presence = smoothstep(
              presenceLow,
              presenceLow + 0.3,
              valueNoise(a / (cell * stretch * 1.7), b / (cell * 1.7), seed + 57 + k),
            );
            const polarity = valueNoise(a / (cell * 6), b / (cell * 3), seed + 71 + k) > 0.38 ? 1 : -1.2;
            fiber += line * presence * w * polarity;
          }
        }
        shade += fiber * 0.085;

        // Crumpled folds: flat-shaded facets (Voronoi cells, two scales)
        // separated by thin crease lines.
        if (wrinkle > 0) {
          shade += crumple(lx, ly, foldCell, seed + 77, aa) * wrinkle;
          shade += crumple(lx, ly, foldCell * 0.45, seed + 78, aa) * wrinkle * 0.5;
        }

        let r = tone[0] as number;
        let g = tone[1] as number;
        let bch = tone[2] as number;

        // Aging blotches.
        if (warmth > 0) {
          const blot = smoothstep(0.58, 0.85, fbm(valueNoise, lx / 110, ly / 110, seed + 13, 3)) * warmth * 0.12;
          r -= blot * 0.04;
          g -= blot * 0.12;
          bch -= blot * 0.3;
        }

        r *= shade;
        g *= shade;
        bch *= shade;

        // Speckles: sparse dots on a jittered grid.
        if (speckleChance > 0) {
          const cxf = lx / speckleCell;
          const cyf = ly / speckleCell;
          const gx = Math.floor(cxf);
          const gy = Math.floor(cyf);
          // Neighbouring cells only matter near this cell's borders.
          const fx = (cxf - gx) * speckleCell;
          const fy = (cyf - gy) * speckleCell;
          const xLo = fx < speckleReach ? -1 : 0;
          const xHi = speckleCell - fx < speckleReach ? 1 : 0;
          const yLo = fy < speckleReach ? -1 : 0;
          const yHi = speckleCell - fy < speckleReach ? 1 : 0;
          let spot = 0;
          for (let oy = yLo; oy <= yHi; oy++) {
            for (let ox = xLo; ox <= xHi; ox++) {
              const cx = gx + ox;
              const cy = gy + oy;
              const h = hash2(cx, cy, seed + 91);
              if ((h & 0xffff) / 65536 >= speckleChance) continue;
              const px = (cx + hash01(cx, cy, seed + 92)) * speckleCell;
              const py = (cy + hash01(cx, cy, seed + 93)) * speckleCell;
              const radius = speckleSize * (0.45 + (h >>> 16) / 65536);
              const dx = lx - px;
              const dy = ly - py;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const s = 1 - smoothstep(radius - aa, radius + aa, dist);
              if (s > spot) spot = s;
            }
          }
          if (spot > 0) {
            const t = spot * 0.6;
            r += (SPECKLE[0] - r) * t;
            g += (SPECKLE[1] - g) * t;
            bch += (SPECKLE[2] - bch) * t;
          }
        }

        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = bch;
        out[i + 3] = 1;
      }
    }
  },
};
