import { DIMENSION_PRESETS, ENGINE_VERSION, SCHEMA_VERSION } from '@material-lab/engine';
import { useEffect, useState } from 'react';
import { Segmented, SelectField, Toggle } from '../components/fields';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { eventLog } from '../lib/analytics';
import { isPersistent } from '../lib/db';
import { clearDraft } from '../lib/draft';
import { clearExportLog } from '../lib/exports-log';
import { formatDateTime } from '../lib/format';
import { clearLibrary, useLibrary } from '../lib/library';
import { useAccount } from '../lib/account';
import { apiBase } from '../lib/api';
import { routeHref } from '../lib/router';
import { useObservable } from '../lib/store';
import { PREVIEW_QUALITY_LABELS, updateSettings, useSettings, type PreviewQuality, type Theme } from '../lib/settings';

const PLATFORMS = [
  { name: 'Figma', status: 'Prototype', detail: 'Plugin that inserts rendered textures as image-filled shapes. Recipes stay editable in Material Lab.' },
  { name: 'Canva', status: 'Prototype', detail: 'App that adds rendered textures to designs through Canva’s app SDK. Not yet reviewed by Canva.' },
  { name: 'Framer', status: 'Prototype', detail: 'Plugin that adds textures as images to Framer projects. Not yet published.' },
];

function ServerUrlField() {
  const settings = useSettings();
  const [value, setValue] = useState(settings.serverUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const builtIn = (import.meta.env.VITE_API_URL as string | undefined) ?? null;
  const apply = () => {
    const v = value.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\/[^\s]+$/.test(v)) return setError('Enter a full address starting with https://');
    setError(null);
    updateSettings({ serverUrl: v || null });
    location.reload();
  };
  return (
    <details className="server-url">
      <summary>Account server{settings.serverUrl ? `: ${settings.serverUrl}` : builtIn ? `: ${builtIn} (built in)` : ': none'}</summary>
      <div className="inline-form">
        <input className="input" aria-label="Account server address" placeholder={builtIn ?? 'https://material-lab.example.com'} value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="button" className="btn btn-secondary btn-small" onClick={apply}>
          Save and reload
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
      <p className="muted small">Only connect to a server you trust. Leave empty to use {builtIn ? 'the built-in server' : 'no server (local only)'}.</p>
    </details>
  );
}

export function SettingsScreen() {
  const settings = useSettings();
  const accountState = useAccount();
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
        {accountState.status === 'signed-in' ? (
          <p>
            Signed in as <strong>{accountState.user?.name}</strong>. Cloud sync is {settings.cloudSync ? 'on' : 'off'}. <a href={routeHref('account')}>Manage account and sync</a>
          </p>
        ) : apiBase() ? (
          <p>
            Everything works without an account. <a href={routeHref('account')}>Sign in</a> to sync recipes between devices, share links and use team libraries.
          </p>
        ) : (
          <p className="muted">
            This version is not connected to an account server, so everything stays in this browser
            {persistent === false ? ' (and this browser is not keeping data between sessions — save recipes as JSON to keep them)' : ''}. Use “Download JSON” in My
            Recipes to back up or move recipes.
          </p>
        )}
        <ServerUrlField />
        <Toggle
          label="Allow AI suggestions to send descriptions"
          checked={settings.aiConsent}
          description="When on, “Describe a texture” can send your description (only that text) to Anthropic’s Claude through the account server without asking each time."
          onChange={(aiConsent) => updateSettings({ aiConsent })}
        />
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
        <p className="muted small">The plugins are prototypes built against each platform’s SDK and have not been tested inside the platforms yet. Export a PNG or JPEG to use textures anywhere today.</p>
      </section>

      <section className="settings-section" aria-labelledby="set-privacy">
        <h2 id="set-privacy">Privacy & data</h2>
        <ul className="bullet-list">
          <li>Textures are generated and exported on this device. Nothing you make is uploaded unless you turn on cloud sync, create a share link or add a recipe to a team.</li>
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
          {settings.cloudSync ? ' Recipes in your account are not deleted, and they come back here on the next sync.' : ''}
        </p>
      </Modal>
    </div>
  );
}
