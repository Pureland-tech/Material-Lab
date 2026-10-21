import { FAMILY_LABELS, type FamilyId, type Recipe } from '@material-lab/engine';
import { useCallback, useEffect, useId, useState } from 'react';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { Modal } from '../components/Modal';
import { RecipeThumb } from '../components/RecipeThumb';
import { useToast } from '../components/Toasts';
import { refreshAccount, useAccount } from '../lib/account';
import { track } from '../lib/analytics';
import { api, apiBase, ApiRequestError, type CloudRecipe } from '../lib/api';
import { formatRelative } from '../lib/format';
import { asNewRecipe, getEntry, putEntry, saveRecipe, uniqueName } from '../lib/library';
import { navigate, routeHref } from '../lib/router';
import { ShareDialog } from './editor/ShareDialog';

export type Role = 'owner' | 'editor' | 'viewer';

export interface TeamSummary {
  id: string;
  name: string;
  role: Role;
  memberCount: number;
  recipeCount: number;
}

interface TeamDetail {
  team: { id: string; name: string; createdAt: string };
  role: Role;
  members: { id: string; name: string; email: string; role: Role; joinedAt: string }[];
  folders: { id: string; name: string }[];
  invites: { id: string; role: Role; url: string; expiresAt: string; status: string }[];
  limits: { members: number; recipes: number };
}

interface Activity {
  id: number;
  action: string;
  target: string | null;
  at: string;
  user: { id: string; name: string } | null;
}

const ROLE_LABELS: Record<Role, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
const ACTION_LABELS: Record<string, string> = {
  'team.created': 'created the team',
  'team.renamed': 'renamed the team',
  'invite.created': 'created an invite link',
  'member.joined': 'joined',
  'member.left': 'left the team',
  'member.removed': 'removed a member',
  'member.role_changed': 'changed a role',
  'folder.created': 'created a folder',
  'folder.deleted': 'deleted a folder',
  'recipe.added': 'added',
  'recipe.edited': 'edited',
  'recipe.edited_approved': 'edited (approval cleared)',
  'recipe.deleted': 'deleted',
  'recipe.approved': 'approved',
  'recipe.unapproved': 'withdrew approval of',
  'recipe.shared': 'shared',
};

const can = (role: Role, need: Role) => ['viewer', 'editor', 'owner'].indexOf(role) >= ['viewer', 'editor', 'owner'].indexOf(need);

/** Team libraries (PRD FR-047): roles, folders, approved recipes and activity. */
export function TeamsScreen({ teamId }: { teamId: string | null }) {
  const accountState = useAccount();
  if (!apiBase() || accountState.status !== 'signed-in') {
    return (
      <div className="page narrow">
        <header className="page-head">
          <h1>Teams</h1>
        </header>
        <div className="callout callout-info">
          <Icon name="info" />
          <div className="stack-tight">
            <p>Team libraries let a group share folders of recipes, with roles and approved versions. They need an account.</p>
            {apiBase() ? (
              <a className="btn btn-secondary btn-small" href={routeHref('account')} onClick={() => sessionStorage.setItem('material-lab:after-sign-in', '#/teams')}>
                Sign in
              </a>
            ) : (
              <p className="muted small">This version is not connected to an account server.</p>
            )}
          </div>
        </div>
      </div>
    );
  }
  return teamId ? <TeamDetailView teamId={teamId} /> : <TeamList />;
}

function TeamList() {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const id = useId();

  const load = useCallback(() => {
    api<{ teams: TeamSummary[] }>('GET', '/v1/teams').then(
      (r) => setTeams(r.teams),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setError(null);
    try {
      const res = await api<{ team: { id: string } }>('POST', '/v1/teams', { body: { name: name.trim() } });
      track('team_created', {});
      void refreshAccount();
      navigate('teams', undefined, res.team.id);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'The team could not be created.');
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Teams</h1>
          <p className="muted">Shared libraries with folders, roles and approved recipes.</p>
        </div>
      </header>
      {error && (
        <p className="callout callout-error compact" role="alert">
          {error}
        </p>
      )}
      {teams === null && !error && <p className="muted">Loading teams…</p>}
      {teams && teams.length > 0 && (
        <ul className="team-list">
          {teams.map((t) => (
            <li key={t.id}>
              <a className="card team-card" href={routeHref('teams', undefined, t.id)}>
                <strong>{t.name}</strong>
                <span className="muted small">
                  {ROLE_LABELS[t.role]} · {t.memberCount} member{t.memberCount === 1 ? '' : 's'} · {t.recipeCount} recipe{t.recipeCount === 1 ? '' : 's'}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {teams && teams.length === 0 && <p className="muted">You are not in any teams yet. Create one, or open an invite link from a teammate.</p>}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void create();
        }}
      >
        <label className="field-label" htmlFor={id}>
          New team
        </label>
        <input id={id} className="input" placeholder="Team name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          <Icon name="plus" />
          Create team
        </button>
      </form>
    </div>
  );
}

function TeamDetailView({ teamId }: { teamId: string }) {
  const accountState = useAccount();
  const { openRecipe } = useApp();
  const toast = useToast();
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [recipes, setRecipes] = useState<CloudRecipe[] | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [folder, setFolder] = useState<string | 'all' | 'none'>('all');
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<CloudRecipe | null>(null);
  const [inviteRole, setInviteRole] = useState<Role>('editor');
  const [folderName, setFolderName] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: string; run: () => Promise<void> } | null>(null);
  const me = accountState.user?.id;

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ limit: '200' });
      if (folder !== 'all') q.set('folderId', folder);
      if (approvedOnly) q.set('approved', 'true');
      const [d, r, a] = await Promise.all([
        api<TeamDetail>('GET', `/v1/teams/${encodeURIComponent(teamId)}`),
        api<{ recipes: CloudRecipe[] }>('GET', `/v1/teams/${encodeURIComponent(teamId)}/recipes?${q.toString()}`),
        api<{ activity: Activity[] }>('GET', `/v1/teams/${encodeURIComponent(teamId)}/activity`),
      ]);
      setDetail(d);
      setRecipes(r.recipes);
      setActivity(a.activity);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'The team could not be loaded.');
    }
  }, [teamId, folder, approvedOnly]);
  useEffect(() => void load(), [load]);

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast.show(success, { tone: 'success' });
      await load();
    } catch (e) {
      toast.show(e instanceof ApiRequestError ? e.message : 'That did not work. Please try again.', { tone: 'error' });
    }
  };

  if (error && !detail) {
    return (
      <div className="page narrow">
        <p className="callout callout-error" role="alert">
          {error}
        </p>
        <a href={routeHref('teams')}>All teams</a>
      </div>
    );
  }
  if (!detail) return <div className="page"><p className="muted">Loading team…</p></div>;

  const role = detail.role;
  const t = `/v1/teams/${encodeURIComponent(teamId)}`;
  const recipePath = (r: CloudRecipe) => `${t}/recipes/${encodeURIComponent(r.recipeId)}`;

  const editCopy = async (r: CloudRecipe) => {
    const recipe = r.recipe as Recipe;
    // A local working copy linked to the team recipe; "Update team recipe" in the editor sends changes back.
    const existing = getEntry(recipe.recipeId);
    const entry = await putEntry({
      recipe,
      favorite: existing?.favorite ?? false,
      savedAt: new Date().toISOString(),
      team: { teamId, teamName: detail.team.name, recipeId: r.recipeId, version: r.version },
    });
    openRecipe(entry.recipe, 'team', true);
  };

  return (
    <div className="page team">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            <a href={routeHref('teams')}>Teams</a> / {ROLE_LABELS[role]}
          </p>
          <h1>{detail.team.name}</h1>
          <p className="muted">
            {detail.members.length} of {detail.limits.members} members · {recipes?.length ?? 0} recipe{recipes?.length === 1 ? '' : 's'} shown
          </p>
        </div>
        <Menu
          label="Team actions"
          items={[
            ...(role === 'owner'
              ? [
                  {
                    label: 'Rename team…',
                    icon: 'pencil' as const,
                    onSelect: () => {
                      const name = prompt('Team name', detail.team.name)?.trim();
                      if (name) void run(() => api('PATCH', t, { body: { name } }), 'Team renamed');
                    },
                  },
                  {
                    label: 'Delete team…',
                    icon: 'trash' as const,
                    danger: true,
                    onSelect: () =>
                      setConfirm({
                        title: `Delete “${detail.team.name}”?`,
                        body: 'This deletes the team library, its folders and its share links for everyone. Members keep any copies saved on their own devices.',
                        action: 'Delete team',
                        run: async () => {
                          await api('DELETE', t);
                          navigate('teams');
                        },
                      }),
                  },
                ]
              : []),
            ...(me
              ? [
                  {
                    label: 'Leave team',
                    icon: 'close' as const,
                    onSelect: () =>
                      setConfirm({
                        title: 'Leave this team?',
                        body: 'You will lose access to its library. Copies saved on this device stay.',
                        action: 'Leave team',
                        run: async () => {
                          await api('DELETE', `${t}/members/${encodeURIComponent(me)}`);
                          navigate('teams');
                        },
                      }),
                  },
                ]
              : []),
          ]}
        />
      </header>

      <div className="team-layout">
        <section aria-labelledby="team-library">
          <div className="section-head">
            <h2 id="team-library">Library</h2>
          </div>
          <div className="filter-row">
            <div className="chips" role="group" aria-label="Folders">
              <button type="button" className="chip" aria-pressed={folder === 'all'} onClick={() => setFolder('all')}>
                All
              </button>
              {detail.folders.map((f) => (
                <button key={f.id} type="button" className="chip" aria-pressed={folder === f.id} onClick={() => setFolder(f.id)}>
                  {f.name}
                </button>
              ))}
              <button type="button" className="chip" aria-pressed={folder === 'none'} onClick={() => setFolder('none')}>
                No folder
              </button>
            </div>
            <button type="button" className="chip" aria-pressed={approvedOnly} onClick={() => setApprovedOnly((v) => !v)}>
              <Icon name="check" size={13} /> Approved only
            </button>
          </div>
          {recipes && recipes.length === 0 && (
            <p className="muted">
              No recipes here yet. {can(role, 'editor') ? 'Open a recipe and choose “Add to team library…” from its menu.' : 'Editors can add recipes.'}
            </p>
          )}
          <ul className="card-grid">
            {recipes?.map((r) => (
              <li key={r.recipeId} className="card library-card">
                {r.recipe && <RecipeThumb recipe={r.recipe} width={320} label={`Preview of ${r.name}`} />}
                <div className="card-body">
                  <div className="card-title-row">
                    <span className="card-title">{r.name}</span>
                    {r.approval?.current && (
                      <span className="badge badge-success" title={`Approved by ${r.approval.approvedBy?.name ?? 'an owner'}`}>
                        Approved
                      </span>
                    )}
                  </div>
                  <span className="card-meta">
                    {r.family in FAMILY_LABELS ? FAMILY_LABELS[r.family as FamilyId] : 'Custom'} · v{r.version} · {r.updatedBy?.name ?? 'someone'} {formatRelative(r.updatedAt)}
                    {r.folderId ? ` · ${detail.folders.find((f) => f.id === r.folderId)?.name ?? ''}` : ''}
                  </span>
                  <div className="card-actions">
                    {can(role, 'editor') ? (
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => void editCopy(r)}>
                        Edit
                      </button>
                    ) : null}
                    <Menu
                      label={`Actions for ${r.name}`}
                      items={[
                        {
                          label: 'Duplicate to my recipes',
                          icon: 'copy',
                          onSelect: () =>
                            void run(async () => {
                              const copy = asNewRecipe(r.recipe as Recipe, uniqueName(r.name));
                              await saveRecipe(copy);
                            }, `Saved “${r.name}” to My Recipes`),
                        },
                        ...(can(role, 'owner')
                          ? [
                              r.approval?.current
                                ? { label: 'Withdraw approval', icon: 'close' as const, onSelect: () => void run(() => api('DELETE', `${recipePath(r)}/approval`), 'Approval withdrawn') }
                                : {
                                    label: `Approve version ${r.version}`,
                                    icon: 'check' as const,
                                    onSelect: () => void run(() => api('POST', `${recipePath(r)}/approval`, { body: { version: r.version } }), 'Approved'),
                                  },
                            ]
                          : []),
                        ...(can(role, 'editor')
                          ? [
                              ...detail.folders
                                .filter((f) => f.id !== r.folderId)
                                .map((f) => ({
                                  label: `Move to “${f.name}”`,
                                  icon: 'file' as const,
                                  onSelect: () => void run(() => api('PATCH', recipePath(r), { body: { folderId: f.id, baseVersion: r.version } }), `Moved to ${f.name}`),
                                })),
                              { label: 'Share link…', icon: 'copy' as const, onSelect: () => setSharing(r) },
                              {
                                label: 'Delete…',
                                icon: 'trash' as const,
                                danger: true,
                                disabled: !!r.approval && role !== 'owner',
                                onSelect: () =>
                                  setConfirm({
                                    title: `Delete “${r.name}” from the team?`,
                                    body: 'It is removed from the library for everyone, and its share links stop working.',
                                    action: 'Delete',
                                    run: () => api('DELETE', recipePath(r)),
                                  }),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {can(role, 'editor') && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (folderName.trim()) void run(() => api('POST', `${t}/folders`, { body: { name: folderName.trim() } }), 'Folder created').then(() => setFolderName(''));
              }}
            >
              <input className="input" placeholder="New folder name" aria-label="New folder name" maxLength={60} value={folderName} onChange={(e) => setFolderName(e.target.value)} />
              <button type="submit" className="btn btn-ghost" disabled={!folderName.trim()}>
                Add folder
              </button>
            </form>
          )}
        </section>

        <aside className="stack">
          <section className="card stack-tight" aria-labelledby="team-members">
            <h2 id="team-members" className="small-heading">
              Members
            </h2>
            <ul className="member-list">
              {detail.members.map((m) => (
                <li key={m.id}>
                  <span>
                    <strong>{m.name}</strong>
                    {m.id === me ? ' (you)' : ''}
                    <span className="muted small"> {m.email}</span>
                  </span>
                  {role === 'owner' ? (
                    <select
                      className="input select compact"
                      aria-label={`Role of ${m.name}`}
                      value={m.role}
                      onChange={(e) => void run(() => api('PATCH', `${t}/members/${encodeURIComponent(m.id)}`, { body: { role: e.target.value } }), 'Role changed')}
                    >
                      {(['owner', 'editor', 'viewer'] as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="badge">{ROLE_LABELS[m.role]}</span>
                  )}
                  {role === 'owner' && m.id !== me && (
                    <button type="button" className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => void run(() => api('DELETE', `${t}/members/${encodeURIComponent(m.id)}`), `Removed ${m.name}`)}>
                      <Icon name="close" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {role === 'owner' && (
              <div className="stack-tight">
                <div className="inline-form">
                  <select className="input select compact" aria-label="Role for the invite" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                    <option value="editor">Editor — can add and edit</option>
                    <option value="viewer">Viewer — can view and copy</option>
                    <option value="owner">Owner — can also approve and manage</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() =>
                      void run(async () => {
                        const res = await api<{ invite: { url: string } }>('POST', `${t}/invites`, { body: { role: inviteRole } });
                        await navigator.clipboard?.writeText(res.invite.url).catch(() => undefined);
                      }, 'Invite link created and copied. It works once and expires in 7 days.')
                    }
                  >
                    Create invite link
                  </button>
                </div>
                {detail.invites.length > 0 && (
                  <ul className="invite-list small">
                    {detail.invites.map((i) => (
                      <li key={i.id}>
                        <code className="share-url">{i.url}</code>
                        <span className="muted">
                          {ROLE_LABELS[i.role]} · {i.status} · expires {formatRelative(i.expiresAt)}
                        </span>
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => void run(() => api('DELETE', `${t}/invites/${encodeURIComponent(i.id)}`), 'Invite withdrawn')}>
                          Withdraw
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
          <section className="card stack-tight" aria-labelledby="team-activity">
            <h2 id="team-activity" className="small-heading">
              Activity
            </h2>
            <ul className="activity-list small">
              {activity.slice(0, 20).map((a) => (
                <li key={a.id}>
                  <strong>{a.user?.name ?? 'Someone'}</strong> {ACTION_LABELS[a.action] ?? a.action}
                  {a.action.startsWith('recipe.') && a.target ? ` “${a.target}”` : a.action === 'folder.created' && a.target ? ` “${a.target}”` : ''}{' '}
                  <span className="muted">{formatRelative(a.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {sharing?.recipe && <ShareDialog recipe={sharing.recipe} team={{ teamId, recipeId: sharing.recipeId }} onClose={() => setSharing(null)} />}
      {confirm && (
        <Modal
          open
          title={confirm.title}
          size="small"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  void run(c.run);
                }}
              >
                {confirm.action}
              </button>
            </>
          }
        >
          <p>{confirm.body}</p>
        </Modal>
      )}
    </div>
  );
}
