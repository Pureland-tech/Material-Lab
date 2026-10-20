import type { RGB } from '../color';
import { direction, smoothWave, smoothstep } from '../math';
import { fbm, gradientNoise, valueNoise } from '../noise';
import type { LayerDefinition } from '../params';
import { hash01, hash2 } from '../random';
import { hexToRgb } from '../color';
import { num, pixelGrid, rgb, str } from './util';

const METALS: Record<string, string> = {
  silver: '#C4C9CF',
  gold: '#D8B25C',
  'rose-gold': '#D9A08F',
  copper: '#C77B52',
  graphite: '#62666E',
};

export const metallicLayer: LayerDefinition = {
  type: 'metallic',
  family: 'metallic',
  label: 'Metallic',
  description: 'Brushed metal, reflective bands and stylized chrome-like finishes.',
  defaultBlendMode: 'normal',
  defaultOpacity: 1,
  note: 'Stylized 2D metal effect, not an environment-mapped 3D material.',
  params: [
    {
      id: 'metal',
      kind: 'select',
      label: 'Metal',
      section: 'color',
      default: 'silver',
      options: [
        { value: 'silver', label: 'Silver' },
        { value: 'gold', label: 'Gold' },
        { value: 'rose-gold', label: 'Rose gold' },
        { value: 'copper', label: 'Copper' },
        { value: 'graphite', label: 'Graphite' },
        { value: 'custom', label: 'Custom alloy color' },
      ],
    },
    {
      id: 'tint',
      kind: 'color',
      label: 'Alloy color',
      section: 'color',
      default: '#8FA7C7',
      variation: 'palette',
      visibleWhen: { param: 'metal', equals: ['custom'] },
    },
    {
      id: 'highlightAngle',
      kind: 'number',
      label: 'Highlight direction',
      section: 'lighting',
      min: 0,
      max: 360,
      step: 1,
      default: 60,
      unit: '°',
      integer: true,
    },
    {
      id: 'highlightWidth',
      kind: 'number',
      label: 'Highlight width',
      section: 'lighting',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.35,
      unit: '%',
      variation: 'structure',
    },
    {
      id: 'bands',
      kind: 'number',
      label: 'Reflection bands',
      section: 'lighting',
      min: 1,
      max: 8,
      step: 1,
      default: 2,
      integer: true,
      variation: 'structure',
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
      help: 'Softens and breaks up reflections.',
    },
    {
      id: 'contrast',
      kind: 'number',
      label: 'Contrast',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      unit: '%',
      variation: 'intensity',
      help: 'Depth of shadows and highlight roll-off.',
    },
    {
      id: 'brushAngle',
      kind: 'number',
      label: 'Brush direction',
      section: 'structure',
      min: 0,
      max: 180,
      step: 1,
      default: 0,
      unit: '°',
      integer: true,
    },
    {
      id: 'brushStrength',
      kind: 'number',
      label: 'Brushed lines',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'brushScale',
      kind: 'number',
      label: 'Brush scale',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.4,
      unit: '%',
      variation: 'scale',
    },
    {
      id: 'scratches',
      kind: 'number',
      label: 'Scratches',
      section: 'advanced',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.1,
      unit: '%',
      variation: 'intensity',
    },
  ],
  coversCanvas: () => true,
  render(ctx, out) {
    const { width, y0, y1, params, seed } = ctx;
    const grid = pixelGrid(width, ctx.height, ctx.pixelRatio);
    const metal = str(params, 'metal');
    const base: RGB = metal === 'custom' ? rgb(params, 'tint') : hexToRgb(METALS[metal] ?? METALS.silver!);
    // Shading ramp keeps a metallic look for any alloy color: deep shadow,
    // the alloy itself, and a near-white highlight.
    const dark: RGB = [base[0] * 0.2, base[1] * 0.2, base[2] * 0.22];
    const light: RGB = [base[0] + (1 - base[0]) * 0.55, base[1] + (1 - base[1]) * 0.55, base[2] + (1 - base[2]) * 0.55];

    const hl = direction(num(params, 'highlightAngle'));
    const hlWidth = num(params, 'highlightWidth');
    const bands = num(params, 'bands');
    const roughness = num(params, 'roughness');
    const contrast = 0.55 + num(params, 'contrast') * 1.1;
    const brush = direction(num(params, 'brushAngle'));
    const brushStrength = num(params, 'brushStrength');
    const brushLen = 30 + num(params, 'brushScale') * 220;
    const brushWidth = 0.6 + num(params, 'brushScale') * 1.4;
    const scratches = num(params, 'scratches');
    const aa = grid.inv * 0.75;
    const scratchCell = 90;

    // Specular peaks: narrow for polished metal, wider and softer when rough.
    const peak = 0.06 + hlWidth * 0.32 + roughness * 0.18;
    const warpAmount = 0.05 + roughness * 0.12;
    const white: RGB = [0.97, 0.97, 0.98];

    let i = 0;
    for (let y = y0; y < y1; y++) {
      const ly = (y + 0.5) * grid.inv;
      const v = ly / grid.logicalHeight - 0.5;
      for (let x = 0; x < width; x++, i += 4) {
        const lx = (x + 0.5) * grid.inv;
        const u = lx / grid.logicalWidth - 0.5;

        // Position across the reflection, gently warped so bands are not ruler-straight.
        let t = u * hl.x + v * hl.y;
        t += (fbm(gradientNoise, u * 1.6, v * 1.6, seed + 3, 2) - 0.5) * warpAmount;

        // Broad environment gradient, soft reflection bands, a dark band
        // between reflections, and narrow specular peaks.
        const wave = smoothWave(t * bands + 0.3);
        const spec = smoothstep(1 - peak, 1, wave);
        const shadow = smoothstep(0.4, 0, wave);
        let lum = 0.44 + 0.16 * t + 0.14 * wave * wave - 0.14 * shadow + 0.3 * spec;

        // Brushed lines: noise stretched hard along the brush direction.
        if (brushStrength > 0) {
          const a = lx * brush.x + ly * brush.y;
          const b = -lx * brush.y + ly * brush.x;
          const n1 = valueNoise(a / brushLen, b / brushWidth, seed + 11);
          const n2 = valueNoise(a / (brushLen * 0.35), b / (brushWidth * 2.6), seed + 12);
          lum += ((n1 - 0.5) * 0.7 + (n2 - 0.5) * 0.3) * brushStrength * 0.22;
        }

        // Fine microtexture.
        lum += (hash01(Math.floor(lx * 1.5), Math.floor(ly * 1.5), seed + 13) - 0.5) * (0.015 + roughness * 0.03);

        // Scratches: sparse thin straight segments.
        if (scratches > 0) {
          const gx = Math.floor(lx / scratchCell);
          const gy = Math.floor(ly / scratchCell);
          let s = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const cx = gx + ox;
              const cy = gy + oy;
              const h = hash2(cx, cy, seed + 21);
              const count = Math.floor(((h & 0xff) / 256) * 3 * scratches + scratches * 0.6);
              for (let k = 0; k < count; k++) {
                const px = (cx + hash01(cx * 8 + k, cy, seed + 22)) * scratchCell;
                const py = (cy + hash01(cx * 8 + k, cy, seed + 23)) * scratchCell;
                // Direction from a hashed point on the unit circle (no trig per pixel).
                let dx = hash01(cx * 8 + k, cy, seed + 24) - 0.5;
                let dy = hash01(cx * 8 + k, cy, seed + 25) - 0.5;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                dx /= len;
                dy /= len;
                const half = scratchCell * (0.15 + hash01(cx * 8 + k, cy, seed + 26) * 0.45);
                const rx = lx - px;
                const ry = ly - py;
                const along = rx * dx + ry * dy;
                if (along < -half || along > half) continue;
                const across = Math.abs(rx * -dy + ry * dx);
                const fadeEnds = 1 - smoothstep(half * 0.6, half, Math.abs(along));
                const line = (1 - smoothstep(0.25, 0.25 + aa * 2, across)) * fadeEnds;
                if (line > s) s = line;
              }
            }
          }
          lum += s * (0.12 + scratches * 0.2);
        }

        lum = (lum - 0.5) * contrast + 0.5;
        // Four-stop ramp: shadow → alloy → light alloy → near-white specular.
        let from: RGB;
        let to: RGB;
        let k: number;
        if (lum < 0.45) {
          from = dark;
          to = base;
          k = lum < 0 ? 0 : lum / 0.45;
        } else if (lum < 0.85) {
          from = base;
          to = light;
          k = (lum - 0.45) / 0.4;
        } else {
          from = light;
          to = white;
          k = lum > 1 ? 1 : (lum - 0.85) / 0.15;
        }
        const r = from[0] + (to[0] - from[0]) * k;
        const g = from[1] + (to[1] - from[1]) * k;
        const bc = from[2] + (to[2] - from[2]) * k;
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = bc;
        out[i + 3] = 1;
      }
    }
  },
};
