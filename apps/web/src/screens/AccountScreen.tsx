import { useEffect, useId, useState } from 'react';
import { Toggle } from '../components/fields';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toasts';
import { clearNotice, deleteAccount, refreshAccount, signIn, signOut, signUp, useAccount } from '../lib/account';
import { api, apiBase, ApiRequestError } from '../lib/api';
import { downloadJson, formatRelative } from '../lib/format';
import { useLibrary } from '../lib/library';
import { routeHref } from '../lib/router';
import { useSettings } from '../lib/settings';
import { entrySyncState, setCloudSync, syncNow, useSyncStatus } from '../lib/sync';

const PASSWORD_MIN = 10;

/** Sign-in and account management (PRD flow L). Everything else in the app works without it. */
export function AccountScreen() {
  const accountState = useAccount();
  const server = apiBase();

  if (!server) {
    return (
      <div className="page narrow">
        <header className="page-head">
          <h1>Account</h1>
        </header>
        <div className="callout callout-info">
          <Icon name="info" />
          <p>
            This version of Material Lab is not connected to an account server, so sign-in, cloud sync, share links and teams are not available. Creating,
            editing and exporting work fully without them. If your team runs a Material Lab server, add its address under <a href={routeHref('settings')}>Settings → Account server</a>.
          </p>
        </div>
      </div>
    );
  }
  return accountState.status === 'signed-in' ? <AccountDetails /> : <SignIn />;
}

function SignIn() {
  const accountState = useAccount();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), email: useId(), password: useId() };

  const submit = async () => {
    setError(null);
    if (!email.trim()) return setError('Enter your email address.');
    if (mode === 'signup' && password.length < PASSWORD_MIN) return setError(`Use a password of at least ${PASSWORD_MIN} characters.`);
    setBusy(true);
    try {
      if (mode === 'signup') await signUp({ email: email.trim(), password, name: name.trim() || email.split('@')[0]! });
      else await signIn({ email: email.trim(), password });
      const returnTo = sessionStorage.getItem('material-lab:after-sign-in');
      if (returnTo) {
        sessionStorage.removeItem('material-lab:after-sign-in');
        location.hash = returnTo;
      }
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow account">
      <header className="page-head">
        <div>
          <h1>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
          <p className="muted">An account is optional. You only need one for the features below.</p>
        </div>
      </header>
      {accountState.notice && (
        <div className="callout callout-warning" role="status">
          <Icon name="warning" />
          <p>{accountState.notice}</p>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={clearNotice}>
            <Icon name="close" />
          </button>
        </div>
      )}
      <div className="account-grid">
        <ul className="value-list">
          <li>
            <Icon name="clock" /> <span><strong>Sync saved recipes</strong> between your browsers and devices (you choose when to turn it on).</span>
          </li>
          <li>
            <Icon name="file" /> <span><strong>Share read-only links</strong> to a recipe, with optional copying, expiry and revocation.</span>
          </li>
          <li>
            <Icon name="layers" /> <span><strong>Team libraries</strong> with folders, roles and approved recipes.</span>
          </li>
          <li>
            <Icon name="sparkles" /> <span><strong>AI suggestions</strong> from a description, if the server offers them.</span>
          </li>
          <li className="muted">
            <Icon name="lock" /> <span>Creating, editing and exporting never need an account, and your local recipes stay on this device either way.</span>
          </li>
        </ul>
        <form
          className="card stack account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="segmented" role="tablist" aria-label="Account">
            <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
              Create account
            </button>
          </div>
          {mode === 'signup' && (
            <div className="field">
              <label className="field-label" htmlFor={ids.name}>
                Name
              </label>
              <input id={ids.name} className="input" autoComplete="name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor={ids.email}>
              Email
            </label>
            <input id={ids.email} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={ids.password}>
              Password
            </label>
            <input
              id={ids.password}
              className="input"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'signup' && <p className="field-help">At least {PASSWORD_MIN} characters.</p>}
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <a className="link small" href={routeHref('home')}>
            Continue without an account
          </a>
        </form>
      </div>
    </div>
  );
}

function AccountDetails() {
  const accountState = useAccount();
  const settings = useSettings();
  const sync = useSyncStatus();
  const library = useLibrary();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const user = accountState.user!;
  const ent = accountState.entitlements;

  useEffect(() => {
    void refreshAccount().catch(() => undefined);
  }, [sync.lastSyncedAt]);

  const states = library.entries.map(entrySyncState);
  const conflicts = states.filter((s) => s === 'conflict').length;
  const pending = states.filter((s) => s === 'pending').length;

  return (
    <div className="page narrow account">
      <header className="page-head">
        <div>
          <h1>Account</h1>
          <p className="muted">
            Signed in as <strong>{user.name}</strong> ({user.email})
          </p>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <section className="settings-section" aria-labelledby="acc-sync">
        <h2 id="acc-sync">Cloud sync</h2>
        <Toggle
          label="Sync saved recipes to this account"
          checked={settings.cloudSync}
          description="Copies recipes you save on this device to your account and brings in recipes saved on your other devices."
          onChange={(v) => setCloudSync(v)}
        />
        <ul className="bullet-list small muted">
          <li>Synced: each saved recipe — its name, layers, parameters, seed, canvas and export settings.</li>
          <li>Not synced: exported images, export history, unsaved drafts and your settings.</li>
          <li>If the same recipe changes on two devices, you choose which version to keep. Nothing is overwritten silently.</li>
        </ul>
        {settings.cloudSync && (
          <div className="sync-status-row" role="status">
            <span className={`sync-pill sync-${sync.phase}`}>
              {sync.phase === 'syncing' ? 'Syncing…' : sync.phase === 'error' ? 'Sync failed' : sync.lastSyncedAt ? 'Synced' : 'Not synced yet'}
            </span>
            <span className="muted small">
              {sync.phase === 'error' ? sync.error : sync.lastSyncedAt ? `Last synced ${formatRelative(sync.lastSyncedAt)}` : ''}
              {pending > 0 && sync.phase !== 'syncing' ? ` · ${pending} waiting to upload` : ''}
            </span>
            <button type="button" className="btn btn-ghost btn-small" disabled={sync.phase === 'syncing'} onClick={() => void syncNow()}>
              {sync.phase === 'error' ? 'Retry' : 'Sync now'}
            </button>
          </div>
        )}
        {conflicts > 0 && (
          <p className="callout callout-warning compact">
            <Icon name="warning" />
            <span>
              {conflicts} recipe{conflicts === 1 ? ' was' : 's were'} changed on another device too. <a href={routeHref('recipes')}>Choose which version to keep</a>.
            </span>
          </p>
        )}
      </section>

      {ent && (
        <section className="settings-section" aria-labelledby="acc-plan">
          <h2 id="acc-plan">Plan</h2>
          <dl className="meta-list">
            <div>
              <dt>Plan</dt>
              <dd>{ent.planLabel}</dd>
            </div>
            <div>
              <dt>Cloud recipes</dt>
              <dd>
                {ent.usage.cloudRecipes} of {ent.limits.cloudRecipes}
              </dd>
            </div>
            <div>
              <dt>Teams you own</dt>
              <dd>
                {ent.usage.ownedTeams} of {ent.limits.ownedTeams}
              </dd>
            </div>
            <div>
              <dt>AI suggestions today</dt>
              <dd>{ent.features.aiSuggestions ? `${ent.usage.aiSuggestionsToday} of ${ent.limits.aiSuggestionsPerDay}` : 'Not offered by this server'}</dd>
            </div>
          </dl>
          <p className="muted small">Billing is not part of this version; plans are set by the server operator.</p>
        </section>
      )}

      <section className="settings-section" aria-labelledby="acc-data">
        <h2 id="acc-data">Your data</h2>
        <div className="button-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              try {
                downloadJson(await api('GET', '/v1/me/export'), 'material-lab-account.json');
              } catch (e) {
                toast.show(e instanceof Error ? e.message : 'Export failed', { tone: 'error' });
              }
            }}
          >
            <Icon name="download" />
            Download account data
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              await signOut(true);
              toast.show('Signed out on every device.');
            }}
          >
            Sign out everywhere
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={() => setDeleting(true)}>
            <Icon name="trash" />
            Delete account…
          </button>
        </div>
      </section>

      {deleting && <DeleteAccountDialog onClose={() => setDeleting(false)} />}
    </div>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <Modal
      open
      title="Delete your account?"
      size="small"
      dismissible={!busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || !password}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await deleteAccount(password);
              } catch (e) {
                setError(e instanceof ApiRequestError ? e.message : 'The account could not be deleted.');
                setBusy(false);
              }
            }}
          >
            Delete account
          </button>
        </>
      }
    >
      <div className="stack">
        <p>
          This permanently deletes your account, your cloud recipes and the share links you created. Recipes saved on this device are kept. Teams you own alone
          are deleted; if a team has other members, make one of them an owner first.
        </p>
        <div className="field">
          <label className="field-label" htmlFor={id}>
            Current password
          </label>
          <input id={id} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-autofocus />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
