import { useAccount } from '../lib/account';
import { apiBase } from '../lib/api';
import { useLibrary } from '../lib/library';
import { routeHref } from '../lib/router';
import { useSettings } from '../lib/settings';
import { entrySyncState, syncNow, useSyncStatus } from '../lib/sync';

/** Top-bar account and sync state, using the PRD's wording: Saved locally, Syncing, Synced, Sync failed. */
export function AccountBadge() {
  const accountState = useAccount();
  const settings = useSettings();
  const sync = useSyncStatus();
  const library = useLibrary();

  if (!apiBase()) {
    return (
      <span className="topbar-note" title="Textures render in your browser. Nothing is uploaded.">
        Local · no account needed
      </span>
    );
  }
  if (accountState.status !== 'signed-in') {
    return (
      <span className="topbar-account">
        <span className="topbar-note">Saved locally</span>
        <a className="btn btn-ghost btn-small" href={routeHref('account')}>
          Sign in
        </a>
      </span>
    );
  }
  const conflicts = settings.cloudSync ? library.entries.filter((e) => entrySyncState(e) === 'conflict').length : 0;
  const label = !settings.cloudSync
    ? 'Saved locally'
    : sync.phase === 'syncing'
      ? 'Syncing…'
      : sync.phase === 'error'
        ? 'Sync failed'
        : conflicts > 0
          ? `${conflicts} to review`
          : 'Synced';
  return (
    <span className="topbar-account">
      {settings.cloudSync && sync.phase === 'error' ? (
        <button type="button" className={`sync-pill sync-error`} onClick={() => void syncNow()} title={`${sync.error ?? ''} — select to retry`}>
          Sync failed · Retry
        </button>
      ) : (
        <a className={`sync-pill sync-${settings.cloudSync ? (conflicts > 0 ? 'conflict' : sync.phase) : 'off'}`} href={routeHref(conflicts > 0 ? 'recipes' : 'account')} role="status">
          {label}
        </a>
      )}
      <a className="topbar-user" href={routeHref('account')} title={accountState.user?.email}>
        {accountState.user?.name}
      </a>
    </span>
  );
}
