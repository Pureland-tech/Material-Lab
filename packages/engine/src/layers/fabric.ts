import { direction, smoothstep } from '../math';
import { fbm, gradientNoise, valueNoise } from '../noise';
import type { LayerDefinition } from '../params';
import { hash1 } from '../random';
import { num, pixelGrid, rgb, str } from './util';

type Weave = 'plain' | 'twill' | 'basket' | 'linen';

/** True when the warp (vertical) thread is on top at cell (i, j). */
function warpOnTop(weave: Weave, i: number, j: number): boolean {
  switch (weave) {
    case 'twill':
      return (((i + j) % 4) + 4) % 4 < 2;
    case 'basket':
      return ((Math.floor(i / 2) + Math.floor(j / 2)) & 1) === 0;
    default:
      return ((i + j) & 1) === 0;
  }
}

export const fabricLayer: LayerDefinition = {
  type: 'fabric',
  family: 'fabric',
  label: 'Fabric',
  description: 'Woven linen, canvas, twill and basket-weave textiles.',
  defaultBlendMode: 'normal',
  defaultOpacity: 1,
  params: [
    {
      id: 'weave',
      kind: 'select',
      label: 'Weave',
      section: 'structure',
      default: 'plain',
      variation: 'structure',
      options: [
        { value: 'plain', label: 'Plain (canvas)' },
        { value: 'linen', label: 'Linen (irregular)' },
        { value: 'twill', label: 'Twill' },
        { value: 'basket', label: 'Basket' },
      ],
    },
    {
      id: 'threadScale',
      kind: 'number',
      label: 'Thread size',
      section: 'structure',
      min: 2,
      max: 40,
      step: 0.5,
      default: 6,
      unit: 'px',
      variation: 'scale',
      help: 'Width of one warp/weft thread in px at 1× export scale.',
    },
    {
      id: 'threadDensity',
      kind: 'number',
      label: 'Thread density',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.8,
      unit: '%',
      variation: 'structure',
      help: 'Lower values leave visible gaps between threads.',
    },
    {
      id: 'rotation',
      kind: 'number',
      label: 'Rotation',
      section: 'structure',
      min: 0,
      max: 180,
      step: 1,
      default: 0,
      unit: '°',
      integer: true,
    },
    { id: 'warpColor', kind: 'color', label: 'Warp color', section: 'color', default: '#CDBB9F', variation: 'palette' },
    { id: 'weftColor', kind: 'color', label: 'Weft color', section: 'color', default: '#BCA787', variation: 'palette' },
    {
      id: 'colorVariation',
      kind: 'number',
      label: 'Color variation',
      section: 'color',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.25,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'fiberVariation',
      kind: 'number',
      label: 'Fiber variation',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.45,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'roughness',
      kind: 'number',
      label: 'Roughness',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.3,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'contrast',
      kind: 'number',
      label: 'Contrast',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      unit: '%',
      variation: 'intensity',
    },
  ],
  coversCanvas: () => true,
  render(ctx, out) {
    const { width, y0, y1, params, seed, pixelRatio } = ctx;
    const grid = pixelGrid(width, ctx.height, pixelRatio);
    const weave = str(params, 'weave') as Weave;
    const s = num(params, 'threadScale');
    const gap = (1 - num(params, 'threadDensity')) * 0.45;
    const rot = direction(num(params, 'rotation'));
    const warpColor = rgb(params, 'warpColor');
    const weftColor = rgb(params, 'weftColor');
    const colorVar = num(params, 'colorVariation') * 0.35;
    const fiberVar = num(params, 'fiberVariation') * 0.45;
    const roughness = num(params, 'roughness');
    const depth = 0.35 + num(params, 'contrast') * 0.9;
    const linen = weave === 'linen';
    // Supersample when threads are only a few device pixels wide to avoid moiré.
    // Below ~2 device px per thread the weave cannot be resolved; fade its
    // shading toward the average so small previews show color, not moiré.
    const detail = smoothstep(0.9, 2.6, s * pixelRatio);
    const ss = detail > 0 && s * pixelRatio < 7 ? 2 : 1;
    const ssStep = grid.inv / ss;
    const ssOffset = -grid.inv / 2 + ssStep / 2;
    const ssNorm = 1 / (ss * ss);

    // Shade one thread crossing. `across` is 0–1 across the thread, `along`
    // 0–1 along it; diveStart/diveEnd say whether the thread passes under its
    // neighbour at either end of the cell.
    const threadShade = (across: number, along: number, halfGap: number, diveStart: boolean, diveEnd: boolean) => {
      const inner = 1 - 2 * halfGap;
      const c = (across - halfGap) / inner;
      if (c < 0 || c > 1) return -1;
      const p = 1 - (2 * c - 1) * (2 * c - 1);
      let shade = 0.5 + 0.5 * p;
      if (diveStart) shade *= 0.72 + 0.28 * smoothstep(0, 0.3, along);
      if (diveEnd) shade *= 0.72 + 0.28 * smoothstep(0, 0.3, 1 - along);
      return shade;
    };

    let i = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < width; x++, i += 4) {
        // Low-frequency terms are evaluated once per pixel, not per subsample.
        const px = (x + 0.5) * grid.inv;
        const py = (y + 0.5) * grid.inv;
        const pa = px * rot.x + py * rot.y;
        const pc = -px * rot.y + py * rot.x;
        // Threads wander slightly.
        const wanderA = (valueNoise(pc / (s * 9), pa / (s * 30), seed + 1) - 0.5) * s * roughness * 0.5;
        const wanderC = (valueNoise(pa / (s * 9), pc / (s * 30), seed + 2) - 0.5) * s * roughness * 0.5;
        const unevenness = 1 + (fbm(gradientNoise, px / 160, py / 160, seed + 11, 3) - 0.5) * roughness * 0.3;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) {
            const lx = px + ssOffset + sx * ssStep;
            const ly = py + ssOffset + sy * ssStep;
            const a = lx * rot.x + ly * rot.y + wanderA;
            const c = -lx * rot.y + ly * rot.x + wanderC;
            const fi = a / s;
            const fj = c / s;
            const ci = Math.floor(fi);
            const cj = Math.floor(fj);
            const fa = fi - ci;
            const fb = fj - cj;

            let warpGap = gap / 2;
            let weftGap = gap / 2;
            if (linen) {
              // Irregular thread thickness (slubs) for linen.
              warpGap = Math.max(0, gap / 2 + (hash1(ci, seed + 3) - 0.5) * 0.18 + (valueNoise(ci * 7.13, fj / 6, seed + 4) - 0.5) * 0.14);
              weftGap = Math.max(0, gap / 2 + (hash1(cj, seed + 5) - 0.5) * 0.18 + (valueNoise(fi / 6, cj * 7.13, seed + 6) - 0.5) * 0.14);
            }

            const warpTop = warpOnTop(weave, ci, cj);
            let shade: number;
            let isWarp: boolean;
            if (warpTop) {
              shade = threadShade(fa, fb, warpGap, !warpOnTop(weave, ci, cj - 1), !warpOnTop(weave, ci, cj + 1));
              isWarp = true;
              if (shade < 0) {
                shade = threadShade(fb, fa, weftGap, false, false);
                isWarp = false;
                if (shade >= 0) shade *= 0.7;
              }
            } else {
              shade = threadShade(fb, fa, weftGap, warpOnTop(weave, ci - 1, cj), warpOnTop(weave, ci + 1, cj));
              isWarp = false;
              if (shade < 0) {
                shade = threadShade(fa, fb, warpGap, false, false);
                isWarp = true;
                if (shade >= 0) shade *= 0.7;
              }
            }

            const base = isWarp ? warpColor : weftColor;
            let tone = 1;
            if (shade < 0) {
              // Hole between threads.
              shade = 0.28;
            } else {
              // Fibers run along the thread; per-thread color variation.
              const fiber = isWarp
                ? valueNoise(fa * 6, fj * 1.2, seed + 7 + ci * 13)
                : valueNoise(fi * 1.2, fb * 6, seed + 8 + cj * 13);
              shade *= 1 + (fiber - 0.5) * fiberVar;
              tone += (hash1(isWarp ? ci : cj, seed + (isWarp ? 9 : 10)) - 0.5) * colorVar;
            }
            shade = 1 + (shade - 0.82) * depth * detail;
            const k = shade * tone * unevenness;
            r += base[0] * k;
            g += base[1] * k;
            b += base[2] * k;
          }
        }
        out[i] = r * ssNorm;
        out[i + 1] = g * ssNorm;
        out[i + 2] = b * ssNorm;
        out[i + 3] = 1;
      }
    }
  },
};
