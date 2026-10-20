import { DIMENSION_PRESETS, ENGINE_VERSION, SCHEMA_VERSION } from '@material-lab/engine';
import { useEffect, useState } from 'react';
import { Segmented, SelectField } from '../components/fields';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { eventLog } from '../lib/analytics';
import { isPersistent } from '../lib/db';
import { clearDraft } from '../lib/draft';
import { clearExportLog } from '../lib/exports-log';
import { formatDateTime } from '../lib/format';
import { clearLibrary, useLibrary } from '../lib/library';
import { useObservable } from '../lib/store';
import { PREVIEW_QUALITY_LABELS, updateSettings, useSettings, type PreviewQuality, type Theme } from '../lib/settings';

const PLATFORMS = [
  { name: 'Figma', status: 'Next release', detail: 'Insert rendered textures as image-filled shapes. Recipes stay editable in Material Lab.' },
  { name: 'Canva', status: 'Planned', detail: 'Add textures to designs through Canva’s app SDK, after technical validation.' },
  { name: 'Framer', status: 'Planned', detail: 'Add texture assets to Framer projects, after a technical spike.' },
];

export function SettingsScreen() {
  const settings = useSettings();
  const library = useLibrary();
  const events = useObservable(eventLog);
  const toast = useToast();
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const ex = settings.exportDefaults;

  useEffect(() => {
    void isPersistent().then(setPersistent);
  }, []);

  const sizeValue = ex.width === null ? 'canvas' : (DIMENSION_PRESETS.find((p) => p.width === ex.width && p.height === ex.height)?.id ?? 'canvas');

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Preferences are stored in this browser.</p>
        </div>
      </header>

      <section className="settings-section" aria-labelledby="set-appearance">
        <h2 id="set-appearance">Appearance</h2>
        <Segmented<Theme>
          label="Theme"
          value={settings.theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(theme) => updateSettings({ theme })}
        />
        <SelectField
          label="Preview quality"
          value={settings.previewQuality}
          options={(Object.keys(PREVIEW_QUALITY_LABELS) as PreviewQuality[]).map((q) => ({ value: q, label: PREVIEW_QUALITY_LABELS[q] }))}
          help="Lower quality keeps the preview responsive on slower devices. Exports always render at full quality."
          onChange={(v) => updateSettings({ previewQuality: v as PreviewQuality })}
        />
      </section>

      <section className="settings-section" aria-labelledby="set-export">
        <h2 id="set-export">Export defaults</h2>
        <p className="muted small">Starting values for the export dialog. Each export still shows its effective settings, and you can change them there.</p>
        <Segmented
          label="Format"
          value={ex.format}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPEG' },
          ]}
          onChange={(format) => updateSettings({ exportDefaults: { ...ex, format } })}
        />
        <SelectField
          label="Size"
          value={sizeValue}
          options={[{ value: 'canvas', label: 'Same as the recipe canvas' }, ...DIMENSION_PRESETS.map((p) => ({ value: p.id, label: `${p.label} — ${p.width} × ${p.height}` }))]}
          onChange={(id) => {
            const p = DIMENSION_PRESETS.find((d) => d.id === id);
            updateSettings({ exportDefaults: { ...ex, width: p?.width ?? null, height: p?.height ?? null } });
          }}
        />
        <Segmented
          label="Scale"
          value={ex.scale}
          options={[1, 2, 3, 4].map((s) => ({ value: s, label: `${s}×` }))}
          onChange={(scale) => updateSettings({ exportDefaults: { ...ex, scale } })}
        />
      </section>

      <section className="settings-section" aria-labelledby="set-account">
        <h2 id="set-account">Account & sync</h2>
        <div className="callout callout-info">
          <Icon name="info" />
          <p>
            Accounts and cloud sync are not available in this version. Everything you make stays in this browser{' '}
            {persistent === false ? '(this browser is not keeping data between sessions — save recipes as JSON to keep them)' : ''}. Use “Download JSON” in My Recipes
            to back up or move recipes.
          </p>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="set-platforms">
        <h2 id="set-platforms">Connected platforms</h2>
        <ul className="platform-list">
          {PLATFORMS.map((p) => (
            <li key={p.name}>
              <div>
                <strong>{p.name}</strong>
                <p className="muted small">{p.detail}</p>
              </div>
              <span className="badge">{p.status}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">Until integrations ship, export a PNG or JPEG and place it in your design tool.</p>
      </section>

      <section className="settings-section" aria-labelledby="set-privacy">
        <h2 id="set-privacy">Privacy & data</h2>
        <ul className="bullet-list">
          <li>Textures are generated and exported on this device. Nothing you make is uploaded.</li>
          <li>Saved recipes ({library.entries.length}) and export history are stored in this browser’s IndexedDB.</li>
          <li>
            Usage events are kept in memory for this session only and never leave your device. They contain counts and categories — never images, recipe contents or
            names.
          </li>
        </ul>
        <details className="event-log">
          <summary>Recent usage events ({events.length})</summary>
          {events.length === 0 ? (
            <p className="muted small">No events yet.</p>
          ) : (
            <ul>
              {events.slice(0, 40).map((e, i) => (
                <li key={i}>
                  <code>{e.name}</code> <span className="muted">{formatDateTime(e.at)}</span>
                  {Object.keys(e.props).length > 0 && <span className="muted small"> {JSON.stringify(e.props)}</span>}
                </li>
              ))}
            </ul>
          )}
        </details>
        <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirmClear(true)}>
          <Icon name="trash" />
          Delete all local data…
        </button>
      </section>

      <section className="settings-section" aria-labelledby="set-about">
        <h2 id="set-about">About</h2>
        <dl className="meta-list">
          <div>
            <dt>Rendering engine</dt>
            <dd>{ENGINE_VERSION}</dd>
          </div>
          <div>
            <dt>Recipe schema</dt>
            <dd>v{SCHEMA_VERSION}</dd>
          </div>
          <div>
            <dt>Render workers</dt>
            <dd>{Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))}</dd>
          </div>
        </dl>
      </section>

      <Modal
        open={confirmClear}
        title="Delete all local data?"
        size="small"
        onClose={() => setConfirmClear(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                await clearLibrary();
                await clearExportLog();
                clearDraft();
                setConfirmClear(false);
                toast.show('All saved recipes and export history were deleted from this browser.');
              }}
            >
              Delete everything
            </button>
          </>
        }
      >
        <p>
          This permanently removes {library.entries.length} saved recipe{library.entries.length === 1 ? '' : 's'}, your export history and any unsaved draft from this
          browser. Exported image files are not affected. The recipe open in the editor stays open.
        </p>
      </Modal>
    </div>
  );
}
