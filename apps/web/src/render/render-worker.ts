/// <reference lib="webworker" />
import { renderComposite, renderRecipe, type RenderWarning } from '@material-lab/engine';
import type { ChunkRequest, WorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ChunkRequest>) => {
  const req = event.data;
  if (req.type !== 'render') return;
  const start = performance.now();
  try {
    let buffer: ArrayBuffer;
    let warnings: RenderWarning[] = [];
    if (req.mode === 'composite') {
      const data = renderComposite(req.recipe, {
        width: req.width,
        height: req.height,
        pixelRatio: req.pixelRatio,
        rows: req.rows,
        layerCount: req.layerCount ?? 0,
        tile: req.tile,
        time: req.time ?? undefined,
        motion: req.motion,
      });
      buffer = data.buffer as ArrayBuffer;
    } else {
      const result = renderRecipe(req.recipe, {
        width: req.width,
        height: req.height,
        pixelRatio: req.pixelRatio,
        transparent: req.transparent,
        background: req.background,
        rows: req.rows,
        below: req.below,
        tile: req.tile,
        time: req.time ?? undefined,
        motion: req.motion,
      });
      buffer = result.data.buffer as ArrayBuffer;
      warnings = result.warnings;
    }
    const response: WorkerResponse = { type: 'chunk', taskId: req.taskId, data: buffer, warnings, ms: performance.now() - start };
    scope.postMessage(response, [buffer]);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      taskId: req.taskId,
      message: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(response);
  }
};
