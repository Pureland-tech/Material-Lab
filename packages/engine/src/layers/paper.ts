import { axes, fbmSampler, frame, sampler, wrapCell, type Axes } from '../field';
import { smoothstep } from '../math';
import type { LayerDefinition } from '../params';
import { hash01, hash2 } from '../random';
import { num, pixelGrid, rgb } from './util';

const AGED: [number, number, number] = [1, 0.9, 0.74];

/**
 * Shading for one scale of crumpled paper at (x, y): each Voronoi cell is a
 * facet tilted toward or away from the light, and cell borders are creases.
 */
function crumple(x: number, y: number, ax: Axes, seed: number, aa: number): number {
  const fx = x * ax.kx;
  const fy = y * ax.ky;
  const xi = Math.floor(fx);
  const yi = Math.floor(fy);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const h = hash2(wrapCell(cx, ax.px), wrapCell(cy, ax.py), seed);
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
  const cell = 0.5 / ax.kx + 0.5 / ax.ky;
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
  seamless: (params) => {
    const directional = num(params, 'directionality') >= 1;
    const angle = num(params, 'fiberAngle');
    return {
      seams: [],
      notes: directional && angle % 90 === 0 ? [] : ['Fibers run only horizontally and vertically so the tile repeats.'],
    };
  },
  render(ctx, out) {
    const { width, y0, y1, params, seed, tile } = ctx;
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

    const broad = fbmSampler('value', axes(tile, 180), 3);
    const mottle = fbmSampler('value', axes(tile, 5), 2);
    const pulp = sampler('white', axes(tile, 1));
    const aging = fbmSampler('value', axes(tile, 110), 3);

    // Up to three fiber orientations; they converge as directionality rises.
    const spread = 60 * (1 - directionality);
    const weights = [1, 1 - directionality, 1 - directionality];
    const fibers = [0, 1, 2].map((k) => {
      const f = frame(baseAngle + k * spread, tile);
      return {
        d: f.d,
        warp: sampler('value', axes(f.tile, 45)),
        lines: sampler('value', axes(f.tile, cell * stretch, cell)),
        presence: sampler('value', axes(f.tile, cell * stretch * 1.7, cell * 1.7)),
        polarity: sampler('value', axes(f.tile, cell * 6, cell * 3)),
      };
    });
    const warpAmount = 4 * (1 - directionality * 0.75);
    const presenceLow = 1 - density;

    const speckles = axes(tile, 16 * scale);
    const speckleW = 1 / speckles.kx;
    const speckleH = 1 / speckles.ky;
    const speckleChance = speckleAmount * 0.55;
    const speckleReach = speckleSize * 1.45 + aa;

    const foldCell = 260 * (0.6 + scale * 0.4);
    const folds = axes(tile, foldCell);
    const foldsFine = axes(tile, foldCell * 0.45);

    let i = 0;
    for (let y = y0; y < y1; y++) {
      const ly = (y + 0.5) * grid.inv;
      for (let x = 0; x < width; x++, i += 4) {
        const lx = (x + 0.5) * grid.inv;

        // Broad pulp unevenness and fine mottling.
        let shade = 1;
        shade += (broad(lx, ly, seed + 3) - 0.5) * roughness * 0.28;
        shade += (mottle(lx, ly, seed + 5) - 0.5) * roughness * 0.1;
        shade += (pulp(lx, ly, seed + 9) - 0.5) * (0.015 + roughness * 0.03);

        // Fibers: thin iso-lines of noise stretched along each orientation.
        let fiber = 0;
        if (density > 0) {
          for (let k = 0; k < 3; k++) {
            const w = weights[k] as number;
            if (w <= 0) continue;
            const f = fibers[k] as (typeof fibers)[number];
            const a = lx * f.d.x + ly * f.d.y;
            let b = -lx * f.d.y + ly * f.d.x;
            b += (f.warp(a, b, seed + 11 + k) - 0.5) * warpAmount * cell;
            const n = f.lines(a, b, seed + 31 + k);
            const ridge = 1 - Math.abs(n * 2 - 1);
            const line = smoothstep(0.84, 0.97, ridge);
            if (line <= 0) continue;
            const presence = smoothstep(presenceLow, presenceLow + 0.3, f.presence(a, b, seed + 57 + k));
            const polarity = f.polarity(a, b, seed + 71 + k) > 0.38 ? 1 : -1.2;
            fiber += line * presence * w * polarity;
          }
        }
        shade += fiber * 0.085;

        // Crumpled folds: flat-shaded facets (Voronoi cells, two scales)
        // separated by thin crease lines.
        if (wrinkle > 0) {
          shade += crumple(lx, ly, folds, seed + 77, aa) * wrinkle;
          shade += crumple(lx, ly, foldsFine, seed + 78, aa) * wrinkle * 0.5;
        }

        let r = tone[0] as number;
        let g = tone[1] as number;
        let bch = tone[2] as number;

        // Aging blotches.
        if (warmth > 0) {
          const blot = smoothstep(0.58, 0.85, aging(lx, ly, seed + 13)) * warmth * 0.12;
          r -= blot * 0.04;
          g -= blot * 0.12;
          bch -= blot * 0.3;
        }

        r *= shade;
        g *= shade;
        bch *= shade;

        // Speckles: sparse dots on a jittered grid.
        if (speckleChance > 0) {
          const cxf = lx * speckles.kx;
          const cyf = ly * speckles.ky;
          const gx = Math.floor(cxf);
          const gy = Math.floor(cyf);
          // Neighbouring cells only matter near this cell's borders.
          const fx = (cxf - gx) * speckleW;
          const fy = (cyf - gy) * speckleH;
          const xLo = fx < speckleReach ? -1 : 0;
          const xHi = speckleW - fx < speckleReach ? 1 : 0;
          const yLo = fy < speckleReach ? -1 : 0;
          const yHi = speckleH - fy < speckleReach ? 1 : 0;
          let spot = 0;
          for (let oy = yLo; oy <= yHi; oy++) {
            for (let ox = xLo; ox <= xHi; ox++) {
              const cx = gx + ox;
              const cy = gy + oy;
              const hx = wrapCell(cx, speckles.px);
              const hy = wrapCell(cy, speckles.py);
              const h = hash2(hx, hy, seed + 91);
              if ((h & 0xffff) / 65536 >= speckleChance) continue;
              const px = (cx + hash01(hx, hy, seed + 92)) * speckleW;
              const py = (cy + hash01(hx, hy, seed + 93)) * speckleH;
              const radius = speckleSize * (0.45 + (h >>> 16) / 65536);
              const dx = lx - px;
              const dy = ly - py;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const sp = 1 - smoothstep(radius - aa, radius + aa, dist);
              if (sp > spot) spot = sp;
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
