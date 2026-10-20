import type { ExportSettings, Recipe, RenderWarning } from '@material-lab/engine';
import { getRenderPool, isAbortError } from './pool';

export interface ExportOutput {
  blob: Blob;
  width: number;
  height: number;
  ms: number;
  warnings: RenderWarning[];
}

export type ExportStage = 'rendering' | 'encoding';

export type ExportErrorKind = 'memory' | 'encode' | 'render';

export class ExportError extends Error {
  constructor(
    readonly kind: ExportErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

async function encode(data: ImageData, type: string, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(data.width, data.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(data, 0, 0);
      return canvas.convertToBlob({ type, quality });
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ExportError('encode', 'This browser could not create an image canvas.');
  ctx.putImageData(data, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ExportError('encode', 'The browser could not encode the image.'))), type, quality),
  );
}

/**
 * Render the recipe at full export resolution and encode it. Settings must
 * already be validated with validateExportSettings().
 */
export async function runExport(
  recipe: Recipe,
  settings: ExportSettings,
  options: { signal?: AbortSignal; onProgress?: (fraction: number, stage: ExportStage) => void },
): Promise<ExportOutput> {
  const width = settings.width * settings.scale;
  const height = settings.height * settings.scale;
  const transparent = settings.format === 'png' && settings.transparent;
  const start = performance.now();
  let result;
  try {
    result = await getRenderPool().render(
      { recipe, width, height, pixelRatio: settings.scale, transparent, background: settings.background },
      { priority: 'export', signal: options.signal, onProgress: (p) => options.onProgress?.(p, 'rendering') },
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof RangeError || /memory|allocation/i.test(String(error))) {
      throw new ExportError('memory', 'The device ran out of memory while rendering. Try a smaller size or scale.');
    }
    throw new ExportError('render', error instanceof Error ? error.message : String(error));
  }
  options.onProgress?.(1, 'encoding');
  let blob: Blob;
  try {
    const image = new ImageData(result.data, result.width, result.height);
    blob = await encode(image, settings.format === 'jpeg' ? 'image/jpeg' : 'image/png', settings.quality);
  } catch (error) {
    if (error instanceof ExportError) throw error;
    if (error instanceof RangeError) throw new ExportError('memory', 'The device ran out of memory while encoding. Try a smaller size or scale.');
    throw new ExportError('encode', 'The browser could not encode the image. Try PNG, or a smaller size.');
  }
  return { blob, width, height, ms: performance.now() - start, warnings: result.warnings };
}
