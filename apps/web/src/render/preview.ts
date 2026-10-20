import { renderFingerprint, type Recipe, type RenderWarning } from '@material-lab/engine';
import { isAbortError, type RenderPool } from './pool';

export interface PreviewTarget {
  recipe: Recipe;
  /** Device pixels per logical px for the full-quality preview. */
  pixelRatio: number;
  transparent: boolean;
  background: string;
}

export interface PreviewFrame {
  data: ImageData;
  /** Device pixels per logical px this frame was rendered at. */
  pixelRatio: number;
  kind: 'draft' | 'full';
  ms: number;
  warnings: RenderWarning[];
  /** Fingerprint of the recipe the frame shows. */
  key: string;
}

export type PreviewStatus =
  | { state: 'idle' }
  | { state: 'rendering'; kind: 'draft' | 'full' }
  | { state: 'error'; message: string };

/** Above this many pixels, show a quick low-resolution draft first. */
const DRAFT_THRESHOLD = 220_000;
const DRAFT_PIXELS = 90_000;

interface Running {
  key: string;
  kind: 'draft' | 'full';
  controller: AbortController;
}

function keyOf(t: PreviewTarget): string {
  return `${renderFingerprint(t.recipe)}|${t.pixelRatio.toFixed(4)}|${t.transparent}|${t.background}`;
}

/**
 * Schedules progressive preview renders.
 *
 * - At most one preview render is in flight, so rapid edits coalesce instead
 *   of queueing up: the newest state renders next.
 * - Large previews render a fast draft first, then full preview quality.
 * - A frame is only shown if it is newer than the one on screen, so a stale
 *   render never replaces a newer result.
 * - On failure the last good frame stays visible.
 */
export class PreviewScheduler {
  private latest: PreviewTarget | null = null;
  private latestKey = '';
  private running: Running | null = null;
  private shown: { key: string; kind: 'draft' | 'full' } | null = null;
  private failedKey: string | null = null;
  private disposed = false;

  constructor(
    private readonly pool: RenderPool,
    private readonly onFrame: (frame: PreviewFrame) => void,
    private readonly onStatus: (status: PreviewStatus) => void,
  ) {}

  update(target: PreviewTarget): void {
    const key = keyOf(target);
    if (key === this.latestKey) return;
    this.latest = target;
    this.latestKey = key;
    this.failedKey = null;
    // A slow full-quality render of an older state is not worth finishing.
    if (this.running && this.running.kind === 'full') {
      this.running.controller.abort();
      this.running = null;
    }
    this.pump();
  }

  /** Try again after an error. */
  retry(): void {
    this.failedKey = null;
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.running?.controller.abort();
    this.running = null;
  }

  private pump(): void {
    if (this.disposed || this.running || !this.latest) return;
    const target = this.latest;
    const key = this.latestKey;
    if (this.failedKey === key) return;
    if (this.shown?.key === key && this.shown.kind === 'full') {
      this.onStatus({ state: 'idle' });
      return;
    }
    const { width, height } = target.recipe.canvas;
    const fullPixels = width * height * target.pixelRatio * target.pixelRatio;
    const wantDraft = fullPixels > DRAFT_THRESHOLD && !(this.shown?.key === key);
    const kind: 'draft' | 'full' = wantDraft ? 'draft' : 'full';
    const pixelRatio = wantDraft ? target.pixelRatio * Math.sqrt(DRAFT_PIXELS / fullPixels) : target.pixelRatio;
    const outW = Math.max(1, Math.round(width * pixelRatio));
    const outH = Math.max(1, Math.round(height * pixelRatio));

    const controller = new AbortController();
    this.running = { key, kind, controller };
    this.onStatus({ state: 'rendering', kind });
    this.pool
      .render(
        {
          recipe: target.recipe,
          width: outW,
          height: outH,
          // Exact ratio of output to logical size, so features keep their scale.
          pixelRatio: outW / width,
          transparent: target.transparent,
          background: target.background,
        },
        { priority: 'interactive', signal: controller.signal },
      )
      .then(
        (result) => {
          if (this.disposed || this.running?.controller !== controller) return;
          this.running = null;
          this.shown = { key, kind };
          this.onFrame({
            data: new ImageData(result.data, result.width, result.height),
            pixelRatio: outW / width,
            kind,
            ms: result.ms,
            warnings: result.warnings,
            key: renderFingerprint(target.recipe),
          });
          if (this.latestKey === key && kind === 'full') this.onStatus({ state: 'idle' });
          this.pump();
        },
        (error: unknown) => {
          if (this.disposed || isAbortError(error)) return;
          if (this.running?.controller === controller) this.running = null;
          this.failedKey = key;
          this.onStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) });
          this.pump();
        },
      );
  }
}
