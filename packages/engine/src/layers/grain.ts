import { axes, fbmSampler, sampler } from '../field';
import { smoothstep } from '../math';
import type { LayerDefinition } from '../params';
import { bool, num, pixelGrid } from './util';

/**
 * Film grain centered on mid-gray. With the default overlay blend, mid-gray is
 * neutral, so the layer only adds grain to whatever is beneath it.
 */
export const grainLayer: LayerDefinition = {
  type: 'grain',
  family: 'grain',
  label: 'Grain',
  description: 'Film grain and subtle analog surface variation.',
  defaultBlendMode: 'overlay',
  defaultOpacity: 1,
  params: [
    {
      id: 'amount',
      kind: 'number',
      label: 'Amount',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.25,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'size',
      kind: 'number',
      label: 'Grain size',
      section: 'structure',
      min: 0.5,
      max: 8,
      step: 0.1,
      default: 1,
      unit: 'px',
      variation: 'scale',
      help: 'Approximate size of one grain in px at 1× export scale.',
    },
    {
      id: 'monochrome',
      kind: 'boolean',
      label: 'Monochrome',
      section: 'color',
      default: true,
      help: 'Off adds independent grain to each color channel.',
    },
    {
      id: 'clumping',
      kind: 'number',
      label: 'Clumping',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.2,
      unit: '%',
      variation: 'structure',
      help: 'How unevenly grain is distributed across the surface.',
    },
    {
      id: 'contrast',
      kind: 'number',
      label: 'Contrast',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
      unit: '%',
      variation: 'intensity',
    },
  ],
  coversCanvas: () => true,
  seamless: () => ({ seams: [], notes: [] }),
  motion: 'Flickers like film grain',
  render(ctx, out) {
    const { width, y0, y1, params, tile } = ctx;
    // Animation: new grain every frame (film flicker), scaled by motion.
    const animated = ctx.time !== null && ctx.motion > 0;
    const seed = animated ? (ctx.seed ^ Math.round((ctx.time as number) * 1e6)) | 0 : ctx.seed;
    const grid = pixelGrid(width, ctx.height, ctx.pixelRatio);
    const amount = num(params, 'amount');
    const size = num(params, 'size');
    const mono = bool(params, 'monochrome');
    const clumping = num(params, 'clumping');
    // When a device pixel covers several grains (reduced-size previews), the
    // export would average them: scale amplitude by the footprint so the
    // preview matches the export viewed at the same size.
    const footprint = Math.min(1, size * ctx.pixelRatio);
    const gain = (1 + num(params, 'contrast') * 2.5) * footprint * (animated ? 0.6 + ctx.motion * 0.4 : 1);
    const cells = axes(tile, size);
    // Fine grain is per-cell white noise; larger grains are smooth lattice
    // noise so they read as soft particles. The choice depends only on logical
    // size, so preview and export use the same method.
    const soft = size > 1.5;
    const lattice = sampler(soft ? 'value' : 'white', cells);
    const halfX = 0.5 / cells.kx;
    const halfY = 0.5 / cells.ky;
    const sample = soft
      ? (x: number, y: number, s: number) => lattice(x, y, s) + lattice(x + halfX, y + halfY, s + 1) - 1
      : (x: number, y: number, s: number) => lattice(x, y, s) + lattice(x, y, s + 1) - 1;
    const clump = fbmSampler('value', axes(tile, 48), 3);
    let i = 0;
    for (let y = y0; y < y1; y++) {
      const ly = (y + 0.5) * grid.inv;
      for (let x = 0; x < width; x++, i += 4) {
        const lx = (x + 0.5) * grid.inv;
        let amp = amount * gain;
        if (clumping > 0) {
          amp *= 1 - clumping + clumping * smoothstep(0.25, 0.75, clump(lx, ly, ctx.seed + 7)) * 1.8;
        }
        const n = sample(lx, ly, seed);
        if (mono) {
          const v = 0.5 + n * amp;
          out[i] = v;
          out[i + 1] = v;
          out[i + 2] = v;
        } else {
          out[i] = 0.5 + n * amp;
          out[i + 1] = 0.5 + sample(lx, ly, seed + 101) * amp;
          out[i + 2] = 0.5 + sample(lx, ly, seed + 202) * amp;
        }
        out[i + 3] = 1;
      }
    }
  },
};
