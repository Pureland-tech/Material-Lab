import {
  analyzeVector,
  createId,
  defaultExportFilename,
  defaultExportSettings,
  DIMENSION_PRESETS,
  ENGINE_VERSION,
  EXPORT_LIMITS,
  isSeamless,
  sanitizeFilename,
  validateExportSettings,
  type ExportSettings,
  type Recipe,
} from '@material-lab/engine';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import { ColorField, NumberField, Segmented, SelectField, Toggle } from '../../components/fields';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { dimensionClass, durationClass, track } from '../../lib/analytics';
import { addExportRecord } from '../../lib/exports-log';
import { downloadBlob, downloadJson, formatByteRange, formatBytes, formatDuration } from '../../lib/format';
import { getSettings } from '../../lib/settings';
import { ExportError, runExport, type ExportOutput, type ExportStage } from '../../render/export';
import { isAbortError } from '../../render/pool';

/** Mount only while open: state starts fresh each time. */
interface ExportDialogProps {
  recipe: Recipe;
  onClose: () => void;
  /** Settings to start from (e.g. retrying a failed export). */
  initialSettings?: ExportSettings | null;
}

type Phase =
  | { name: 'configure' }
  | { name: 'exporting'; progress: number; stage: ExportStage; startedAt: number }
  | { name: 'success'; output: ExportOutput; filename: string; downloaded: boolean; settings: ExportSettings }
  | { name: 'error'; error: ExportError | Error; settings: ExportSettings };

function initialSettingsFor(recipe: Recipe): ExportSettings {
  const base = defaultExportSettings(recipe);
  const prefs = getSettings().exportDefaults;
  const tile = isSeamless(recipe);
  const settings: ExportSettings = {
    ...base,
    format: prefs.format,
    scale: prefs.scale,
    // Seamless tiles always export at the canvas size.
    width: tile ? base.width : (prefs.width ?? base.width),
    height: tile ? base.height : (prefs.height ?? base.height),
  };
  if (settings.format === 'jpeg') settings.transparent = false;
  settings.filename = defaultExportFilename(recipe.name, settings, tile);
  return settings;
}

export function ExportDialog({ recipe, onClose, initialSettings }: ExportDialogProps) {
  const { dirty, editor, save } = useApp();
  const [settings, setSettings] = useState<ExportSettings>(() => initialSettings ?? initialSettingsFor(recipe));
  // A retried export keeps its file name.
  const [filenameEdited, setFilenameEdited] = useState(Boolean(initialSettings));
  const [phase, setPhase] = useState<Phase>({ name: 'configure' });
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const filenameId = useId();
  const [now, setNow] = useState(() => performance.now());

  // Stop a running export if the dialog goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (phase.name !== 'exporting') return;
    const t = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(t);
  }, [phase.name]);

  const tile = isSeamless(recipe);
  const vector = useMemo(() => analyzeVector(recipe), [recipe]);
  const validation = useMemo(() => validateExportSettings(recipe, settings), [recipe, settings]);
  const errorFor = (field: string) => validation.errors.find((e) => e.field === field)?.message;

  const update = (patch: Partial<ExportSettings>) => {
    const next = { ...settings, ...patch };
    let message: string | null = null;
    if (patch.format === 'jpeg' && settings.transparent) {
      // Never drop transparency silently.
      next.transparent = false;
      message = 'Transparency was turned off because JPEG cannot store it. Choose PNG to keep transparent areas.';
    }
    if (!filenameEdited) next.filename = defaultExportFilename(recipe.name, next, tile);
    else if (patch.format) next.filename = sanitizeFilename(next.filename, next.format) || next.filename;
    setSettings(next);
    setNote(message);
  };

  const sizeOption =
    settings.width === recipe.canvas.width && settings.height === recipe.canvas.height
      ? 'canvas'
      : (DIMENSION_PRESETS.find((p) => p.width === settings.width && p.height === settings.height)?.id ?? 'custom');

  const start = async (s: ExportSettings) => {
    const filename = sanitizeFilename(s.filename, s.format);
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    setPhase({ name: 'exporting', progress: 0, stage: 'rendering', startedAt });
    track('export_started', { format: s.format, dimension_class: dimensionClass(s.width * s.scale, s.height * s.scale), alpha_requested: s.transparent });
    const record = {
      id: createId('export'),
      createdAt: new Date().toISOString(),
      filename,
      format: s.format,
      width: s.width * s.scale,
      height: s.height * s.scale,
      scale: s.scale,
      recipeId: recipe.recipeId,
      recipeName: recipe.name,
      seed: recipe.seed,
      engineVersion: ENGINE_VERSION,
      recipe,
      settings: { ...s, filename },
    };
    try {
      const output = await runExport(recipe, s, {
        signal: controller.signal,
        onProgress: (progress, stage) => setPhase((p) => (p.name === 'exporting' ? { ...p, progress, stage } : p)),
      });
      const downloaded = downloadBlob(output.blob, filename);
      setPhase({ name: 'success', output, filename, downloaded, settings: s });
      track('export_completed', { format: s.format, duration_class: durationClass(output.ms), file_size_class: dimensionClass(output.width, output.height) });
      void addExportRecord({ ...record, status: 'success', fileSize: output.blob.size, durationMs: output.ms });
    } catch (error) {
      if (isAbortError(error)) {
        setPhase({ name: 'configure' });
        setNote('Export cancelled. Your settings are kept.');
        return;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      setPhase({ name: 'error', error: err, settings: s });
      track('export_failed', { format: s.format, error_category: err instanceof ExportError ? err.kind : 'unknown' });
      void addExportRecord({ ...record, status: 'failed', error: err.message });
    } finally {
      abortRef.current = null;
    }
  };

  const cancelExport = () => abortRef.current?.abort();

  const title =
    phase.name === 'success' ? 'Export complete' : phase.name === 'error' ? 'Export failed' : phase.name === 'exporting' ? 'Exporting…' : 'Export texture';

  let body;
  let footer;

  if (phase.name === 'configure') {
    const alpha = validation.alpha;
    footer = (
      <>
        <span className="footer-summary" aria-live="polite">
          {validation.outputWidth > 0 && validation.outputHeight > 0 ? (
            <>
              <strong>
                {validation.outputWidth} × {validation.outputHeight} px
              </strong>{' '}
              · {settings.format.toUpperCase()} · ≈ {formatByteRange(validation.estimatedFileSize.min, validation.estimatedFileSize.max)}
            </>
          ) : (
            'Enter a valid size'
          )}
        </span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!validation.valid} onClick={() => void start(settings)}>
          <Icon name="download" />
          Export {settings.format.toUpperCase()}
        </button>
      </>
    );
    body = (
      <div className="export-form">
        <div className="export-col">
          <Segmented
            label="Format"
            value={settings.format}
            options={[
              { value: 'png', label: 'PNG', title: 'Lossless, supports transparency' },
              { value: 'jpeg', label: 'JPEG', title: 'Smaller files, no transparency' },
              { value: 'svg', label: 'SVG', title: vector.vector ? 'Vector shapes and gradients' : 'Image inside an SVG file (not editable vector)' },
            ]}
            onChange={(format) => update({ format })}
          />
          {settings.format === 'svg' && vector.vector && (
            <p className="callout callout-success compact">
              <Icon name="check" />
              Vector SVG: base colors and gradients export as editable shapes.
            </p>
          )}
          {tile ? (
            <div className="callout callout-info compact">
              <Icon name="grid" />
              <p>
                Seamless tile: exports one tile at the canvas size, {recipe.canvas.width} × {recipe.canvas.height} px. Use Scale for more pixels.
              </p>
            </div>
          ) : (
            <>
          <SelectField
            label="Size"
            value={sizeOption}
            options={[
              { value: 'canvas', label: `Recipe canvas — ${recipe.canvas.width} × ${recipe.canvas.height}` },
              ...DIMENSION_PRESETS.map((p) => ({ value: p.id, label: `${p.label} — ${p.width} × ${p.height}` })),
              { value: 'custom', label: 'Custom size' },
            ]}
            onChange={(id) => {
              if (id === 'canvas') update({ width: recipe.canvas.width, height: recipe.canvas.height });
              const p = DIMENSION_PRESETS.find((d) => d.id === id);
              if (p) update({ width: p.width, height: p.height });
            }}
          />
          <div className="field-pair">
            <NumberField label="Width" value={settings.width} min={EXPORT_LIMITS.minSide} max={EXPORT_LIMITS.maxSide} step={1} integer unit="px" noSlider onChange={(width) => update({ width })} />
            <NumberField label="Height" value={settings.height} min={EXPORT_LIMITS.minSide} max={EXPORT_LIMITS.maxSide} step={1} integer unit="px" noSlider onChange={(height) => update({ height })} />
          </div>
          {(settings.width !== recipe.canvas.width || settings.height !== recipe.canvas.height) && (
            <p className="muted small">Texture features keep their size: a different size shows more or less of the texture rather than stretching it.</p>
          )}
            </>
          )}
          <Segmented
            label="Scale"
            value={settings.scale}
            options={EXPORT_LIMITS.scales.map((s) => ({ value: s as number, label: `${s}×` }))}
            onChange={(scale) => update({ scale })}
          />
          {errorFor('size') && (
            <div className="callout callout-error compact" role="alert">
              <Icon name="warning" />
              <div className="stack-tight">
                <p>{errorFor('size')}</p>
                {validation.recommended && (
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => update({ ...validation.recommended })}>
                    Use {validation.recommended.width} × {validation.recommended.height} at {validation.recommended.scale}×
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="export-col">
          <Toggle
            label="Transparent background"
            checked={settings.transparent}
            disabled={settings.format === 'jpeg' || !alpha.supported}
            description={
              settings.format === 'jpeg'
                ? 'JPEG cannot store transparency. Choose PNG to keep it.'
                : !alpha.supported
                  ? alpha.reason
                  : 'Keep areas not covered by layers transparent.'
            }
            onChange={(transparent) => update({ transparent })}
          />
          {errorFor('transparent') && <p className="field-error">{errorFor('transparent')}</p>}
          {!settings.transparent && alpha.supported && (
            <ColorField label="Background color" value={settings.background} help="Fills areas that would otherwise be transparent." onChange={(background) => update({ background })} />
          )}
          {settings.format === 'jpeg' && (
            <NumberField label="JPEG quality" value={settings.quality} min={0.5} max={1} step={0.01} unit="%" onChange={(quality) => update({ quality })} />
          )}
          <div className={`field${errorFor('filename') ? ' field-invalid' : ''}`}>
            <label htmlFor={filenameId} className="field-label">
              File name
            </label>
            <input
              id={filenameId}
              className="input"
              value={settings.filename}
              spellCheck={false}
              onChange={(e) => {
                setFilenameEdited(true);
                setSettings((s) => ({ ...s, filename: e.target.value }));
              }}
              onBlur={() => setSettings((s) => ({ ...s, filename: sanitizeFilename(s.filename, s.format) || s.filename }))}
            />
            {errorFor('filename') && <p className="field-error">{errorFor('filename')}</p>}
            {filenameEdited && (
              <button
                type="button"
                className="link-btn small"
                onClick={() => {
                  setFilenameEdited(false);
                  setSettings((s) => ({ ...s, filename: defaultExportFilename(recipe.name, s, tile) }));
                }}
              >
                Use automatic name
              </button>
            )}
          </div>
          {note && (
            <p className="callout callout-info compact" role="status">
              <Icon name="info" />
              {note}
            </p>
          )}
          {validation.warnings.map((w) => (
            <p key={w} className="callout callout-warning compact">
              <Icon name="warning" />
              {w}
            </p>
          ))}
          <p className="muted small">Exports render at full quality on this device. File size is an estimate; textures with fine detail compress less.</p>
        </div>
      </div>
    );
  } else if (phase.name === 'exporting') {
    const pct = Math.round(phase.progress * 100);
    footer = (
      <button type="button" className="btn btn-secondary" onClick={cancelExport}>
        Cancel export
      </button>
    );
    body = (
      <div className="export-progress">
        <p>
          {phase.stage === 'encoding' ? 'Encoding' : 'Rendering'} {validation.outputWidth} × {validation.outputHeight} px {settings.format.toUpperCase()}…
        </p>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Export progress">
          <div className="progress-bar" style={{ width: `${phase.stage === 'encoding' ? 100 : pct}%` }} />
        </div>
        <p className="muted small">
          {phase.stage === 'encoding' ? 'Almost done — compressing the image.' : `${pct}% · ${formatDuration(now - phase.startedAt)} elapsed`}
        </p>
      </div>
    );
  } else if (phase.name === 'success') {
    const { output, filename } = phase;
    footer = (
      <>
        {(dirty || !editor.persisted) && (
          <button type="button" className="btn btn-ghost" onClick={() => void save()}>
            <Icon name="save" />
            Save recipe
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => downloadBlob(output.blob, filename)}>
          <Icon name="download" />
          Download again
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Continue editing
        </button>
      </>
    );
    body = (
      <div className="stack">
        {phase.downloaded ? (
          <p className="callout callout-success compact">
            <Icon name="check" />
            Your file is downloading.
          </p>
        ) : (
          <div className="callout callout-warning compact" role="alert">
            <Icon name="warning" />
            <div className="stack-tight">
              <p>The browser did not start the download. Allow downloads for this site, then try again.</p>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => setPhase({ ...phase, downloaded: downloadBlob(output.blob, filename) })}
              >
                Retry download
              </button>
            </div>
          </div>
        )}
        <dl className="meta-grid">
          <div>
            <dt>File</dt>
            <dd>{filename}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>
              {phase.settings.format.toUpperCase()}
              {phase.settings.format === 'svg'
                ? output.vector
                  ? ' · vector shapes'
                  : ' · embedded PNG image (not vector)'
                : phase.settings.format === 'png'
                  ? phase.settings.transparent
                    ? ' · transparent'
                    : ' · opaque'
                  : ` · quality ${Math.round(phase.settings.quality * 100)}%`}
            </dd>
          </div>
          <div>
            <dt>Dimensions</dt>
            <dd>
              {output.width} × {output.height} px{phase.settings.scale > 1 ? ` (${phase.settings.scale}×)` : ''}
            </dd>
          </div>
          <div>
            <dt>File size</dt>
            <dd>{formatBytes(output.blob.size)}</dd>
          </div>
          <div>
            <dt>Recipe</dt>
            <dd>{recipe.name}</dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd>{recipe.seed}</dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd>{ENGINE_VERSION}</dd>
          </div>
          <div>
            <dt>Render time</dt>
            <dd>{formatDuration(output.ms)}</dd>
          </div>
        </dl>
        <p className="muted small">
          To recreate this exact image later, save the recipe or keep its JSON. The same recipe, seed, engine version and export settings always render the same
          pixels.{' '}
          <button type="button" className="link-btn" onClick={() => downloadJson(recipe, `${filename.replace(/\.(png|jpg|svg)$/, '')}.recipe.json`)}>
            Download recipe JSON
          </button>
        </p>
      </div>
    );
  } else {
    const err = phase.error;
    const memory = err instanceof ExportError && err.kind === 'memory';
    const s = phase.settings;
    footer = (
      <>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setPhase({ name: 'configure' })}>
          Change settings
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void start(s)}>
          Retry
        </button>
      </>
    );
    body = (
      <div className="stack">
        <div className="callout callout-error" role="alert">
          <Icon name="warning" />
          <div className="stack-tight">
            <p>
              <strong>{memory ? 'Not enough memory for this export.' : 'The export did not finish.'}</strong> Your recipe and editor state are unchanged.
            </p>
            <p className="muted small">{err.message}</p>
          </div>
        </div>
        <div className="button-row">
          {(memory || s.width * s.height * s.scale * s.scale > 4_000_000) && (!tile || s.scale > 1) && (
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                const smaller = s.scale > 1 ? { ...s, scale: s.scale - 1 } : { ...s, width: Math.round(s.width * 0.7), height: Math.round(s.height * 0.7) };
                smaller.filename = filenameEdited ? s.filename : defaultExportFilename(recipe.name, smaller, tile);
                setSettings(smaller);
                setPhase({ name: 'configure' });
              }}
            >
              Reduce size
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => {
              const format = s.format === 'jpeg' ? 'png' : 'jpeg';
              const next = { ...s, format: format as ExportSettings['format'], transparent: false };
              next.filename = sanitizeFilename(s.filename, next.format);
              setSettings(next);
              setNote(format === 'jpeg' && s.transparent ? 'Transparency was turned off because JPEG cannot store it.' : null);
              setPhase({ name: 'configure' });
            }}
          >
            Switch to {s.format === 'jpeg' ? 'PNG' : 'JPEG'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Modal open title={title} onClose={phase.name === 'exporting' ? cancelExport : onClose} dismissible={phase.name !== 'exporting'} size="medium" footer={footer}>
      {body}
    </Modal>
  );
}
