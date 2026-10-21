import {
  analyzeAlpha,
  createId,
  ENGINE_VERSION,
  EXPORT_LIMITS,
  slugify,
  validateExportSettings,
  type ExportSettings,
  type VariationCandidate,
} from '@material-lab/engine';
import { useEffect, useRef, useState } from 'react';
import { Segmented, Toggle } from '../../components/fields';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { dimensionClass, track } from '../../lib/analytics';
import { addExportRecord } from '../../lib/exports-log';
import { downloadBlob, formatBytes, formatDuration } from '../../lib/format';
import { createZip, type ZipEntry } from '../../lib/zip';
import { runExport } from '../../render/export';
import { isAbortError } from '../../render/pool';

interface BatchExportDialogProps {
  name: string;
  candidates: VariationCandidate[];
  onClose: () => void;
}

/** Export several variation candidates into one ZIP (PRD FR-058). */
export function BatchExportDialog({ name, candidates, onClose }: BatchExportDialogProps) {
  const first = candidates[0]!.recipe;
  const alphaOk = candidates.every((c) => analyzeAlpha(c.recipe).supported);
  const [format, setFormat] = useState<ExportSettings['format']>('png');
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(alphaOk && first.canvas.transparentBackground);
  const [phase, setPhase] = useState<
    { name: 'configure' } | { name: 'running'; done: number; start: number } | { name: 'done'; size: number; ms: number } | { name: 'error'; message: string }
  >({ name: 'configure' });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const base = slugify(name);
  const settingsFor = (c: VariationCandidate): ExportSettings => ({
    format,
    width: c.recipe.canvas.width,
    height: c.recipe.canvas.height,
    scale,
    transparent: format === 'png' && transparent,
    background: '#FFFFFF',
    quality: 0.92,
    filename: `${base}-variation-${c.index + 1}-seed-${c.seed}.${format === 'jpeg' ? 'jpg' : 'png'}`,
  });
  const validation = validateExportSettings(first, settingsFor(candidates[0]!));
  const sizeError = validation.errors.find((e) => e.field === 'size');

  const run = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    const start = performance.now();
    setPhase({ name: 'running', done: 0, start });
    const entries: ZipEntry[] = [];
    try {
      for (const [i, c] of candidates.entries()) {
        const s = settingsFor(c);
        const output = await runExport(c.recipe, s, { signal: controller.signal });
        entries.push({ name: s.filename, data: new Uint8Array(await output.blob.arrayBuffer()) });
        // Keep each variation's recipe so it can be recreated exactly.
        entries.push({ name: s.filename.replace(/\.(png|jpg)$/, '.recipe.json'), data: new TextEncoder().encode(`${JSON.stringify(c.recipe, null, 2)}\n`) });
        void addExportRecord({
          id: createId('export'),
          createdAt: new Date().toISOString(),
          status: 'success',
          filename: s.filename,
          format: s.format,
          width: output.width,
          height: output.height,
          scale: s.scale,
          fileSize: output.blob.size,
          durationMs: output.ms,
          recipeId: c.recipe.recipeId,
          recipeName: `${c.recipe.name} (variation ${c.index + 1})`,
          seed: c.recipe.seed,
          engineVersion: ENGINE_VERSION,
          recipe: c.recipe,
          settings: s,
        });
        setPhase({ name: 'running', done: i + 1, start });
      }
      const zip = createZip(entries);
      downloadBlob(zip, `${base}-variations.zip`);
      track('export_completed', { format, duration_class: 'batch', file_size_class: dimensionClass(first.canvas.width * scale, first.canvas.height * scale), batch_count: candidates.length });
      setPhase({ name: 'done', size: zip.size, ms: performance.now() - start });
    } catch (error) {
      if (isAbortError(error)) {
        setPhase({ name: 'configure' });
        return;
      }
      track('export_failed', { format, error_category: 'batch' });
      setPhase({ name: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const running = phase.name === 'running';
  return (
    <Modal
      open
      title={`Export ${candidates.length} variation${candidates.length === 1 ? '' : 's'}`}
      size="small"
      dismissible={!running}
      onClose={onClose}
      footer={
        phase.name === 'configure' ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={!validation.valid && !!sizeError}>
              <Icon name="download" />
              Export ZIP
            </button>
          </>
        ) : running ? (
          <button type="button" className="btn btn-secondary" onClick={() => abortRef.current?.abort()}>
            Cancel export
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      {phase.name === 'configure' && (
        <div className="stack">
          <p className="muted small">
            Each variation renders at the canvas size ({first.canvas.width} × {first.canvas.height}) times the scale, with its recipe JSON alongside, in one ZIP.
          </p>
          <Segmented
            label="Format"
            value={format}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
            ]}
            onChange={setFormat}
          />
          <Segmented label="Scale" value={scale} options={EXPORT_LIMITS.scales.map((s) => ({ value: s as number, label: `${s}×` }))} onChange={setScale} />
          <Toggle
            label="Transparent background"
            checked={format === 'png' && transparent}
            disabled={format === 'jpeg' || !alphaOk}
            description={format === 'jpeg' ? 'JPEG cannot store transparency.' : alphaOk ? 'Keep uncovered areas transparent.' : 'These variations have no transparent areas.'}
            onChange={setTransparent}
          />
          {sizeError && <p className="callout callout-error compact">{sizeError.message}</p>}
        </div>
      )}
      {running && (
        <div className="export-progress">
          <p>
            Rendering variation {Math.min(phase.done + 1, candidates.length)} of {candidates.length}…
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={candidates.length} aria-valuenow={phase.done} aria-label="Batch export progress">
            <div className="progress-bar" style={{ width: `${(phase.done / candidates.length) * 100}%` }} />
          </div>
        </div>
      )}
      {phase.name === 'done' && (
        <p className="callout callout-success compact">
          <Icon name="check" />
          Downloaded {base}-variations.zip ({formatBytes(phase.size)}) in {formatDuration(phase.ms)}.
        </p>
      )}
      {phase.name === 'error' && (
        <div className="callout callout-error" role="alert">
          <Icon name="warning" />
          <div className="stack-tight">
            <p>The batch export did not finish: {phase.message}</p>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setPhase({ name: 'configure' })}>
              Back to settings
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
