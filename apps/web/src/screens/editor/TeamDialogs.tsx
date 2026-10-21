import type { Recipe } from '@material-lab/engine';
import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { SelectField } from '../../components/fields';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toasts';
import { useAccount } from '../../lib/account';
import { api, apiBase, ApiRequestError, type CloudRecipe } from '../../lib/api';
import { asNewRecipe, getEntry, putEntry, type LibraryEntry } from '../../lib/library';
import { navigate, routeHref } from '../../lib/router';
import type { TeamSummary } from '../TeamsScreen';

/** Copy the open recipe into a team library (editors and owners). */
export function AddToTeamDialog({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const accountState = useAccount();
  const toast = useToast();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [teamId, setTeamId] = useState('');
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [folderId, setFolderId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const signedIn = accountState.status === 'signed-in';

  useEffect(() => {
    if (!signedIn || !apiBase()) return;
    api<{ teams: TeamSummary[] }>('GET', '/v1/teams').then(
      (r) => {
        const writable = r.teams.filter((t) => t.role !== 'viewer');
        setTeams(writable);
        if (writable[0]) setTeamId(writable[0].id);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [signedIn]);

  useEffect(() => {
    if (!teamId) return;
    setFolderId('');
    api<{ folders: { id: string; name: string }[] }>('GET', `/v1/teams/${encodeURIComponent(teamId)}`).then(
      (d) => setFolders(d.folders),
      () => setFolders([]),
    );
  }, [teamId]);

  const add = async () => {
    try {
      // A team copy gets its own identity, independent of the personal recipe.
      const copy = asNewRecipe(recipe, recipe.name);
      await api('POST', `/v1/teams/${encodeURIComponent(teamId)}/recipes`, { body: { recipe: copy, folderId: folderId || null } });
      const team = teams?.find((t) => t.id === teamId);
      toast.show(`Added “${recipe.name}” to ${team?.name ?? 'the team'}`, { tone: 'success', actions: [{ label: 'Open team', onClick: () => navigate('teams', undefined, teamId) }] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'The recipe could not be added.');
    }
  };

  const blocked = !apiBase() ? 'Team libraries need an account server, and this version is not connected to one.' : !signedIn ? 'Sign in to use team libraries.' : null;

  return (
    <Modal
      open
      title="Add to team library"
      size="small"
      onClose={onClose}
      footer={
        blocked || (teams && teams.length === 0) ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!teamId} onClick={() => void add()}>
              Add copy
            </button>
          </>
        )
      }
    >
      {blocked ? (
        <p className="callout callout-info compact">
          <Icon name="info" />
          <span>
            {blocked} {signedIn || !apiBase() ? null : <a href={routeHref('account')}>Sign in</a>}
          </span>
        </p>
      ) : teams === null ? (
        <p className="muted">Loading teams…</p>
      ) : teams.length === 0 ? (
        <p className="muted">
          You are not an editor of any team. <a href={routeHref('teams')}>Create a team</a> or ask an owner for editor access.
        </p>
      ) : (
        <div className="stack">
          <SelectField label="Team" value={teamId} options={teams.map((t) => ({ value: t.id, label: t.name }))} onChange={setTeamId} />
          <SelectField label="Folder" value={folderId} options={[{ value: '', label: 'No folder' }, ...folders.map((f) => ({ value: f.id, label: f.name }))]} onChange={setFolderId} />
          <p className="muted small">The team gets its own copy. Changes you make here later do not change it.</p>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Send the saved working copy back to the team library. Uses the version the
 * copy started from, so a teammate's newer edit is never overwritten silently.
 */
export function UpdateTeamDialog({ entry, onClose }: { entry: LibraryEntry; onClose: () => void }) {
  const { dirty, save, dispatch } = useApp();
  const toast = useToast();
  const [conflict, setConflict] = useState<CloudRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const team = entry.team!;
  const path = `/v1/teams/${encodeURIComponent(team.teamId)}/recipes/${encodeURIComponent(team.recipeId)}`;

  const push = async (baseVersion: number) => {
    setBusy(true);
    setError(null);
    try {
      if (dirty && !(await save())) return;
      const latest = getEntry(entry.recipe.recipeId) ?? entry;
      const res = await api<CloudRecipe & { approvalCleared: boolean }>('PATCH', path, { body: { recipe: latest.recipe, baseVersion } });
      await putEntry({ ...latest, team: { ...team, version: res.version } });
      toast.show(res.approvalCleared ? `Updated in ${team.teamName}. Its approval was cleared; an owner can approve the new version.` : `Updated in ${team.teamName}`, {
        tone: 'success',
      });
      onClose();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'version_conflict') setConflict(e.details.current as CloudRecipe);
      else setError(e instanceof ApiRequestError ? e.message : 'The team recipe could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  const takeTheirs = async () => {
    if (!conflict?.recipe) return;
    const updated = await putEntry({ ...entry, recipe: conflict.recipe, team: { ...team, version: conflict.version } });
    dispatch({ type: 'load', recipe: updated.recipe, source: 'team', persisted: true });
    toast.show('Replaced your copy with the latest team version.');
    onClose();
  };

  return (
    <Modal
      open
      title={conflict ? 'The team version changed' : `Update “${entry.recipe.name}” in ${team.teamName}?`}
      size="small"
      dismissible={!busy}
      onClose={onClose}
      footer={
        conflict ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void takeTheirs()} disabled={busy || !conflict.recipe}>
              Use the team’s version
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void push(conflict.version)} disabled={busy}>
              Replace with mine
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void push(team.version)} disabled={busy}>
              {dirty ? 'Save and update' : 'Update team recipe'}
            </button>
          </>
        )
      }
    >
      {conflict ? (
        <p>
          {conflict.updatedBy?.name ?? 'Someone'} changed this recipe in the team library after you opened it. Choose which version the team should keep.
          {conflict.approval?.current ? ' The team’s version is approved; replacing it clears the approval.' : ''}
        </p>
      ) : (
        <p>
          Your teammates will see your saved changes. If the recipe is approved, updating it clears the approval until an owner approves again.
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
