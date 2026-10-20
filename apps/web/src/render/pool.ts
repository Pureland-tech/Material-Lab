import { findContextSplit, type Recipe, type RenderWarning } from '@material-lab/engine';
import type { ChunkRequest, WorkerResponse } from './protocol';

/** Lower numbers run first. */
export const PRIORITY = {
  interactive: 0,
  export: 1,
  background: 2,
} as const;
export type RenderPriority = keyof typeof PRIORITY;

export interface FrameRequest {
  recipe: Recipe;
  /** Output size in device pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  transparent: boolean;
  background: string;
}

export interface FrameResult {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  warnings: RenderWarning[];
  /** Wall-clock time for the whole frame. */
  ms: number;
}

export interface FrameOptions {
  priority: RenderPriority;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

interface Job {
  cancelled: boolean;
  priority: RenderPriority;
}

interface Task {
  id: number;
  job: Job;
  request: ChunkRequest;
  resolve: (response: Extract<WorkerResponse, { type: 'chunk' }>) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  task: Task | null;
}

/** Above this, glass renders without the two-phase path to bound memory. */
const TWO_PHASE_BUDGET_BYTES = 256 * 1024 * 1024;

export class RenderAbortedError extends Error {
  constructor() {
    super('Render aborted');
    this.name = 'AbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createWorker(): Worker {
  return new Worker(new URL('./render-worker.ts', import.meta.url), { type: 'module', name: 'material-lab-render' });
}

/**
 * A pool of render workers. A frame is split into row chunks that render in
 * parallel; the engine guarantees chunked output is identical to a single
 * full render, so parallelism never changes the pixels.
 */
export class RenderPool {
  private readonly slots: Slot[] = [];
  private queue: Task[] = [];
  private nextId = 1;

  constructor(readonly size: number) {
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
  }

  private spawn(): Slot {
    const slot: Slot = { worker: createWorker(), task: null };
    this.attach(slot);
    return slot;
  }

  private attach(slot: Slot): void {
    slot.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(slot, event.data);
    slot.worker.onerror = (event) => {
      event.preventDefault();
      this.replace(slot, new Error(event.message || 'Render worker crashed'));
    };
  }

  /** Terminate a worker (crashed, or running a cancelled export) and start a fresh one. */
  private replace(slot: Slot, error: Error | null): void {
    const task = slot.task;
    slot.worker.terminate();
    slot.worker = createWorker();
    this.attach(slot);
    slot.task = null;
    if (task && error) task.reject(error);
    this.pump();
  }

  private onMessage(slot: Slot, response: WorkerResponse): void {
    const task = slot.task;
    slot.task = null;
    if (task && task.id === response.taskId) {
      if (response.type === 'chunk') task.resolve(response);
      else task.reject(new Error(response.message));
    }
    this.pump();
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.task) continue;
      const task = this.queue.shift();
      if (!task) return;
      slot.task = task;
      // Each chunk's context rows are a fresh copy, so they can be transferred.
      const below = task.request.below?.data.buffer as ArrayBuffer | undefined;
      slot.worker.postMessage(task.request, below ? [below] : []);
    }
  }

  private enqueue(task: Task): void {
    const p = PRIORITY[task.job.priority];
    // Insert after every task of equal or higher priority (stable FIFO per priority).
    let index = this.queue.length;
    while (index > 0 && PRIORITY[(this.queue[index - 1] as Task).job.priority] > p) index--;
    this.queue.splice(index, 0, task);
  }

  /**
   * Render a frame across the pool.
   *
   * When a layer samples the layers beneath it (glass), the frame renders in
   * two phases if memory allows: the layers beneath are rendered once, split
   * across workers, then each chunk receives the rows it needs from that
   * result. This avoids re-rendering the layers beneath for every chunk's
   * context rows, and gives identical pixels.
   */
  async render(frame: FrameRequest, options: FrameOptions): Promise<FrameResult> {
    if (options.signal?.aborted) throw new RenderAbortedError();
    const start = performance.now();
    const job: Job = { cancelled: false, priority: options.priority };
    const { width, height } = frame;
    const split = findContextSplit(frame.recipe, frame.pixelRatio);
    const twoPhase = split !== null && width * height * 16 <= TWO_PHASE_BUDGET_BYTES;
    const base = {
      type: 'render' as const,
      recipe: frame.recipe,
      width,
      height,
      pixelRatio: frame.pixelRatio,
      transparent: frame.transparent,
      background: frame.background,
    };

    const onAbort = () => this.cancelJob(job);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      let below: Float32Array | null = null;
      const pixelChunks = this.planRows(frame, options.priority, twoPhase ? 0 : (split?.margin ?? 0));
      const belowChunks = twoPhase ? this.planRows(frame, options.priority, 0) : [];
      const total = belowChunks.length + pixelChunks.length;
      let done = 0;
      const progress = () => options.onProgress?.(++done / total);

      if (twoPhase && split) {
        const composite = new Float32Array(width * height * 4);
        await this.runBatch(
          job,
          belowChunks.map((rows) => ({ ...base, mode: 'composite' as const, rows, layerCount: split.layerCount })),
          (rows, response) => {
            composite.set(new Float32Array(response.data), rows.start * width * 4);
            progress();
          },
          options.signal,
        );
        below = composite;
      }

      const output = new Uint8ClampedArray(width * height * 4);
      const warnings = new Map<string, RenderWarning>();
      await this.runBatch(
        job,
        pixelChunks.map((rows) => {
          if (!below || !split) return { ...base, mode: 'pixels' as const, rows };
          const y0 = Math.max(0, rows.start - split.margin);
          const y1 = Math.min(height, rows.end + split.margin);
          return {
            ...base,
            mode: 'pixels' as const,
            rows,
            below: { data: below.slice(y0 * width * 4, y1 * width * 4), y0, y1, layerCount: split.layerCount },
          };
        }),
        (rows, response) => {
          output.set(new Uint8ClampedArray(response.data), rows.start * width * 4);
          for (const w of response.warnings) warnings.set(`${w.code}:${w.layerId}`, w);
          progress();
        },
        options.signal,
      );
      return { width, height, data: output, warnings: [...warnings.values()], ms: performance.now() - start };
    } catch (error) {
      this.cancelJob(job);
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private cancelJob(job: Job): void {
    if (job.cancelled) return;
    job.cancelled = true;
    this.queue = this.queue.filter((t) => t.job !== job);
    if (job.priority === 'export') {
      // Exports can have large chunks; stop them immediately.
      for (const slot of this.slots) if (slot.task?.job === job) this.replace(slot, null);
    }
  }

  /** Run chunk requests for a job; resolves when all succeed, rejects on the first failure or abort. */
  private runBatch(
    job: Job,
    requests: Omit<ChunkRequest, 'taskId'>[],
    onResult: (rows: { start: number; end: number }, response: Extract<WorkerResponse, { type: 'chunk' }>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (job.cancelled || signal?.aborted) return reject(new RenderAbortedError());
      let remaining = requests.length;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      signal?.addEventListener('abort', () => fail(new RenderAbortedError()), { once: true });
      for (const request of requests) {
        const id = this.nextId++;
        this.enqueue({
          id,
          job,
          request: { ...request, taskId: id },
          resolve: (response) => {
            if (job.cancelled || settled) return;
            onResult(request.rows, response);
            if (--remaining === 0) {
              settled = true;
              resolve();
            }
          },
          reject: (error) => {
            if (!job.cancelled) fail(error);
          },
        });
      }
      this.pump();
    });
  }

  /**
   * Split a frame into row ranges: a few per worker for balance during
   * previews, and memory-bounded chunks for exports (which also drives
   * progress). `margin` is the context rows each chunk re-renders.
   */
  private planRows(frame: FrameRequest, priority: RenderPriority, margin: number): { start: number; end: number }[] {
    const { height } = frame;
    let rows: number;
    if (priority === 'export') {
      const byPixels = Math.floor(2_000_000 / frame.width);
      // Keep re-rendered context rows a small fraction of the work.
      rows = Math.max(32, Math.min(byPixels, 512), margin * 4);
    } else {
      rows = Math.max(Math.ceil(height / (this.size * 2)), 16, margin);
    }
    const chunks: { start: number; end: number }[] = [];
    for (let start = 0; start < height; start += rows) chunks.push({ start, end: Math.min(height, start + rows) });
    return chunks;
  }

  dispose(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.slots.length = 0;
    this.queue = [];
  }
}

let shared: RenderPool | null = null;

export function getRenderPool(): RenderPool {
  if (!shared) {
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    shared = new RenderPool(Math.max(1, Math.min(8, cores - 1)));
  }
  return shared;
}
