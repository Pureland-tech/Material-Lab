import type { BlendMode } from './types';

/**
 * Separable blend functions from the W3C Compositing and Blending spec.
 * `b` is the backdrop channel, `s` the source channel, both straight 0–1.
 */
function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'multiply':
      return b * s;
    case 'screen':
      return b + s - b * s;
    case 'overlay':
      return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'soft-light': {
      if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return b + (2 * s - 1) * (d - b);
    }
    default:
      return s;
  }
}

/**
 * Composite a straight-alpha layer band (`src`) onto a premultiplied backdrop
 * band (`dst`) in place, using `mode` and `opacity`.
 */
export function compositeInto(dst: Float32Array, src: Float32Array, mode: BlendMode, opacity: number): void {
  const n = dst.length;
  if (mode === 'normal') {
    for (let i = 0; i < n; i += 4) {
      const as = (src[i + 3] as number) * opacity;
      if (as <= 0) continue;
      const k = 1 - as;
      dst[i] = (src[i] as number) * as + (dst[i] as number) * k;
      dst[i + 1] = (src[i + 1] as number) * as + (dst[i + 1] as number) * k;
      dst[i + 2] = (src[i + 2] as number) * as + (dst[i + 2] as number) * k;
      dst[i + 3] = as + (dst[i + 3] as number) * k;
    }
    return;
  }
  for (let i = 0; i < n; i += 4) {
    const as = (src[i + 3] as number) * opacity;
    if (as <= 0) continue;
    const ab = dst[i + 3] as number;
    const invAb = ab > 0 ? 1 / ab : 0;
    for (let c = 0; c < 3; c++) {
      const rawS = src[i + c] as number;
      const cs = rawS < 0 ? 0 : rawS > 1 ? 1 : rawS;
      const cbPre = dst[i + c] as number;
      const rawB = cbPre * invAb;
      const cb = rawB < 0 ? 0 : rawB > 1 ? 1 : rawB;
      // co = cs·αs·(1−αb) + cb·αb·(1−αs) + αs·αb·B(cb, cs)
      dst[i + c] = cs * as * (1 - ab) + cbPre * (1 - as) + as * ab * blendChannel(mode, cb, cs);
    }
    dst[i + 3] = as + ab * (1 - as);
  }
}
