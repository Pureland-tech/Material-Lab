import { hexToRgb, type RGB } from '../color';
import type { LayerParameters } from '../types';

export function num(params: LayerParameters, key: string): number {
  const v = params[key];
  return typeof v === 'number' ? v : 0;
}

export function bool(params: LayerParameters, key: string): boolean {
  return params[key] === true;
}

export function str(params: LayerParameters, key: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : '';
}

export function rgb(params: LayerParameters, key: string): RGB {
  return hexToRgb(str(params, key));
}

/** Iterate the band's pixels in logical coordinates (pixel centers). */
export interface PixelGrid {
  /** Logical size of the whole output. */
  logicalWidth: number;
  logicalHeight: number;
  /** Logical px per device pixel. */
  inv: number;
}

export function pixelGrid(width: number, height: number, pixelRatio: number): PixelGrid {
  const inv = 1 / pixelRatio;
  return { logicalWidth: width * inv, logicalHeight: height * inv, inv };
}
