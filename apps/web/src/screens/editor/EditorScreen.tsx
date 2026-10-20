import { MAX_SEED, normalizeSeed, randomSeed, slugify, withNewSeed, type ExportSettings, type Recipe } from '@material-lab/engine';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { Icon } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { downloadJson } from '../../lib/format';
import { routeHref } from '../../lib/router';
import { PREVIEW_QUALITY_LABELS, updateSettings, useSettings, type PreviewQuality } from '../../lib/settings';
import { setName, setSeed } from '../../editor/ops';
import { ImportDialog } from '../ImportDialog';
import { takePendingExport } from './handoff';
import { ExportDialog } from './ExportDialog';
import { LayerPanel } from './LayerPanel';
import { PreviewPane, type PreviewBackground, type Zoom } from './PreviewPane';
import { PropertiesPanel } from './PropertiesPanel';
import { VariationDrawer } from './VariationDrawer';

const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4];

function isTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'color'].includes((el as HTMLInputElement).type);
}

export function EditorScreen() {
  const { editor } = useApp();
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      {editor.recipe ? <Editor recipe={editor.recipe} onImport={() => setImportOpen(true)} /> : <CreateEmpty onImport={() => setImportOpen(true)} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </>
  );
}

function CreateEmpty({ onImport }: { onImport: () => void }) {
  const { openBlank } = useApp();
  return (
    <div className="page">
      <div className="empty-state large">
        <Icon name="layers" size={32} />
        <h1>Start a texture</h1>
        <p className="muted">Pick a preset to adjust, start from a blank recipe, or reopen something you saved.</p>
        <div className="button-row center">
          <a className="btn btn-primary" href={routeHref('explore')}>
            <Icon name="sparkles" />
            Browse presets
          </a>
          <button type="button" className="btn btn-secondary" onClick={openBlank}>
            <Icon name="plus" />
            Start blank
          </button>
          <a className="btn btn-ghost" href={routeHref('recipes')}>
            Open a saved recipe
          </a>
          <button type="button" className="btn btn-ghost" onClick={onImport}>
            <Icon name="upload" />
            Import JSON
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveStatusBadge() {
  const { editor, dirty, saveStatus } = useApp();
  let text: string;
  let tone = '';
  if (saveStatus === 'saving') text = 'Saving…';
  else if (saveStatus === 'error') {
    text = 'Save failed';
    tone = 'danger';
  } else if (editor.restoredDraft) {
    text = 'Restored draft — not saved';
    tone = 'warning';
  } else if (dirty) {
    text = editor.persisted ? 'Unsaved changes' : 'Not saved yet';
    tone = 'warning';
  } else if (editor.persisted) {
    text = 'Saved on this device';
    tone = 'success';
  } else text = editor.source === 'preset' ? 'From preset · not saved' : 'Not saved';
  return (
    <span className={`save-status ${tone}`} role="status" aria-live="polite">
      <span className="save-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

function Editor({ recipe, onImport }: { recipe: Recipe; onImport: () => void }) {
  const { editor, dispatch, edit, save, saveAsCopy, openBlank } = useApp();
  const settings = useSettings();
  const [exportState, setExportState] = useState<{ initial: ExportSettings | null } | null>(null);
  const [variationsOpen, setVariationsOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [background, setBackground] = useState<PreviewBackground>('checker');
  const [scale, setScale] = useState(1);
  const [nameDraft, setNameDraft] = useState(recipe.name);
  const [seedText, setSeedText] = useState(String(recipe.seed));
  const [seedError, setSeedError] = useState<string | null>(null);

  useEffect(() => setNameDraft(recipe.name), [recipe.name]);
  useEffect(() => setSeedText(String(recipe.seed)), [recipe.seed]);

  // A retry from the Exports page opens the export dialog with its settings.
  useEffect(() => {
    const pending = takePendingExport();
    if (pending) setExportState({ initial: pending });
  }, []);

  const openExport = useCallback(() => setExportState({ initial: null }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (e.shiftKey) saveAsCopy();
        else void save();
      } else if (key === 'e') {
        e.preventDefault();
        openExport();
      } else if (!isTextInput(e.target) && !document.querySelector('dialog[open]')) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          dispatch({ type: 'undo' });
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          dispatch({ type: 'redo' });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, save, saveAsCopy, openExport]);

  const commitSeed = () => {
    const n = Number(seedText.trim());
    if (!seedText.trim() || !Number.isFinite(n) || n < 0 || n > MAX_SEED || !Number.isInteger(n)) {
      setSeedError(`Seed must be a whole number from 0 to ${MAX_SEED.toLocaleString()}.`);
      setSeedText(String(recipe.seed));
      return;
    }
    setSeedError(null);
    edit((r) => setSeed(r, normalizeSeed(n)));
  };

  const zoomBy = (dir: 1 | -1) => {
    const current = zoom === 'fit' ? scale : zoom;
    const next = dir > 0 ? ZOOM_LEVELS.find((z) => z > current * 1.01) : [...ZOOM_LEVELS].reverse().find((z) => z < current * 0.99);
    if (next) setZoom(next);
  };

  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const modKey = mac ? '⌘' : 'Ctrl+';

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <label htmlFor="toolbar-recipe-name" className="sr-only">
            Recipe name
          </label>
          <input
            id="toolbar-recipe-name"
            className="name-input"
            value={nameDraft}
            maxLength={80}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              if (!nameDraft.trim()) setNameDraft(recipe.name);
              else edit((r) => setName(r, nameDraft));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setNameDraft(recipe.name);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <SaveStatusBadge />
        </div>
        <div className="toolbar-right">
          <button
            type="button"
            className="icon-btn"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={editor.past.length === 0}
            aria-label="Undo"
            title={`Undo (${modKey}Z)`}
            aria-keyshortcuts={mac ? 'Meta+Z' : 'Control+Z'}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={editor.future.length === 0}
            aria-label="Redo"
            title={`Redo (${mac ? '⇧⌘Z' : 'Ctrl+Y'})`}
            aria-keyshortcuts={mac ? 'Meta+Shift+Z' : 'Control+Y'}
          >
            <Icon name="redo" />
          </button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button type="button" className="btn btn-secondary" onClick={() => void save()} title={`Save (${modKey}S)`} aria-keyshortcuts={mac ? 'Meta+S' : 'Control+S'}>
            <Icon name="save" />
            Save
          </button>
          <Menu
            label="More recipe actions"
            items={[
              { label: 'Save a copy…', icon: 'copy', hint: mac ? '⇧⌘S' : 'Ctrl+Shift+S', onSelect: saveAsCopy },
              { label: 'Download recipe JSON', icon: 'file', onSelect: () => downloadJson(recipe, `${slugify(recipe.name)}.recipe.json`) },
              { label: 'Import recipe JSON…', icon: 'upload', onSelect: onImport },
              { label: 'New blank recipe', icon: 'plus', onSelect: openBlank },
            ]}
          />
          <button type="button" className="btn btn-primary" onClick={openExport} title={`Export (${modKey}E)`} aria-keyshortcuts={mac ? 'Meta+E' : 'Control+E'}>
            <Icon name="download" />
            Export
          </button>
        </div>
      </div>

      <div className="editor-body">
        <LayerPanel recipe={recipe} addMenuOpen={addMenuOpen} onAddMenuOpenChange={setAddMenuOpen} />

        <div className="editor-center">
          <PreviewPane recipe={recipe} zoom={zoom} background={background} onAddLayer={() => setAddMenuOpen(true)} onScaleChange={setScale} />

          {variationsOpen && <VariationDrawer recipe={recipe} onClose={() => setVariationsOpen(false)} />}

          <div className="bottom-bar">
            <div className="bottom-group">
              <div className={`seed-field${seedError ? ' invalid' : ''}`}>
                <label htmlFor="seed-input">Seed</label>
                <input
                  id="seed-input"
                  className="input"
                  inputMode="numeric"
                  value={seedText}
                  aria-invalid={seedError ? true : undefined}
                  aria-describedby={seedError ? 'seed-error' : 'seed-help'}
                  onChange={(e) => setSeedText(e.target.value)}
                  onBlur={commitSeed}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span id="seed-help" className="sr-only">
                  Every random element derives from the seed.
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => edit((r) => withNewSeed(r, randomSeed()))}
                title="Picks a new seed. Every other setting stays exactly the same."
              >
                <Icon name="dice" />
                New variation
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                aria-expanded={variationsOpen}
                onClick={() => setVariationsOpen((v) => !v)}
                disabled={recipe.layers.length === 0}
              >
                <Icon name="sparkles" />
                Create variations
              </button>
              {seedError && (
                <span id="seed-error" className="field-error inline" role="alert">
                  {seedError}
                </span>
              )}
            </div>
            <div className="bottom-group">
              {recipe.canvas.transparentBackground && (
                <div className="segmented small" role="radiogroup" aria-label="Preview background">
                  {(['checker', 'light', 'dark'] as const).map((b) => (
                    <button key={b} type="button" role="radio" aria-checked={background === b} className={background === b ? 'active' : ''} onClick={() => setBackground(b)}>
                      {b === 'checker' ? 'Checker' : b === 'light' ? 'Light' : 'Dark'}
                    </button>
                  ))}
                </div>
              )}
              <label className="sr-only" htmlFor="preview-quality">
                Preview quality
              </label>
              <select
                id="preview-quality"
                className="input select compact"
                value={settings.previewQuality}
                onChange={(e) => updateSettings({ previewQuality: e.target.value as PreviewQuality })}
                title="Preview quality. Exports always render at full quality."
              >
                {(Object.keys(PREVIEW_QUALITY_LABELS) as PreviewQuality[]).map((q) => (
                  <option key={q} value={q}>
                    Preview: {PREVIEW_QUALITY_LABELS[q]}
                  </option>
                ))}
              </select>
              <div className="zoom-controls" role="group" aria-label="Zoom">
                <button type="button" className="icon-btn" onClick={() => zoomBy(-1)} aria-label="Zoom out" title="Zoom out">
                  <Icon name="zoomOut" />
                </button>
                <button type="button" className={`btn btn-ghost btn-small zoom-label${zoom === 'fit' ? ' active' : ''}`} onClick={() => setZoom('fit')} title="Zoom to fit">
                  {zoom === 'fit' ? `Fit · ${Math.round(scale * 100)}%` : `${Math.round(zoom * 100)}%`}
                </button>
                <button type="button" className="icon-btn" onClick={() => zoomBy(1)} aria-label="Zoom in" title="Zoom in">
                  <Icon name="zoomIn" />
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setZoom(1)} aria-pressed={zoom === 1} title="Actual size (100%)">
                  100%
                </button>
              </div>
            </div>
          </div>
        </div>

        <PropertiesPanel recipe={recipe} />
      </div>

      {exportState && <ExportDialog recipe={recipe} initialSettings={exportState.initial} onClose={() => setExportState(null)} />}
    </div>
  );
}
