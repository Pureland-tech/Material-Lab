import { newId, newToken, type User } from '../auth';
import { requireUser, type Services } from '../context';
import { nowIso, transaction, type Db } from '../db';
import { ApiError, badRequest, intField, notFound, requireObject, stringField, type Router } from '../http';
import { planFor, TEAM_RECIPE_LIMIT } from '../plans';
import {
  baseVersionFrom,
  countRecipes,
  deleteRecipe,
  getRecipe,
  insertRecipe,
  listRecipes,
  parseIncomingRecipe,
  parseListQuery,
  recipeJson,
  updateRecipe,
} from '../store';
import { createShare, listShares } from './recipes';

export type Role = 'owner' | 'editor' | 'viewer';
const ROLES: readonly Role[] = ['viewer', 'editor', 'owner'];
const rank = (role: Role) => ROLES.indexOf(role);

export function roleOf(db: Db, teamId: string, userId: string): Role | null {
  const row = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

/** The caller's role, at least `min`. Non-members get 404 so team ids reveal nothing. */
function requireRole(db: Db, teamId: string, user: User, min: Role): Role {
  const role = roleOf(db, teamId, user.id);
  if (!role) throw notFound('Team not found.', 'team_not_found');
  if (rank(role) < rank(min)) {
    const need = min === 'owner' ? 'an owner' : 'an editor or owner';
    throw new ApiError(403, 'forbidden', `Only ${need} of this team can do that.`, { requiredRole: min, role });
  }
  return role;
}

function parseRole(value: unknown): Role {
  if (value !== 'owner' && value !== 'editor' && value !== 'viewer') throw badRequest('"role" must be owner, editor or viewer.');
  return value;
}

function log(db: Db, teamId: string, userId: string | null, action: string, target: string | null = null): void {
  db.prepare('INSERT INTO activity (team_id, user_id, action, target, created_at) VALUES (?, ?, ?, ?, ?)').run(teamId, userId, action, target, nowIso());
}

function ownerCount(db: Db, teamId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'owner'").get(teamId) as { n: number }).n;
}

function memberLimit(db: Db, teamId: string): number {
  // The most generous plan among the team's owners applies.
  const plans = db.prepare("SELECT u.plan FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND m.role = 'owner'").all(teamId) as { plan: string }[];
  return Math.max(...plans.map((p) => planFor(p.plan).teamMembers), planFor('free').teamMembers);
}

function folderId(db: Db, teamId: string, raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw badRequest('"folderId" must be a folder id or null.');
  const row = db.prepare('SELECT id FROM folders WHERE id = ? AND team_id = ?').get(raw, teamId);
  if (!row) throw notFound('Folder not found.', 'folder_not_found');
  return raw;
}

interface InviteRow {
  id: string;
  team_id: string;
  token: string;
  role: Role;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
}

export function registerTeamRoutes(router: Router, s: Services): void {
  const db = s.db;
  const teamScope = (teamId: string) => ({ kind: 'team' as const, id: teamId });
  const inviteJson = (i: InviteRow) => ({
    id: i.id,
    role: i.role,
    url: `${s.config.publicWebUrl}/#/invite/${i.token}`,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    status: i.revoked_at ? 'revoked' : i.accepted_at ? 'accepted' : Date.parse(i.expires_at) <= Date.now() ? 'expired' : 'pending',
  });

  router.add('POST', '/v1/teams', async (req) => {
    const user = requireUser(s, req);
    const body = requireObject(await req.body());
    const name = stringField(body, 'name', { max: 60, label: 'Team name' }) as string;
    const team = transaction(db, () => {
      const owned = (db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE user_id = ? AND role = 'owner'").get(user.id) as { n: number }).n;
      const max = planFor(user.plan).ownedTeams;
      if (owned >= max) throw new ApiError(403, 'quota_exceeded', `Your plan includes ${max} team${max === 1 ? '' : 's'} you own.`);
      const t = { id: newId('team'), name, created_at: nowIso() };
      db.prepare('INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)').run(t.id, name, user.id, t.created_at);
      db.prepare("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(t.id, user.id, t.created_at);
      log(db, t.id, user.id, 'team.created', name);
      return t;
    });
    return { status: 201, body: { team: { id: team.id, name: team.name, createdAt: team.created_at, role: 'owner' } } };
  });

  router.add('GET', '/v1/teams', (req) => {
    const user = requireUser(s, req);
    const rows = db
      .prepare(
        `SELECT t.id, t.name, t.created_at, m.role,
          (SELECT COUNT(*) FROM team_members x WHERE x.team_id = t.id) AS members,
          (SELECT COUNT(*) FROM recipes r WHERE r.team_id = t.id AND r.deleted_at IS NULL) AS recipes
         FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.name`,
      )
      .all(user.id) as { id: string; name: string; created_at: string; role: Role; members: number; recipes: number }[];
    return { body: { teams: rows.map((t) => ({ id: t.id, name: t.name, createdAt: t.created_at, role: t.role, memberCount: t.members, recipeCount: t.recipes })) } };
  });

  router.add('GET', '/v1/teams/:teamId', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    const role = requireRole(db, teamId, user, 'viewer');
    const team = db.prepare('SELECT id, name, created_at FROM teams WHERE id = ?').get(teamId) as { id: string; name: string; created_at: string };
    const members = db
      .prepare('SELECT u.id, u.name, u.email, m.role, m.joined_at FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.joined_at')
      .all(teamId) as { id: string; name: string; email: string; role: Role; joined_at: string }[];
    const folders = db.prepare('SELECT id, name, created_at FROM folders WHERE team_id = ? ORDER BY name').all(teamId) as { id: string; name: string; created_at: string }[];
    const invites = role === 'owner' ? (db.prepare('SELECT * FROM team_invites WHERE team_id = ? AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC').all(teamId) as unknown as InviteRow[]) : [];
    return {
      body: {
        team: { id: team.id, name: team.name, createdAt: team.created_at },
        role,
        members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, joinedAt: m.joined_at })),
        folders: folders.map((f) => ({ id: f.id, name: f.name, createdAt: f.created_at })),
        invites: invites.map(inviteJson),
        limits: { members: memberLimit(db, teamId), recipes: TEAM_RECIPE_LIMIT },
      },
    };
  });

  router.add('PATCH', '/v1/teams/:teamId', async (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'owner');
    const name = stringField(requireObject(await req.body()), 'name', { max: 60, label: 'Team name' }) as string;
    db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, teamId);
    log(db, teamId, user.id, 'team.renamed', name);
    return { body: { team: { id: teamId, name } } };
  });

  router.add('DELETE', '/v1/teams/:teamId', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'owner');
    // Cascades to members, invites, folders, team recipes and their share links.
    db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
    return {};
  });

  // --- Members and invites ---------------------------------------------------

  router.add('POST', '/v1/teams/:teamId/invites', async (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'owner');
    const body = requireObject(await req.body());
    const role = parseRole(body.role ?? 'editor');
    const days = intField(body, 'expiresInDays', { min: 1, max: 30, optional: true }) ?? 7;
    const invite: InviteRow = {
      id: newId('inv'),
      team_id: teamId,
      token: newToken('mli'),
      role,
      created_by: user.id,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      accepted_by: null,
      accepted_at: null,
      revoked_at: null,
    };
    db.prepare('INSERT INTO team_invites (id, team_id, token, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      invite.id,
      teamId,
      invite.token,
      role,
      user.id,
      invite.created_at,
      invite.expires_at,
    );
    log(db, teamId, user.id, 'invite.created', role);
    return { status: 201, body: { invite: inviteJson(invite) } };
  });

  router.add('DELETE', '/v1/teams/:teamId/invites/:inviteId', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'owner');
    const result = db.prepare('UPDATE team_invites SET revoked_at = ? WHERE id = ? AND team_id = ? AND revoked_at IS NULL').run(nowIso(), req.params.inviteId as string, teamId);
    if (result.changes === 0) throw notFound('Invite not found.', 'invite_not_found');
    return {};
  });

  const pendingInvite = (token: string): InviteRow => {
    const invite = db.prepare('SELECT * FROM team_invites WHERE token = ?').get(token) as InviteRow | undefined;
    if (!invite) throw notFound('This invite link does not exist.', 'invite_not_found');
    if (invite.revoked_at) throw new ApiError(410, 'invite_revoked', 'This invite was withdrawn.');
    if (invite.accepted_at) throw new ApiError(410, 'invite_used', 'This invite has already been used.');
    if (Date.parse(invite.expires_at) <= Date.now()) throw new ApiError(410, 'invite_expired', 'This invite has expired. Ask for a new one.');
    return invite;
  };

  router.add('GET', '/v1/invites/:token', (req) => {
    requireUser(s, req);
    const invite = pendingInvite(req.params.token as string);
    const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(invite.team_id) as { name: string };
    const memberCount = (db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(invite.team_id) as { n: number }).n;
    return { body: { team: { name: team.name, memberCount }, role: invite.role, expiresAt: invite.expires_at } };
  });

  router.add('POST', '/v1/invites/:token/accept', (req) => {
    const user = requireUser(s, req);
    const team = transaction(db, () => {
      const invite = pendingInvite(req.params.token as string);
      if (roleOf(db, invite.team_id, user.id)) throw new ApiError(409, 'already_member', 'You are already in this team.', { teamId: invite.team_id });
      const members = (db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(invite.team_id) as { n: number }).n;
      if (members >= memberLimit(db, invite.team_id)) throw new ApiError(403, 'quota_exceeded', 'This team is full on its current plan.');
      const now = nowIso();
      db.prepare('INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(invite.team_id, user.id, invite.role, now);
      db.prepare('UPDATE team_invites SET accepted_by = ?, accepted_at = ? WHERE id = ?').run(user.id, now, invite.id);
      log(db, invite.team_id, user.id, 'member.joined', invite.role);
      return db.prepare('SELECT id, name FROM teams WHERE id = ?').get(invite.team_id) as { id: string; name: string };
    });
    return { body: { team: { ...team, role: roleOf(db, team.id, user.id) } } };
  });

  router.add('PATCH', '/v1/teams/:teamId/members/:userId', async (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    const target = req.params.userId as string;
    requireRole(db, teamId, user, 'owner');
    const role = parseRole(requireObject(await req.body()).role);
    transaction(db, () => {
      const current = roleOf(db, teamId, target);
      if (!current) throw notFound('Member not found.', 'member_not_found');
      if (current === 'owner' && role !== 'owner' && ownerCount(db, teamId) === 1) {
        throw new ApiError(409, 'last_owner', 'A team needs at least one owner. Make someone else an owner first.');
      }
      db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(role, teamId, target);
      log(db, teamId, user.id, 'member.role_changed', `${target}:${role}`);
    });
    return { body: { member: { id: target, role } } };
  });

  router.add('DELETE', '/v1/teams/:teamId/members/:userId', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    const target = req.params.userId as string;
    // Members can leave; owners can remove anyone.
    requireRole(db, teamId, user, target === user.id ? 'viewer' : 'owner');
    transaction(db, () => {
      const current = roleOf(db, teamId, target);
      if (!current) throw notFound('Member not found.', 'member_not_found');
      if (current === 'owner' && ownerCount(db, teamId) === 1) {
        throw new ApiError(409, 'last_owner', 'A team needs at least one owner. Make someone else an owner, or delete the team.');
      }
      db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, target);
      log(db, teamId, user.id, target === user.id ? 'member.left' : 'member.removed', target);
    });
    return {};
  });

  // --- Folders ---------------------------------------------------------------

  router.add('POST', '/v1/teams/:teamId/folders', async (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'editor');
    const name = stringField(requireObject(await req.body()), 'name', { max: 60, label: 'Folder name' }) as string;
    const count = (db.prepare('SELECT COUNT(*) AS n FROM folders WHERE team_id = ?').get(teamId) as { n: number }).n;
    if (count >= 200) throw new ApiError(403, 'quota_exceeded', 'A team can have up to 200 folders.');
    const folder = { id: newId('fld'), name, createdAt: nowIso() };
    db.prepare('INSERT INTO folders (id, team_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(folder.id, teamId, name, user.id, folder.createdAt);
    log(db, teamId, user.id, 'folder.created', name);
    return { status: 201, body: { folder } };
  });

  router.add('PATCH', '/v1/teams/:teamId/folders/:folderId', async (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'editor');
    const name = stringField(requireObject(await req.body()), 'name', { max: 60, label: 'Folder name' }) as string;
    const result = db.prepare('UPDATE folders SET name = ? WHERE id = ? AND team_id = ?').run(name, req.params.folderId as string, teamId);
    if (result.changes === 0) throw notFound('Folder not found.', 'folder_not_found');
    return { body: { folder: { id: req.params.folderId, name } } };
  });

  router.add('DELETE', '/v1/teams/:teamId/folders/:folderId', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'editor');
    // Recipes in the folder stay in the library, without a folder.
    const result = db.prepare('DELETE FROM folders WHERE id = ? AND team_id = ?').run(req.params.folderId as string, teamId);
    if (result.changes === 0) throw notFound('Folder not found.', 'folder_not_found');
    log(db, teamId, user.id, 'folder.deleted', req.params.folderId as string);
    return {};
  });

  // --- Team library ----------------------------------------------------------

  router.add('GET', '/v1/teams/:teamId/recipes', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'viewer');
    const q = parseListQuery(req.url.searchParams);
    const folder = req.url.searchParams.get('folderId');
    const page = listRecipes(db, teamScope(teamId), {
      ...q,
      folderId: folder === null ? undefined : folder === 'none' ? null : folder,
      approvedOnly: req.url.searchParams.get('approved') === 'true',
    });
    return { body: { recipes: page.rows.map((r) => recipeJson(db, r, { summary: q.summary })), nextCursor: page.nextCursor, serverTime: nowIso() } };
  });

  router.add('POST', '/v1/teams/:teamId/recipes', async (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'editor');
    const body = requireObject(await req.body());
    const recipe = parseIncomingRecipe(body.recipe);
    const row = transaction(db, () => {
      if (countRecipes(db, teamScope(teamId)) >= TEAM_RECIPE_LIMIT) throw new ApiError(403, 'quota_exceeded', `A team library holds up to ${TEAM_RECIPE_LIMIT} recipes.`);
      const created = insertRecipe(db, teamScope(teamId), recipe, user.id, folderId(db, teamId, body.folderId));
      log(db, teamId, user.id, 'recipe.added', recipe.name);
      return created;
    });
    return { status: 201, body: recipeJson(db, row) };
  });

  router.add('GET', '/v1/teams/:teamId/recipes/:recipeId', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'viewer');
    return { body: recipeJson(db, getRecipe(db, teamScope(teamId), req.params.recipeId as string)) };
  });

  /** Update content and/or folder. Changing an approved recipe's content clears its approval. */
  router.add('PATCH', '/v1/teams/:teamId/recipes/:recipeId', async (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'editor');
    const body = requireObject(await req.body());
    const recipe = body.recipe === undefined ? undefined : parseIncomingRecipe(body.recipe);
    const base = baseVersionFrom(body, req.headers['if-match'] as string | undefined);
    const result = transaction(db, () => {
      const row = getRecipe(db, teamScope(teamId), req.params.recipeId as string);
      const folder = 'folderId' in body ? folderId(db, teamId, body.folderId) : undefined;
      const updated = updateRecipe(db, row, { recipe, folderId: folder }, base, user.id);
      log(db, teamId, user.id, updated.approvalCleared ? 'recipe.edited_approved' : 'recipe.edited', updated.row.name);
      return updated;
    });
    return { body: { ...recipeJson(db, result.row), approvalCleared: result.approvalCleared } };
  });

  router.add('DELETE', '/v1/teams/:teamId/recipes/:recipeId', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    const role = requireRole(db, teamId, user, 'editor');
    transaction(db, () => {
      const row = getRecipe(db, teamScope(teamId), req.params.recipeId as string);
      if (row.approved_version !== null && role !== 'owner') {
        throw new ApiError(403, 'forbidden', 'Only an owner can delete an approved recipe.', { requiredRole: 'owner', role });
      }
      deleteRecipe(db, row, user.id);
      log(db, teamId, user.id, 'recipe.deleted', row.name);
    });
    return {};
  });

  /** Approve the current version (owners). The client sends the version it reviewed. */
  router.add('POST', '/v1/teams/:teamId/recipes/:recipeId/approval', async (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'owner');
    const version = intField(requireObject(await req.body()), 'version', { min: 1, max: Number.MAX_SAFE_INTEGER }) as number;
    const row = transaction(db, () => {
      const current = getRecipe(db, teamScope(teamId), req.params.recipeId as string);
      if (current.version !== version) {
        throw new ApiError(409, 'version_conflict', 'The recipe changed after you reviewed it. Review the latest version before approving.', {
          current: recipeJson(db, current),
        });
      }
      db.prepare('UPDATE recipes SET approved_version = ?, approved_by = ?, approved_at = ? WHERE pk = ?').run(version, user.id, nowIso(), current.pk);
      log(db, teamId, user.id, 'recipe.approved', current.name);
      return getRecipe(db, teamScope(teamId), current.recipe_id);
    });
    return { body: recipeJson(db, row) };
  });

  router.add('DELETE', '/v1/teams/:teamId/recipes/:recipeId/approval', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'owner');
    const row = getRecipe(db, teamScope(teamId), req.params.recipeId as string);
    db.prepare('UPDATE recipes SET approved_version = NULL, approved_by = NULL, approved_at = NULL WHERE pk = ?').run(row.pk);
    log(db, teamId, user.id, 'recipe.unapproved', row.name);
    return { body: recipeJson(db, getRecipe(db, teamScope(teamId), row.recipe_id)) };
  });

  router.add('POST', '/v1/teams/:teamId/recipes/:recipeId/share', async (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'editor');
    const body = requireObject(await req.body());
    const row = getRecipe(db, teamScope(teamId), req.params.recipeId as string);
    log(db, teamId, user.id, 'recipe.shared', row.name);
    return createShare(s, user, row, body);
  });

  router.add('GET', '/v1/teams/:teamId/recipes/:recipeId/shares', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'editor');
    return listShares(s, getRecipe(db, teamScope(teamId), req.params.recipeId as string));
  });

  router.add('GET', '/v1/teams/:teamId/activity', (req) => {
    const user = requireUser(s, req);
    const teamId = req.params.teamId as string;
    requireRole(db, teamId, user, 'viewer');
    const rows = db
      .prepare('SELECT a.id, a.action, a.target, a.created_at, u.id AS user_id, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.team_id = ? ORDER BY a.id DESC LIMIT 100')
      .all(teamId) as { id: number; action: string; target: string | null; created_at: string; user_id: string | null; user_name: string | null }[];
    return {
      body: {
        activity: rows.map((r) => ({ id: r.id, action: r.action, target: r.target, at: r.created_at, user: r.user_id ? { id: r.user_id, name: r.user_name } : null })),
      },
    };
  });
}
