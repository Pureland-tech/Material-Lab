/**
 * Small numeric helpers. Per-pixel code sticks to + - * / floor and sqrt, which
 * IEEE 754 defines exactly, so renders are reproducible across engines.
 * Trigonometry is only evaluated once per layer (see `direction`).
 */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * Smooth periodic wave in [0, 1] with period 1: 0 at integers, 1 at half
 * integers. A polynomial stand-in for a cosine that avoids per-pixel trig.
 */
export function smoothWave(x: number): number {
  const t = 1 - Math.abs(fract(x) * 2 - 1);
  return t * t * (3 - 2 * t);
}

export interface Direction {
  x: number;
  y: number;
}

/**
 * Unit vector for an angle in degrees (0° points right, 90° points down in
 * image space). Rounded to 12 decimals so tiny libm differences between
 * engines do not reach the pixels.
 */
export function direction(degrees: number): Direction {
  const r = (degrees * Math.PI) / 180;
  return { x: round12(Math.cos(r)), y: round12(Math.sin(r)) };
}

function round12(v: number): number {
  return Math.round(v * 1e12) / 1e12;
}
