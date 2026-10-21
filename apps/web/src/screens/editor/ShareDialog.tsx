import type { Recipe } from '@material-lab/engine';
import { useCallback, useEffect, useState } from 'react';
import { SelectField } from '../../components/fields';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toasts';
import { useAccount } from '../../lib/account';
import { track } from '../../lib/analytics';
import { api, apiBase, ApiRequestError, type ShareLink } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { getEntry, useLibrary } from '../../lib/library';
import { navigate } from '../../lib/router';
import { useSettings } from '../../lib/settings';
import { entrySyncState, setCloudSync, syncNow, useSyncStatus } from '../../lib/sync';

interface ShareDialogProps {
  recipe: Recipe;
  onClose: () => void;
  /** Share a team recipe instead of a personal one. */
  team?: { teamId: string; recipeId: string };
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Create, copy and revoke read-only links (PRD FR-046). */
export function ShareDialog({ recipe, onClose, team }: ShareDialogProps) {
  const accountState = useAccount();
  const settings = useSettings();
  useLibrary();
  const sync = useSyncStatus();
  const toast = useToast();
  const [access, setAccess] = useState<'view' | 'duplicate'>('view');
  const [expiry, setExpiry] = useState('never');
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const base = team
    ? `/v1/teams/${encodeURIComponent(team.teamId)}/recipes/${encodeURIComponent(team.recipeId)}`
    : `/v1/recipes/${encodeURIComponent(recipe.recipeId)}`;
  const entry = getEntry(recipe.recipeId);
  const state = entry ? entrySyncState(entry) : 'local';
  const ready = team !== undefined || state === 'synced';

  const load = useCallback(async () => {
    try {
      setLinks((await api<{ shares: ShareLink[] }>('GET', `${base}/shares`)).shares);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Links could not be loaded.');
    }
  }, [base]);

  useEffect(() => {
    if (ready && accountState.status === 'signed-in') void load();
  }, [ready, accountState.status, load]);

  let blocker: { text: string; action?: { label: string; run: () => void } } | null = null;
  if (!apiBase()) blocker = { text: 'Share links need an account server, and this version is not connected to one. Export the recipe JSON to share it instead.' };
  else if (accountState.status !== 'signed-in')
    blocker = {
      text: 'Share links need an account so the recipe can be stored online. Sign in or create a free account; your work here stays open.',
      action: {
        label: 'Sign in',
        run: () => {
          sessionStorage.setItem('material-lab:after-sign-in', '#/create');
          onClose();
          navigate('account');
        },
      },
    };
  else if (!team && !entry) blocker = { text: 'Save the recipe first. Links share the saved version.' };
  else if (!team && !settings.cloudSync) blocker = { text: 'Links share the copy in your account. Turn on cloud sync to upload your saved recipes.', action: { label: 'Turn on sync', run: () => setCloudSync(true) } };
  else if (!team && state === 'conflict') blocker = { text: 'This recipe changed on another device too. Choose which version to keep in My Recipes before sharing.' };
  else if (!team && state === 'pending')
    blocker = {
      text: sync.phase === 'syncing' ? 'Uploading your latest saved version…' : sync.phase === 'error' ? `Upload failed: ${sync.error ?? 'unknown error'}` : 'Your latest saved changes are not uploaded yet.',
      action: sync.phase === 'syncing' ? undefined : { label: 'Upload now', run: () => void syncNow() },
    };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ share: ShareLink }>('POST', `${base}/share`, {
        body: { access, ...(expiry === 'never' ? {} : { expiresInDays: Number(expiry) }) },
      });
      setLinks((l) => [res.share, ...(l ?? [])]);
      track('share_link_created', { access, expires: expiry !== 'never' });
      const copied = await copy(res.share.url);
      toast.show(copied ? 'Link created and copied' : 'Link created', { tone: 'success' });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'The link could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (link: ShareLink) => {
    try {
      await api('DELETE', `/v1/shares/${encodeURIComponent(link.id)}`);
      setLinks((l) => (l ?? []).map((x) => (x.id === link.id ? { ...x, status: 'revoked' as const, revokedAt: new Date().toISOString() } : x)));
      toast.show('Link turned off. Anyone opening it now sees that it was turned off.');
    } catch (e) {
      toast.show(e instanceof ApiRequestError ? e.message : 'The link could not be turned off.', { tone: 'error' });
    }
  };

  return (
    <Modal open title={`Share “${recipe.name}”`} description="Read-only links. People with a link cannot change your recipe." size="medium" onClose={onClose}>
      {blocker ? (
        <div className="callout callout-info">
          <Icon name="info" />
          <div className="stack-tight">
            <p>{blocker.text}</p>
            {blocker.action && (
              <button type="button" className="btn btn-secondary btn-small" onClick={blocker.action.run}>
                {blocker.action.label}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="stack">
          <fieldset className="stack-tight">
            <legend className="field-label">People with the link can</legend>
            <label className="radio-row">
              <input type="radio" name="share-access" checked={access === 'view'} onChange={() => setAccess('view')} />
              <span>
                <strong>View</strong> <span className="muted small">— see a preview, layer names and canvas size; settings stay private</span>
              </span>
            </label>
            <label className="radio-row">
              <input type="radio" name="share-access" checked={access === 'duplicate'} onChange={() => setAccess('duplicate')} />
              <span>
                <strong>View and duplicate</strong> <span className="muted small">— also copy the full recipe into their own library</span>
              </span>
            </label>
          </fieldset>
          <SelectField
            label="Link expires"
            value={expiry}
            options={[
              { value: 'never', label: 'Never (until you turn it off)' },
              { value: '1', label: 'After 1 day' },
              { value: '7', label: 'After 7 days' },
              { value: '30', label: 'After 30 days' },
            ]}
            onChange={setExpiry}
          />
          <p className="muted small">Links show the latest synced version, so later edits appear for viewers after they sync.</p>
          <div className="button-row">
            <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
              <Icon name="copy" />
              Create and copy link
            </button>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {links && links.length > 0 && (
            <div>
              <h3 className="small-heading">Links</h3>
              <ul className="share-list">
                {links.map((l) => (
                  <li key={l.id} className={l.status !== 'active' ? 'inactive' : ''}>
                    <div className="share-main">
                      <code className="share-url">{l.url}</code>
                      <span className="muted small">
                        {l.access === 'view' ? 'View' : 'View and duplicate'} · {l.status === 'active' ? `created ${formatRelative(l.createdAt)}` : l.status}
                        {l.expiresAt && l.status === 'active' ? ` · expires ${formatRelative(l.expiresAt)}` : ''} · {l.viewCount} view{l.viewCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    {l.status === 'active' && (
                      <div className="button-row">
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={async () => toast.show((await copy(l.url)) ? 'Link copied' : 'Copy the link from the list', { tone: 'success' })}
                        >
                          Copy
                        </button>
                        <button type="button" className="btn btn-danger-ghost btn-small" onClick={() => void revoke(l)}>
                          Turn off
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
