import { axes, fbmSampler, loopOffset, ridgedSampler, sampler } from '../field';
import type { LayerDefinition } from '../params';
import { bool, num, pixelGrid, rgb, str } from './util';

export const noiseLayer: LayerDefinition = {
  type: 'noise',
  family: 'noise',
  label: 'Noise',
  description: 'Procedural noise fields, fine overlays and dither-like textures.',
  defaultBlendMode: 'normal',
  defaultOpacity: 1,
  params: [
    {
      id: 'noiseType',
      kind: 'select',
      label: 'Noise type',
      section: 'structure',
      default: 'gradient',
      variation: 'structure',
      options: [
        { value: 'gradient', label: 'Smooth (gradient)' },
        { value: 'value', label: 'Soft (value)' },
        { value: 'cellular', label: 'Cellular' },
        { value: 'ridged', label: 'Ridged' },
        { value: 'white', label: 'White / pixel' },
      ],
    },
    {
      id: 'scale',
      kind: 'number',
      label: 'Scale',
      section: 'structure',
      min: 1,
      max: 600,
      step: 1,
      default: 80,
      unit: 'px',
      integer: true,
      variation: 'scale',
      help: 'Feature size in px at 1× export scale.',
    },
    {
      id: 'amplitude',
      kind: 'number',
      label: 'Amplitude',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'contrast',
      kind: 'number',
      label: 'Contrast',
      section: 'appearance',
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
      unit: '%',
      variation: 'intensity',
    },
    { id: 'colorA', kind: 'color', label: 'Low color', section: 'color', default: '#1C1D22', variation: 'palette' },
    { id: 'colorB', kind: 'color', label: 'High color', section: 'color', default: '#E9E7E2', variation: 'palette' },
    {
      id: 'colored',
      kind: 'boolean',
      label: 'Colored noise',
      section: 'color',
      default: false,
      help: 'Uses independent noise per color channel instead of one monochrome field.',
    },
    {
      id: 'alphaOutput',
      kind: 'boolean',
      label: 'Alpha output',
      section: 'appearance',
      default: false,
      help: 'Outputs the noise as transparency in the high color, for overlays and masks.',
    },
    {
      id: 'octaves',
      kind: 'number',
      label: 'Octaves',
      section: 'advanced',
      min: 1,
      max: 6,
      step: 1,
      default: 4,
      integer: true,
      help: 'Number of detail layers summed together. More octaves add finer detail.',
    },
    {
      id: 'detail',
      kind: 'number',
      label: 'Detail strength',
      section: 'advanced',
      min: 0.2,
      max: 0.8,
      step: 0.01,
      default: 0.5,
      variation: 'structure',
      help: 'How strongly each finer octave contributes (lower is smoother).',
    },
  ],
  coversCanvas: (params) => !bool(params, 'alphaOutput'),
  seamless: () => ({ seams: [], notes: [] }),
  motion: 'Drifts in a loop (white noise re-rolls each frame)',
  render(ctx, out) {
    const { width, y0, y1, params, seed, tile } = ctx;
    const grid = pixelGrid(width, ctx.height, ctx.pixelRatio);
    const type = str(params, 'noiseType');
    const scale = num(params, 'scale');
    const ax = axes(tile, scale);
    const drift = loopOffset(ctx.time, ctx.motion * scale);
    // White noise has no structure to drift: animate it by re-rolling per frame.
    const frameSeed = type === 'white' && ctx.time !== null && ctx.motion > 0 ? (seed ^ Math.round(ctx.time * 1e6)) | 0 : seed;
    const amplitude = num(params, 'amplitude');
    const contrast = 1 + num(params, 'contrast');
    const colorA = rgb(params, 'colorA');
    const colorB = rgb(params, 'colorB');
    const colored = bool(params, 'colored');
    const alphaOutput = bool(params, 'alphaOutput');
    const octaves = num(params, 'octaves');
    const gain = num(params, 'detail');

    let field: (x: number, y: number, s: number) => number;
    if (type === 'white') {
      field = sampler('white', ax);
    } else if (type === 'ridged') {
      field = ridgedSampler('gradient', ax, octaves, gain);
    } else if (type === 'cellular') {
      const cells = fbmSampler('cellular', ax, Math.min(octaves, 3), gain);
      field = (x, y, s) => 1 - cells(x, y, s);
    } else {
      field = fbmSampler(type === 'value' ? 'value' : 'gradient', ax, octaves, gain);
    }
    const shape = (n: number) => {
      let v = (n - 0.5) * contrast * amplitude + 0.5;
      if (v < 0) v = 0;
      else if (v > 1) v = 1;
      return v;
    };

    let i = 0;
    for (let y = y0; y < y1; y++) {
      const ly = (y + 0.5) * grid.inv + drift.y;
      for (let x = 0; x < width; x++, i += 4) {
        const lx = (x + 0.5) * grid.inv + drift.x;
        const n = shape(field(lx, ly, frameSeed));
        if (alphaOutput) {
          out[i] = colorB[0];
          out[i + 1] = colorB[1];
          out[i + 2] = colorB[2];
          out[i + 3] = n;
        } else if (colored) {
          const ng = shape(field(lx, ly, frameSeed + 101));
          const nb = shape(field(lx, ly, frameSeed + 202));
          out[i] = colorA[0] + (colorB[0] - colorA[0]) * n;
          out[i + 1] = colorA[1] + (colorB[1] - colorA[1]) * ng;
          out[i + 2] = colorA[2] + (colorB[2] - colorA[2]) * nb;
          out[i + 3] = 1;
        } else {
          out[i] = colorA[0] + (colorB[0] - colorA[0]) * n;
          out[i + 1] = colorA[1] + (colorB[1] - colorA[1]) * n;
          out[i + 2] = colorA[2] + (colorB[2] - colorA[2]) * n;
          out[i + 3] = 1;
        }
      }
    }
  },
};
