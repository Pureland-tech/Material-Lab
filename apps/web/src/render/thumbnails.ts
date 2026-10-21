import { isSeamless, renderFingerprint, type Recipe } from '@material-lab/engine';
import { getRenderPool } from './pool';

const MAX_ENTRIES = 160;
const cache = new Map<string, ImageData>();
const pending = new Map<string, Promise<ImageData>>();

function remember(key: string, data: ImageData): void {
  cache.delete(key);
  cache.set(key, data);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function thumbnailKey(recipe: Recipe, width: number): string {
  return `${renderFingerprint(recipe)}@${width}`;
}

export function cachedThumbnail(recipe: Recipe, width: number): ImageData | undefined {
  return cache.get(thumbnailKey(recipe, width));
}

/**
 * Render a small preview of the whole recipe canvas, `width` device pixels
 * wide. Results are cached by recipe content, and concurrent requests for
 * the same thumbnail share one render.
 */
export function renderThumbnail(recipe: Recipe, width: number): Promise<ImageData> {
  const key = thumbnailKey(recipe, width);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const pixelRatio = width / recipe.canvas.width;
  const height = Math.max(1, Math.round(recipe.canvas.height * pixelRatio));
  const promise = getRenderPool()
    .render(
      { recipe, width, height, pixelRatio, transparent: true, background: '#FFFFFF', tile: isSeamless(recipe) },
      { priority: 'background' },
    )
    .then((result) => {
      const data = new ImageData(result.data, result.width, result.height);
      remember(key, data);
      return data;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
