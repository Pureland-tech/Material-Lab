import { direction } from '../math';
import type { LayerDefinition } from '../params';
import { num, pixelGrid, rgb, str } from './util';

export const baseColorLayer: LayerDefinition = {
  type: 'base-color',
  family: null,
  label: 'Base color',
  description: 'Solid color or smooth gradient fill, usually the bottom layer.',
  defaultBlendMode: 'normal',
  defaultOpacity: 1,
  params: [
    { id: 'color', kind: 'color', label: 'Color', section: 'color', default: '#E8D9BD', variation: 'palette' },
    {
      id: 'fill',
      kind: 'select',
      label: 'Fill',
      section: 'appearance',
      default: 'solid',
      options: [
        { value: 'solid', label: 'Solid' },
        { value: 'linear', label: 'Linear gradient' },
        { value: 'radial', label: 'Radial gradient' },
      ],
    },
    {
      id: 'color2',
      kind: 'color',
      label: 'Second color',
      section: 'color',
      default: '#C9B48F',
      variation: 'palette',
      visibleWhen: { param: 'fill', equals: ['linear', 'radial'] },
    },
    {
      id: 'angle',
      kind: 'number',
      label: 'Gradient angle',
      section: 'appearance',
      min: 0,
      max: 360,
      step: 1,
      default: 90,
      unit: '°',
      integer: true,
      visibleWhen: { param: 'fill', equals: ['linear'] },
    },
  ],
  coversCanvas: () => true,
  seamless: (params) => ({
    seams: str(params, 'fill') === 'solid' ? [] : ['Gradient fills change across the canvas, so tile edges will not match. Use a solid fill for seamless tiles.'],
    notes: [],
  }),
  makeSeamless: (params) => ({ ...params, fill: 'solid' }),
  render(ctx, out) {
    const { width, y0, y1, params } = ctx;
    const grid = pixelGrid(width, ctx.height, ctx.pixelRatio);
    const c1 = rgb(params, 'color');
    const c2 = rgb(params, 'color2');
    const fill = str(params, 'fill');
    const dir = direction(num(params, 'angle'));
    // Project the canvas corners so a linear gradient spans exactly edge to edge.
    const halfSpan = Math.abs(dir.x) * 0.5 + Math.abs(dir.y) * 0.5;
    let i = 0;
    for (let y = y0; y < y1; y++) {
      const v = ((y + 0.5) * grid.inv) / grid.logicalHeight - 0.5;
      for (let x = 0; x < width; x++, i += 4) {
        let t = 0;
        if (fill === 'linear') {
          const u = ((x + 0.5) * grid.inv) / grid.logicalWidth - 0.5;
          t = halfSpan > 0 ? ((u * dir.x + v * dir.y) / halfSpan) * 0.5 + 0.5 : 0;
        } else if (fill === 'radial') {
          const u = ((x + 0.5) * grid.inv) / grid.logicalWidth - 0.5;
          t = Math.sqrt(u * u + v * v) * 1.41421356;
          if (t > 1) t = 1;
        }
        out[i] = c1[0] + (c2[0] - c1[0]) * t;
        out[i + 1] = c1[1] + (c2[1] - c1[1]) * t;
        out[i + 2] = c1[2] + (c2[2] - c1[2]) * t;
        out[i + 3] = 1;
      }
    }
  },
};
