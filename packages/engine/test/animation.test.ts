import { describe, expect, it } from 'vitest';
import {
  analyzeAnimation,
  buildGifPalette,
  createLayer,
  createRecipe,
  encodeGif,
  getPreset,
  GifWriter,
  instantiatePreset,
  lzwEncode,
  planAnimation,
  renderRecipe,
} from '../src';

/** Minimal GIF LZW decoder for round-trip checks. */
function lzwDecode(data: Uint8Array, minCodeSize: number, count: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: clear }, (_, i) => [i]);
    dict.push([], []);
    codeSize = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let bit = 0;
  let prev: number[] | null = null;
  while (out.length < count) {
    let code = 0;
    for (let i = 0; i < codeSize; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code]!;
    else entry = [...prev!, prev![0]!];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]!]);
    prev = entry;
    if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
  }
  return out;
}

/** Pull the image data sub-blocks of each frame out of a GIF. */
function frameData(gif: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let i = 13 + 256 * 3;
  while (i < gif.length) {
    const b = gif[i]!;
    if (b === 0x3b) break;
    if (b === 0x21) {
      i += 2;
      while (gif[i]! !== 0) i += gif[i]! + 1;
      i++;
    } else if (b === 0x2c) {
      i += 10;
      i++; // min code size
      const parts: number[] = [];
      while (gif[i]! !== 0) {
        const n = gif[i]!;
        parts.push(...gif.subarray(i + 1, i + 1 + n));
        i += n + 1;
      }
      i++;
      frames.push(new Uint8Array(parts));
    } else {
      throw new Error(`Unexpected block ${b}`);
    }
  }
  return frames;
}

describe('animation', () => {
  it('lists the layers that move', () => {
    const recipe = createRecipe({ layers: [createLayer('base-color'), createLayer('liquid', { id: 'l' }), createLayer('paper-fiber')] });
    expect(analyzeAnimation(recipe).map((m) => m.layerId)).toEqual(['l']);
  });

  it('loops: the frame at time 1 equals the frame at time 0', () => {
    for (const id of ['liquid-calm-flow', 'noise-topo-ridges', 'metal-brushed-silver', 'glass-aurora-panel']) {
      const recipe = instantiatePreset(getPreset(id)!);
      const size = { width: 48, height: 30, pixelRatio: 0.03, motion: 0.8 };
      const a = renderRecipe(recipe, { ...size, time: 0 }).data;
      const b = renderRecipe(recipe, { ...size, time: 1 }).data;
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i]! - b[i]!));
      expect(diff, id).toBeLessThanOrEqual(1);
      const mid = renderRecipe(recipe, { ...size, time: 0.3 }).data;
      expect(Buffer.from(mid).equals(Buffer.from(a)), `${id} moves`).toBe(false);
    }
  });

  it('renders stills identically when no time is given', () => {
    const recipe = instantiatePreset(getPreset('liquid-calm-flow')!);
    const size = { width: 32, height: 20, pixelRatio: 0.02 };
    expect(Buffer.from(renderRecipe(recipe, size).data).equals(Buffer.from(renderRecipe(recipe, { ...size, motion: 1 }).data))).toBe(true);
  });

  it('plans frames within limits', () => {
    expect(planAnimation(4, 25)).toEqual({ frames: 100, delayCs: 4, fps: 25 });
    expect(planAnimation(8, 25).frames).toBe(120);
    expect(planAnimation(3, 12).delayCs).toBe(8);
  });

  it('LZW round-trips', () => {
    const indices = new Uint8Array(5000).map((_, i) => (i * 7 + (i >> 5)) & 0xff);
    const encoded = lzwEncode(indices, 8);
    expect(lzwDecode(encoded, 8, indices.length)).toEqual([...indices]);
  });

  it('encodes a valid looping GIF whose pixels match the source', () => {
    const recipe = instantiatePreset(getPreset('liquid-iridescent')!);
    const width = 40;
    const height = 25;
    const frames = [0, 0.5].map((time) => renderRecipe(recipe, { width, height, pixelRatio: width / 1600, time, motion: 0.5 }).data);
    const gif = encodeGif(frames, { width, height, delayCs: 8, transparent: false, comment: 'test' });
    expect(String.fromCharCode(...gif.subarray(0, 6))).toBe('GIF89a');
    expect(gif[gif.length - 1]).toBe(0x3b);
    expect(new TextDecoder().decode(gif).includes('NETSCAPE2.0')).toBe(true);
    const palette = gif.subarray(13, 13 + 768);
    const data = frameData(gif);
    expect(data).toHaveLength(2);
    // Decoded colors stay close to the source (quantization + light dithering).
    const indices = lzwDecode(data[0]!, 8, width * height);
    let total = 0;
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++) total += Math.abs(palette[indices[i]! * 3 + c]! - frames[0]![i * 4 + c]!);
    }
    expect(total / (width * height * 3)).toBeLessThan(12);
  });

  it('streams frames with a palette built from small sample renders', () => {
    const recipe = instantiatePreset(getPreset('metal-brushed-silver')!);
    const width = 48;
    const height = 30;
    const samples = [0, 0.5].map((time) => renderRecipe(recipe, { width: 16, height: 10, pixelRatio: 0.01, time }).data);
    const writer = new GifWriter({ width, height, delayCs: 10, transparent: false }, buildGifPalette(samples, false));
    const frames = [0, 0.25, 0.5].map((time) => renderRecipe(recipe, { width, height, pixelRatio: 0.03, time }).data);
    for (const f of frames) writer.addFrame(f);
    expect(writer.frames).toBe(3);
    const gif = writer.finish();
    expect(frameData(gif)).toHaveLength(3);
    expect(() => new GifWriter({ width, height, delayCs: 10, transparent: false }, buildGifPalette(samples, false)).addFrame(samples[0]!)).toThrow(RangeError);
  });

  it('keeps transparent pixels transparent', () => {
    const width = 4;
    const height = 2;
    const frame = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) frame.set(i < 4 ? [200, 40, 40, 255] : [0, 0, 0, 0], i * 4);
    const gif = encodeGif([frame], { width, height, delayCs: 10, transparent: true });
    const indices = lzwDecode(frameData(gif)[0]!, 8, width * height);
    expect(indices.slice(4)).toEqual([0, 0, 0, 0]);
    expect(indices.slice(0, 4).every((i) => i > 0)).toBe(true);
  });
});
