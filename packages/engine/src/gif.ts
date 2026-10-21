/**
 * Animated GIF encoder (pure TypeScript, deterministic).
 *
 * - One global 256-color palette built by median cut over pixels sampled
 *   from every frame, so colors stay stable between frames.
 * - Ordered (Bayer) dithering: unlike error diffusion it does not shimmer
 *   from frame to frame.
 * - Standard GIF LZW compression; loops forever (NETSCAPE2.0).
 */

export interface GifOptions {
  width: number;
  height: number;
  /** Delay between frames in hundredths of a second. */
  delayCs: number;
  /** Map pixels with alpha < 128 to a transparent color. */
  transparent: boolean;
  /** Optional comment (e.g. recipe and seed). */
  comment?: string;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

type Box = { pixels: Uint8Array; count: number };

/** Median-cut palette from RGB samples (3 bytes each). */
export function medianCutPalette(samples: Uint8Array, maxColors: number): Uint8Array {
  const total = samples.length / 3;
  if (total === 0) return new Uint8Array([0, 0, 0]);
  let boxes: Box[] = [{ pixels: samples, count: total }];
  const range = (b: Box) => {
    const lo = [255, 255, 255];
    const hi = [0, 0, 0];
    for (let i = 0; i < b.count; i++) {
      for (let c = 0; c < 3; c++) {
        const v = b.pixels[i * 3 + c] as number;
        if (v < (lo[c] as number)) lo[c] = v;
        if (v > (hi[c] as number)) hi[c] = v;
      }
    }
    const spans = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
    const channel = spans[0]! >= spans[1]! && spans[0]! >= spans[2]! ? 0 : spans[1]! >= spans[2]! ? 1 : 2;
    return { channel, span: spans[channel] as number };
  };
  while (boxes.length < maxColors) {
    // Split the box with the largest (span × population).
    let best = -1;
    let bestScore = 0;
    let bestChannel = 0;
    boxes.forEach((b, i) => {
      if (b.count < 2) return;
      const r = range(b);
      const score = r.span * b.count;
      if (score > bestScore) {
        bestScore = score;
        best = i;
        bestChannel = r.channel;
      }
    });
    if (best < 0) break;
    const box = boxes[best] as Box;
    const order = Array.from({ length: box.count }, (_, i) => i).sort(
      (a, b) => (box.pixels[a * 3 + bestChannel] as number) - (box.pixels[b * 3 + bestChannel] as number) || a - b,
    );
    const mid = Math.floor(box.count / 2);
    const left = new Uint8Array(mid * 3);
    const right = new Uint8Array((box.count - mid) * 3);
    order.forEach((src, i) => {
      const target = i < mid ? left : right;
      const j = i < mid ? i : i - mid;
      target[j * 3] = box.pixels[src * 3] as number;
      target[j * 3 + 1] = box.pixels[src * 3 + 1] as number;
      target[j * 3 + 2] = box.pixels[src * 3 + 2] as number;
    });
    boxes = [...boxes.slice(0, best), { pixels: left, count: mid }, { pixels: right, count: box.count - mid }, ...boxes.slice(best + 1)];
  }
  const palette = new Uint8Array(boxes.length * 3);
  boxes.forEach((b, i) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let k = 0; k < b.count; k++) {
      r += b.pixels[k * 3] as number;
      g += b.pixels[k * 3 + 1] as number;
      bl += b.pixels[k * 3 + 2] as number;
    }
    palette[i * 3] = Math.round(r / b.count);
    palette[i * 3 + 1] = Math.round(g / b.count);
    palette[i * 3 + 2] = Math.round(bl / b.count);
  });
  return palette;
}

/** GIF LZW compression of color indices. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };
  let dict = new Map<number, number>();
  let next = eoi + 1;
  emit(clear);
  if (indices.length === 0) {
    emit(eoi);
    if (bitCount > 0) out.push(bitBuffer & 0xff);
    return new Uint8Array(out);
  }
  let prefix = indices[0] as number;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i] as number;
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bitCount > 0) out.push(bitBuffer & 0xff);
  return new Uint8Array(out);
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private current: number[] = [];
  byte(v: number) {
    this.current.push(v & 0xff);
  }
  word(v: number) {
    this.byte(v);
    this.byte(v >> 8);
  }
  bytes(data: ArrayLike<number>) {
    for (let i = 0; i < data.length; i++) this.current.push(data[i] as number);
  }
  /** Data sub-blocks of at most 255 bytes, then a terminator. */
  blocks(data: Uint8Array) {
    this.flush();
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      this.chunks.push(new Uint8Array([n]), data.subarray(i, i + n));
    }
    this.byte(0);
  }
  private flush() {
    if (this.current.length) {
      this.chunks.push(new Uint8Array(this.current));
      this.current = [];
    }
  }
  result(): Uint8Array<ArrayBuffer> {
    this.flush();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

/** Encode RGBA frames (each width × height × 4 bytes) as a looping GIF. */
export function encodeGif(frames: readonly Uint8ClampedArray[], options: GifOptions): Uint8Array<ArrayBuffer> {
  const { width, height } = options;
  const pixels = width * height;
  const transparentIndex = options.transparent ? 0 : -1;
  const colorSlots = options.transparent ? 255 : 256;

  // Sample up to ~60k opaque pixels evenly across all frames.
  const stride = Math.max(1, Math.floor((pixels * frames.length) / 60000));
  const samples: number[] = [];
  let n = 0;
  for (const f of frames) {
    for (let i = 0; i < pixels; i++, n++) {
      if (n % stride !== 0) continue;
      if (options.transparent && (f[i * 4 + 3] as number) < 128) continue;
      samples.push(f[i * 4] as number, f[i * 4 + 1] as number, f[i * 4 + 2] as number);
    }
  }
  const colors = medianCutPalette(new Uint8Array(samples), colorSlots);
  const colorCount = colors.length / 3;
  const palette = new Uint8Array(256 * 3);
  const offset = options.transparent ? 1 : 0;
  palette.set(colors, offset * 3);

  // Nearest palette color per 15-bit color, computed on demand.
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache[key] as number;
    if (hit >= 0) return hit;
    const cr = (r & 0xf8) | 4;
    const cg = (g & 0xf8) | 4;
    const cb = (b & 0xf8) | 4;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < colorCount; i++) {
      const dr = cr - (colors[i * 3] as number);
      const dg = cg - (colors[i * 3 + 1] as number);
      const db = cb - (colors[i * 3 + 2] as number);
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache[key] = best + offset;
    return best + offset;
  };

  const w = new ByteWriter();
  w.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  w.word(width);
  w.word(height);
  w.byte(0xf7); // global color table, 8 bits/channel, 256 entries
  w.byte(0); // background color index
  w.byte(0); // pixel aspect
  w.bytes(palette);
  // Loop forever.
  w.bytes([0x21, 0xff, 0x0b]);
  w.bytes([...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)));
  w.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
  if (options.comment) {
    w.bytes([0x21, 0xfe]);
    w.blocks(new TextEncoder().encode(options.comment.slice(0, 1000)));
  }

  const indices = new Uint8Array(pixels);
  for (const f of frames) {
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        if (transparentIndex >= 0 && (f[i * 4 + 3] as number) < 128) {
          indices[i] = transparentIndex;
          continue;
        }
        const t = ((BAYER4[(y & 3) * 4 + (x & 3)] as number) - 7.5) * 0.6;
        const r = Math.max(0, Math.min(255, Math.round((f[i * 4] as number) + t)));
        const g = Math.max(0, Math.min(255, Math.round((f[i * 4 + 1] as number) + t)));
        const b = Math.max(0, Math.min(255, Math.round((f[i * 4 + 2] as number) + t)));
        indices[i] = nearest(r, g, b);
      }
    }
    // Graphic control: delay, disposal (restore to background when transparent).
    w.bytes([0x21, 0xf9, 0x04]);
    w.byte((options.transparent ? 2 << 2 : 1 << 2) | (options.transparent ? 1 : 0));
    w.word(Math.max(2, Math.round(options.delayCs)));
    w.byte(Math.max(0, transparentIndex));
    w.byte(0);
    // Image descriptor (full frame, global palette).
    w.byte(0x2c);
    w.word(0);
    w.word(0);
    w.word(width);
    w.word(height);
    w.byte(0);
    w.byte(8); // LZW minimum code size
    w.blocks(lzwEncode(indices, 8));
  }
  w.byte(0x3b);
  return w.result();
}

export const ANIMATION_LIMITS = {
  /** Longest output side for animated exports. */
  maxSide: 1080,
  maxFrames: 120,
  minDuration: 1,
  maxDuration: 8,
  frameRates: [10, 12, 15, 20, 25] as const,
} as const;

export interface AnimationPlan {
  frames: number;
  /** GIF frame delay in hundredths of a second. */
  delayCs: number;
  /** Actual frame rate after rounding the delay. */
  fps: number;
}

export function planAnimation(durationSeconds: number, fps: number): AnimationPlan {
  const delayCs = Math.max(2, Math.round(100 / fps));
  const actualFps = 100 / delayCs;
  const frames = Math.max(2, Math.min(ANIMATION_LIMITS.maxFrames, Math.round(durationSeconds * actualFps)));
  return { frames, delayCs, fps: actualFps };
}
