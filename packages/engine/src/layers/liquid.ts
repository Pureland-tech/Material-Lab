import { direction, smoothstep } from '../math';
import { fbm, gradientNoise } from '../noise';
import type { LayerDefinition } from '../params';
import { num, pixelGrid, rgb } from './util';

export const liquidLayer: LayerDefinition = {
  type: 'liquid',
  family: 'liquid',
  label: 'Liquid',
  description: 'Fluid distortion, marbling, flowing contours and organic swirls.',
  defaultBlendMode: 'normal',
  defaultOpacity: 1,
  params: [
    { id: 'colorA', kind: 'color', label: 'Deep color', section: 'color', default: '#101B3D', variation: 'palette' },
    { id: 'colorB', kind: 'color', label: 'Mid color', section: 'color', default: '#3D6CF0', variation: 'palette' },
    { id: 'colorC', kind: 'color', label: 'Accent color', section: 'color', default: '#F2B8E6', variation: 'palette' },
    {
      id: 'swirlScale',
      kind: 'number',
      label: 'Swirl scale',
      section: 'structure',
      min: 40,
      max: 1000,
      step: 1,
      default: 320,
      unit: 'px',
      integer: true,
      variation: 'scale',
    },
    {
      id: 'distortion',
      kind: 'number',
      label: 'Distortion',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      unit: '%',
      variation: 'intensity',
      help: 'Low values keep calm, readable backgrounds.',
    },
    {
      id: 'flowAngle',
      kind: 'number',
      label: 'Flow direction',
      section: 'structure',
      min: 0,
      max: 360,
      step: 1,
      default: 30,
      unit: '°',
      integer: true,
    },
    {
      id: 'smoothness',
      kind: 'number',
      label: 'Smoothness',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      unit: '%',
      variation: 'structure',
    },
    {
      id: 'edgeDetail',
      kind: 'number',
      label: 'Edge detail',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.25,
      unit: '%',
      variation: 'intensity',
      help: 'Thin marbled contour lines through the flow.',
    },
    {
      id: 'accent',
      kind: 'number',
      label: 'Accent amount',
      section: 'color',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.45,
      unit: '%',
      variation: 'palette',
    },
  ],
  coversCanvas: () => true,
  render(ctx, out) {
    const { width, y0, y1, params, seed } = ctx;
    const grid = pixelGrid(width, ctx.height, ctx.pixelRatio);
    const a = rgb(params, 'colorA');
    const b = rgb(params, 'colorB');
    const c = rgb(params, 'colorC');
    const invScale = 1 / num(params, 'swirlScale');
    const warp = num(params, 'distortion') * 4;
    const flow = direction(num(params, 'flowAngle'));
    const smoothness = num(params, 'smoothness');
    const octaves = smoothness > 0.66 ? 3 : smoothness > 0.33 ? 4 : 5;
    const gain = 0.62 - smoothness * 0.24;
    const edge = num(params, 'edgeDetail');
    const accent = num(params, 'accent');
    const lineWidth = 0.07;

    let i = 0;
    for (let y = y0; y < y1; y++) {
      const ly = (y + 0.5) * grid.inv;
      for (let x = 0; x < width; x++, i += 4) {
        const lx = (x + 0.5) * grid.inv;
        // Rotate into flow space and stretch along the flow.
        const px = (lx * flow.x + ly * flow.y) * invScale * 0.55;
        const py = (-lx * flow.y + ly * flow.x) * invScale;

        // Domain warping: noise displaces the coordinates of more noise.
        const qx = fbm(gradientNoise, px, py, seed, octaves, gain);
        const qy = fbm(gradientNoise, px + 5.2, py + 1.3, seed + 1, octaves, gain);
        const rx = fbm(gradientNoise, px + warp * qx + 1.7, py + warp * qy + 9.2, seed + 2, octaves, gain);
        const ry = fbm(gradientNoise, px + warp * qx + 8.3, py + warp * qy + 2.8, seed + 3, octaves, gain);
        const f = fbm(gradientNoise, px + warp * rx, py + warp * ry, seed + 4, octaves, gain);

        const t = smoothstep(0.25, 0.75, f);
        let cr = a[0] + (b[0] - a[0]) * t;
        let cg = a[1] + (b[1] - a[1]) * t;
        let cb = a[2] + (b[2] - a[2]) * t;

        const accentMix = smoothstep(0.52, 0.78, (rx + qy) * 0.5) * accent;
        cr += (c[0] - cr) * accentMix;
        cg += (c[1] - cg) * accentMix;
        cb += (c[2] - cb) * accentMix;

        if (edge > 0) {
          // Contour lines of the final field give a marbled edge.
          const band = f * 8;
          const d = Math.abs(band - Math.floor(band) - 0.5);
          const line = smoothstep(0.5 - lineWidth, 0.5, d) * edge * 0.55;
          cr += (1 - cr) * line;
          cg += (1 - cg) * line;
          cb += (1 - cb) * line;
        }

        out[i] = cr;
        out[i + 1] = cg;
        out[i + 2] = cb;
        out[i + 3] = 1;
      }
    }
  },
};
