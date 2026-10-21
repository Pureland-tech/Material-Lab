import {
  ANIMATION_LIMITS,
  buildGifPalette,
  ENGINE_VERSION,
  GifWriter,
  isSeamless,
  planAnimation,
  slugify,
  type Recipe,
  type RenderWarning,
} from '@material-lab/engine';
import { createZip, type ZipEntry } from '../lib/zip';
import { encode, ExportError } from './export';
import { getRenderPool, isAbortError, RenderAbortedError, type FrameRequest, type FrameResult } from './pool';

export type AnimationFormat = 'gif' | 'png-frames';

export interface AnimationSettings {
  format: AnimationFormat;
  /** Longest output side in px (≤ ANIMATION_LIMITS.maxSide). */
  longestSide: number;
  /** Loop length in seconds. */
  duration: number;
  fps: number;
  /** Animation strength 0–1. */
  motion: number;
  transparent: boolean;
  background: string;
}

export interface AnimationOutput {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  ms: number;
  warnings: RenderWarning[];
}

/** Output size for a recipe at a longest side, keeping the canvas aspect ratio. */
export function animationSize(recipe: Recipe, longestSide: number): { width: number; height: number; pixelRatio: number } {
  const { width: cw, height: ch } = recipe.canvas;
  const side = Math.min(longestSide, ANIMATION_LIMITS.maxSide);
  const pixelRatio = side / Math.max(cw, ch);
  return { width: Math.max(1, Math.round(cw * pixelRatio)), height: Math.max(1, Math.round(ch * pixelRatio)), pixelRatio };
}

export function animationFilename(recipe: Recipe, format: AnimationFormat): string {
  return `${slugify(recipe.name)}-loop.${format === 'gif' ? 'gif' : 'zip'}`;
}

/**
 * Render frames `0 … count-1` at loop positions i / count, keeping up to
 * `window` frames in flight so small frames still use every worker. Results
 * are delivered in order.
 */
async function renderFrames(
  base: Omit<FrameRequest, 'time'>,
  count: number,
  signal: AbortSignal,
  onFrame: (index: number, frame: FrameResult) => Promise<void> | void,
): Promise<void> {
  const pool = getRenderPool();
  const window = Math.max(1, Math.min(4, pool.size));
  const pending: Promise<FrameResult>[] = [];
  let next = 0;
  const launch = () => {
    const time = next++ / count;
    const p = pool.render({ ...base, time }, { priority: 'export', signal });
    // Failures surface when awaited in order; avoid unhandled rejections meanwhile.
    p.catch(() => undefined);
    pending.push(p);
  };
  while (next < Math.min(window, count)) launch();
  for (let i = 0; i < count; i++) {
    const frame = await (pending.shift() as Promise<FrameResult>);
    if (next < count) launch();
    await onFrame(i, frame);
    if (signal.aborted) throw new RenderAbortedError();
  }
}

/** Render a looping animation and encode it as a GIF or a ZIP of PNG frames. */
export async function runAnimationExport(
  recipe: Recipe,
  settings: AnimationSettings,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<AnimationOutput> {
  const start = performance.now();
  const plan = planAnimation(settings.duration, settings.fps);
  const { width, height, pixelRatio } = animationSize(recipe, settings.longestSide);
  const tile = isSeamless(recipe);
  const transparent = settings.transparent;
  // Stop the remaining frames on the first failure, as well as on cancel.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const base = { recipe, width, height, pixelRatio, transparent, background: settings.background, tile, motion: settings.motion };
  const warnings = new Map<string, RenderWarning>();
  const filename = animationFilename(recipe, settings.format);

  try {
    let blob: Blob;
    if (settings.format === 'gif') {
      // One palette for the whole loop, from small renders across it.
      const sample = animationSize(recipe, 96);
      const samples: Uint8ClampedArray[] = [];
      await renderFrames({ ...base, ...sample }, 8, controller.signal, (_, f) => void samples.push(f.data));
      const writer = new GifWriter(
        {
          width,
          height,
          delayCs: plan.delayCs,
          transparent,
          comment: `Material Lab · ${recipe.name} · seed ${recipe.seed} · engine ${ENGINE_VERSION}`,
        },
        buildGifPalette(samples, transparent),
      );
      await renderFrames(base, plan.frames, controller.signal, (i, frame) => {
        for (const w of frame.warnings) warnings.set(`${w.code}:${w.layerId}`, w);
        writer.addFrame(frame.data);
        options.onProgress?.(i + 1, plan.frames);
      });
      blob = new Blob([writer.finish()], { type: 'image/gif' });
    } else {
      const slug = slugify(recipe.name);
      const entries: ZipEntry[] = [];
      await renderFrames(base, plan.frames, controller.signal, async (i, frame) => {
        for (const w of frame.warnings) warnings.set(`${w.code}:${w.layerId}`, w);
        const png = await encode(new ImageData(frame.data, width, height), 'image/png', 1);
        entries.push({ name: `${slug}-frame-${String(i + 1).padStart(4, '0')}.png`, data: new Uint8Array(await png.arrayBuffer()) });
        options.onProgress?.(i + 1, plan.frames);
      });
      const info = {
        frames: plan.frames,
        fps: plan.fps,
        durationSeconds: plan.frames / plan.fps,
        motion: settings.motion,
        loops: true,
        width,
        height,
        engineVersion: ENGINE_VERSION,
      };
      entries.push({ name: 'animation.json', data: new TextEncoder().encode(`${JSON.stringify(info, null, 2)}\n`) });
      entries.push({ name: `${slug}.recipe.json`, data: new TextEncoder().encode(`${JSON.stringify(recipe, null, 2)}\n`) });
      blob = createZip(entries);
    }
    return { blob, filename, width, height, frames: plan.frames, fps: plan.fps, ms: performance.now() - start, warnings: [...warnings.values()] };
  } catch (error) {
    controller.abort();
    if (isAbortError(error) || options.signal?.aborted) throw new RenderAbortedError();
    if (error instanceof ExportError) throw error;
    if (error instanceof RangeError || /memory|allocation/i.test(String(error))) {
      throw new ExportError('memory', 'The device ran out of memory while rendering. Try a smaller size or fewer frames.');
    }
    throw new ExportError('render', error instanceof Error ? error.message : String(error));
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Small looping frames for the dialog's live preview. */
export async function renderPreviewFrames(
  recipe: Recipe,
  options: { longestSide: number; frames: number; motion: number; transparent: boolean; signal: AbortSignal },
): Promise<ImageData[]> {
  const { width, height, pixelRatio } = animationSize(recipe, options.longestSide);
  const pool = getRenderPool();
  const results = await Promise.all(
    Array.from({ length: options.frames }, (_, i) =>
      pool.render(
        {
          recipe,
          width,
          height,
          pixelRatio,
          transparent: options.transparent,
          background: '#FFFFFF',
          tile: isSeamless(recipe),
          time: i / options.frames,
          motion: options.motion,
        },
        { priority: 'background', signal: options.signal },
      ),
    ),
  );
  return results.map((r) => new ImageData(r.data, r.width, r.height));
}
