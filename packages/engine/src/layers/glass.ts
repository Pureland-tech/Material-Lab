import { direction, smoothstep } from '../math';
import { fbm, gradientNoise } from '../noise';
import type { LayerDefinition } from '../params';
import { hash01 } from '../random';
import { num, pixelGrid, rgb } from './util';

const MAX_REFRACTION_PX = 16;
/** Device-pixel spacing of the refraction offset grid. */
const REFRACTION_STEP = 4;

function boxRadius(frost: number, pixelRatio: number): number {
  // Three box passes of radius r approximate a Gaussian with sigma ≈ r.
  return Math.round(frost * pixelRatio);
}

function refractionPx(refraction: number, pixelRatio: number): number {
  return Math.ceil(refraction * MAX_REFRACTION_PX * pixelRatio);
}

/**
 * Fixed-point scale for blurring. Box blur runs on exact integers so the
 * result does not depend on where a band starts: any partition of the image
 * into bands (or parallel row chunks) produces identical pixels.
 */
const FIXED = 65535;

/**
 * Box-blur rows horizontally (fixed-point RGBA), clamping at the image edges.
 * Sums are exact integers; dividing by a constant and rounding is the same
 * arithmetic for every pixel, so results never depend on band boundaries.
 */
function blurRows(src: Int32Array, dst: Int32Array, w: number, rows: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const last = w - 1;
  for (let y = 0; y < rows; y++) {
    const row = y * w * 4;
    let a0 = (src[row] as number) * (r + 1);
    let a1 = (src[row + 1] as number) * (r + 1);
    let a2 = (src[row + 2] as number) * (r + 1);
    let a3 = (src[row + 3] as number) * (r + 1);
    for (let k = 1; k <= r; k++) {
      const i = row + (k < last ? k : last) * 4;
      a0 += src[i] as number;
      a1 += src[i + 1] as number;
      a2 += src[i + 2] as number;
      a3 += src[i + 3] as number;
    }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      dst[o] = Math.floor(a0 * inv + 0.5);
      dst[o + 1] = Math.floor(a1 * inv + 0.5);
      dst[o + 2] = Math.floor(a2 * inv + 0.5);
      dst[o + 3] = Math.floor(a3 * inv + 0.5);
      const add = row + (x + r + 1 < last ? x + r + 1 : last) * 4;
      const sub = row + (x - r > 0 ? x - r : 0) * 4;
      a0 += (src[add] as number) - (src[sub] as number);
      a1 += (src[add + 1] as number) - (src[sub + 1] as number);
      a2 += (src[add + 2] as number) - (src[sub + 2] as number);
      a3 += (src[add + 3] as number) - (src[sub + 3] as number);
    }
  }
}

/**
 * Box-blur columns, sweeping rows top to bottom with one running sum per
 * column (cache-friendly). The buffer's first/last rows are treated as edges.
 */
function blurCols(src: Int32Array, dst: Int32Array, w: number, rows: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const last = rows - 1;
  const stride = w * 4;
  const acc = new Float64Array(stride);
  for (let i = 0; i < stride; i++) acc[i] = (src[i] as number) * (r + 1);
  for (let k = 1; k <= r; k++) {
    const off = (k < last ? k : last) * stride;
    for (let i = 0; i < stride; i++) acc[i] = (acc[i] as number) + (src[off + i] as number);
  }
  for (let y = 0; y < rows; y++) {
    const o = y * stride;
    const add = (y + r + 1 < last ? y + r + 1 : last) * stride;
    const sub = (y - r > 0 ? y - r : 0) * stride;
    for (let i = 0; i < stride; i++) {
      const a = acc[i] as number;
      dst[o + i] = Math.floor(a * inv + 0.5);
      acc[i] = a + (src[add + i] as number) - (src[sub + i] as number);
    }
  }
}

/** Frost the layers beneath: three box passes each way ≈ Gaussian blur. */
function frost(below: Float32Array, w: number, rows: number, r: number): Float32Array {
  const a = new Int32Array(below.length);
  for (let i = 0; i < below.length; i++) a[i] = Math.round((below[i] as number) * FIXED);
  if (r > 0) {
    const b = new Int32Array(a.length);
    blurRows(a, b, w, rows, r);
    blurRows(b, a, w, rows, r);
    blurRows(a, b, w, rows, r);
    blurCols(b, a, w, rows, r);
    blurCols(a, b, w, rows, r);
    blurCols(b, a, w, rows, r);
  }
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] as number) / FIXED;
  return out;
}

export const glassLayer: LayerDefinition = {
  type: 'glass',
  family: 'glass',
  label: 'Glass',
  description: 'Frosted, tinted glass over the layers beneath it.',
  defaultBlendMode: 'normal',
  defaultOpacity: 1,
  backgroundDependent: true,
  note: 'Stylized glass effect, not physically accurate refraction. It frosts the layers beneath it, so it looks different over a different background.',
  params: [
    {
      id: 'frost',
      kind: 'number',
      label: 'Frosting',
      section: 'appearance',
      min: 0,
      max: 60,
      step: 1,
      default: 20,
      unit: 'px',
      integer: true,
      variation: 'intensity',
      help: 'Blur radius applied to the layers beneath.',
    },
    {
      id: 'transparency',
      kind: 'number',
      label: 'Transparency',
      section: 'appearance',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      unit: '%',
      help: 'How see-through the glass is where nothing is beneath it.',
    },
    { id: 'tint', kind: 'color', label: 'Tint', section: 'color', default: '#FFFFFF', variation: 'palette' },
    {
      id: 'tintStrength',
      kind: 'number',
      label: 'Tint strength',
      section: 'color',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.18,
      unit: '%',
      variation: 'palette',
    },
    {
      id: 'contrast',
      kind: 'number',
      label: 'Contrast',
      section: 'color',
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'grainAmount',
      kind: 'number',
      label: 'Glass grain',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.2,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'grainScale',
      kind: 'number',
      label: 'Grain scale',
      section: 'structure',
      min: 0.5,
      max: 4,
      step: 0.1,
      default: 1,
      unit: 'px',
      variation: 'scale',
    },
    {
      id: 'refraction',
      kind: 'number',
      label: 'Distortion',
      section: 'structure',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.2,
      unit: '%',
      variation: 'structure',
      help: 'Stylized refraction: wobbles the frosted content beneath.',
    },
    {
      id: 'edgeHighlight',
      kind: 'number',
      label: 'Edge highlight',
      section: 'lighting',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.45,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'edgeWidth',
      kind: 'number',
      label: 'Edge width',
      section: 'lighting',
      min: 0,
      max: 40,
      step: 1,
      default: 8,
      unit: 'px',
      integer: true,
    },
    {
      id: 'inset',
      kind: 'number',
      label: 'Panel inset',
      section: 'structure',
      min: 0,
      max: 600,
      step: 1,
      default: 0,
      unit: 'px',
      integer: true,
      help: '0 covers the whole canvas. Larger values make a glass card with the sharp background around it.',
    },
    {
      id: 'cornerRadius',
      kind: 'number',
      label: 'Corner radius',
      section: 'structure',
      min: 0,
      max: 300,
      step: 1,
      default: 24,
      unit: 'px',
      integer: true,
      help: 'Rounds the corners of an inset glass panel.',
    },
    {
      id: 'sheen',
      kind: 'number',
      label: 'Sheen',
      section: 'lighting',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.25,
      unit: '%',
      variation: 'intensity',
    },
    {
      id: 'lightAngle',
      kind: 'number',
      label: 'Light direction',
      section: 'lighting',
      min: 0,
      max: 360,
      step: 1,
      default: 225,
      unit: '°',
      integer: true,
      help: 'Direction the light comes from (225° is top-left).',
    },
  ],
  coversCanvas: (params) => num(params, 'transparency') <= 0 && num(params, 'inset') <= 0,
  margin(params, pixelRatio) {
    return 3 * boxRadius(num(params, 'frost'), pixelRatio) + refractionPx(num(params, 'refraction'), pixelRatio) + 2;
  },
  render(ctx, out) {
    const { width, height, y0, y1, params, seed, pixelRatio } = ctx;
    const below = ctx.below;
    if (!below) throw new Error('Glass layer requires the layers beneath it');
    const grid = pixelGrid(width, height, pixelRatio);
    const rows = below.y1 - below.y0;

    // Frost: blur everything beneath (with margin rows so band seams match).
    const blurred = frost(below.data, width, rows, boxRadius(num(params, 'frost'), pixelRatio));

    const tint = rgb(params, 'tint');
    const tintStrength = num(params, 'tintStrength');
    const fillA = 1 - num(params, 'transparency');
    const contrast = 1 + num(params, 'contrast');
    const grainScale = num(params, 'grainScale');
    // Averaged as in the grain layer, so small previews match the export.
    const grainAmount = num(params, 'grainAmount') * 0.12 * Math.min(1, grainScale * pixelRatio);
    const refr = num(params, 'refraction') * MAX_REFRACTION_PX * pixelRatio;
    const edgeHighlight = num(params, 'edgeHighlight');
    const edgeWidth = Math.max(0.0001, num(params, 'edgeWidth'));
    const sheen = num(params, 'sheen') * 0.4;
    // Vector pointing toward the light.
    const light = direction(num(params, 'lightAngle'));
    const lastRow = rows - 1;
    const lastCol = width - 1;

    // Glass panel: a rounded rectangle inset from the canvas edges.
    const aa = grid.inv * 0.5;
    const cx = grid.logicalWidth / 2;
    const cy = grid.logicalHeight / 2;
    const inset = num(params, 'inset');
    const halfW = Math.max(1, cx - inset);
    const halfH = Math.max(1, cy - inset);
    const radius = inset > 0 ? Math.min(num(params, 'cornerRadius'), halfW, halfH) : 0;
    const coreX = halfW - radius;
    const coreY = halfH - radius;
    const edgeReach = edgeWidth > 1.25 ? edgeWidth : 1.25;

    // Refraction offsets vary slowly (features ≥ 45 px), so evaluate them on a
    // coarse grid aligned to absolute device pixels and interpolate. Grid
    // alignment keeps results independent of band boundaries.
    const gridY0 = Math.floor(y0 / REFRACTION_STEP) * REFRACTION_STEP;
    const gridW = Math.ceil(width / REFRACTION_STEP) + 2;
    const gridH = Math.ceil((y1 - gridY0) / REFRACTION_STEP) + 2;
    const offsets = new Float32Array(refr > 0 ? gridW * gridH * 2 : 0);
    if (refr > 0) {
      for (let j = 0; j < gridH; j++) {
        const gly = (gridY0 + j * REFRACTION_STEP) * grid.inv;
        for (let i = 0; i < gridW; i++) {
          const glx = i * REFRACTION_STEP * grid.inv;
          const k = (j * gridW + i) * 2;
          offsets[k] = (fbm(gradientNoise, glx / 90, gly / 90, seed + 1, 2) - 0.5) * 2 * refr;
          offsets[k + 1] = (fbm(gradientNoise, glx / 90, gly / 90, seed + 2, 2) - 0.5) * 2 * refr;
        }
      }
    }

    let i = 0;
    for (let y = y0; y < y1; y++) {
      const ly = (y + 0.5) * grid.inv;
      const v = ly / grid.logicalHeight - 0.5;
      for (let x = 0; x < width; x++, i += 4) {
        const lx = (x + 0.5) * grid.inv;
        const u = lx / grid.logicalWidth - 0.5;

        // Signed distance to the panel edge (negative inside).
        const px = lx - cx;
        const py = ly - cy;
        const qx = Math.abs(px) - coreX;
        const qy = Math.abs(py) - coreY;
        const ox = qx > 0 ? qx : 0;
        const oy = qy > 0 ? qy : 0;
        const outside = ox > 0 || oy > 0 ? Math.sqrt(ox * ox + oy * oy) : 0;
        const sd = outside + Math.min(Math.max(qx, qy), 0) - radius;
        const mask = 1 - smoothstep(-aa, aa, sd);
        if (mask <= 0) {
          // Outside the panel: leave the layers beneath untouched.
          out[i] = 0;
          out[i + 1] = 0;
          out[i + 2] = 0;
          out[i + 3] = 0;
          continue;
        }

        let sx = x;
        let sy = y - below.y0;
        if (refr > 0) {
          // Bilinear lookup in the coarse offset grid.
          const gx = x / REFRACTION_STEP;
          const gy = (y - gridY0) / REFRACTION_STEP;
          const ix = Math.floor(gx);
          const iy = Math.floor(gy);
          const fx = gx - ix;
          const fy = gy - iy;
          const g00 = (iy * gridW + ix) * 2;
          const g10 = g00 + 2;
          const g01 = g00 + gridW * 2;
          const g11 = g01 + 2;
          const w0 = (1 - fx) * (1 - fy);
          const w1 = fx * (1 - fy);
          const w2 = (1 - fx) * fy;
          const w3 = fx * fy;
          sx += (offsets[g00] as number) * w0 + (offsets[g10] as number) * w1 + (offsets[g01] as number) * w2 + (offsets[g11] as number) * w3;
          sy += (offsets[g00 + 1] as number) * w0 + (offsets[g10 + 1] as number) * w1 + (offsets[g01 + 1] as number) * w2 + (offsets[g11 + 1] as number) * w3;
        }
        // Bilinear sample of the frosted buffer (device px relative to below.y0).
        const fx = sx < 0 ? 0 : sx > lastCol ? lastCol : sx;
        const fy = sy < 0 ? 0 : sy > lastRow ? lastRow : sy;
        const x0 = Math.floor(fx);
        const yy0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - yy0;
        const i00 = (yy0 * width + x0) * 4;
        const i10 = i00 + (x0 < lastCol ? 4 : 0);
        const i01 = i00 + (yy0 < lastRow ? width * 4 : 0);
        const i11 = i01 + (x0 < lastCol ? 4 : 0);
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        const pa =
          (blurred[i00 + 3] as number) * w00 + (blurred[i10 + 3] as number) * w10 + (blurred[i01 + 3] as number) * w01 + (blurred[i11 + 3] as number) * w11;
        const outA = pa + fillA * (1 - pa);
        let cr: number;
        let cg: number;
        let cb: number;
        if (outA > 0) {
          const fill = fillA * (1 - pa);
          const invA = 1 / outA;
          cr = ((blurred[i00] as number) * w00 + (blurred[i10] as number) * w10 + (blurred[i01] as number) * w01 + (blurred[i11] as number) * w11 + tint[0] * fill) * invA;
          cg = ((blurred[i00 + 1] as number) * w00 + (blurred[i10 + 1] as number) * w10 + (blurred[i01 + 1] as number) * w01 + (blurred[i11 + 1] as number) * w11 + tint[1] * fill) * invA;
          cb = ((blurred[i00 + 2] as number) * w00 + (blurred[i10 + 2] as number) * w10 + (blurred[i01 + 2] as number) * w01 + (blurred[i11 + 2] as number) * w11 + tint[2] * fill) * invA;
        } else {
          cr = tint[0];
          cg = tint[1];
          cb = tint[2];
        }
        cr = (cr - 0.5) * contrast + 0.5;
        cg = (cg - 0.5) * contrast + 0.5;
        cb = (cb - 0.5) * contrast + 0.5;
        cr += (tint[0] - cr) * tintStrength;
        cg += (tint[1] - cg) * tintStrength;
        cb += (tint[2] - cb) * tintStrength;

        // Sheen: brighter toward the light.
        let lift = smoothstep(-0.2, 0.75, u * light.x + v * light.y) * sheen;

        // Edge highlight along the panel edge, strongest where it faces the light.
        let edge = 0;
        const dist = -sd;
        if (edgeHighlight > 0 && dist < edgeReach) {
          let nx: number;
          let ny: number;
          if (ox > 0 && oy > 0) {
            nx = (px < 0 ? -ox : ox) / outside;
            ny = (py < 0 ? -oy : oy) / outside;
          } else if (qx > qy) {
            nx = px < 0 ? -1 : 1;
            ny = 0;
          } else {
            nx = 0;
            ny = py < 0 ? -1 : 1;
          }
          const facing = nx * light.x + ny * light.y;
          const weight = 0.3 + 0.7 * (facing > 0 ? facing : 0);
          edge = ((1 - smoothstep(0, edgeWidth, dist)) * 0.55 + (1 - smoothstep(0, 1.25, dist)) * 0.45) * weight * edgeHighlight;
          lift += edge;
        }
        if (lift > 1) lift = 1;
        cr += (1 - cr) * lift;
        cg += (1 - cg) * lift;
        cb += (1 - cb) * lift;

        if (grainAmount > 0) {
          const g = (hash01(Math.floor(lx / grainScale), Math.floor(ly / grainScale), seed + 5) - 0.5) * grainAmount;
          cr += g;
          cg += g;
          cb += g;
        }

        out[i] = cr;
        out[i + 1] = cg;
        out[i + 2] = cb;
        out[i + 3] = (outA + (1 - outA) * edge) * mask;
      }
    }
  },
};
