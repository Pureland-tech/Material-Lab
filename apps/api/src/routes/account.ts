import {
  bearerToken,
  checkCredentials,
  createSession,
  createUser,
  endSession,
  publicUser,
  validateEmail,
  validatePassword,
  verifyPassword,
  type User,
} from '../auth';
import { limit, requireUser, type Services } from '../context';
import { transaction } from '../db';
import { ApiError, requireObject, stringField, type Router } from '../http';
import { planFor, PLANS } from '../plans';
import { countRecipes, recipeJson, type RecipeRow } from '../store';

export function entitlements(s: Services, user: User) {
  const plan = planFor(user.plan);
  const ownedTeams = (s.db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE user_id = ? AND role = 'owner'").get(user.id) as { n: number }).n;
  const day = new Date().toISOString().slice(0, 10);
  const ai = s.db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(user.id, day) as { count: number } | undefined;
  return {
    plan: user.plan in PLANS ? user.plan : 'free',
    planLabel: plan.label,
    limits: {
      cloudRecipes: plan.cloudRecipes,
      ownedTeams: plan.ownedTeams,
      teamMembers: plan.teamMembers,
      aiSuggestionsPerDay: plan.aiSuggestionsPerDay,
    },
    usage: {
      cloudRecipes: countRecipes(s.db, { kind: 'user', id: user.id }),
      ownedTeams,
      aiSuggestionsToday: ai?.count ?? 0,
    },
    features: {
      cloudSync: true,
      shareLinks: true,
      teams: true,
      aiSuggestions: s.suggester !== null,
      // Platform integrations run locally and need no account entitlement.
      platforms: ['web', 'figma', 'canva', 'framer'],
    },
  };
}

export function registerAccountRoutes(router: Router, s: Services): void {
  router.add('POST', '/v1/auth/signup', async (req) => {
    limit(s, 'auth', req.ip);
    const body = requireObject(await req.body());
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);
    const name = stringField(body, 'name', { max: 80, optional: true, label: 'Name' }) ?? email.split('@')[0]!.slice(0, 80);
    const user = await createUser(s.db, { email, password, name });
    const session = createSession(s.db, user.id, s.config.sessionDays);
    return { status: 201, body: { user: publicUser(user), token: session.token, expiresAt: session.expiresAt } };
  });

  router.add('POST', '/v1/auth/login', async (req) => {
    limit(s, 'auth', req.ip);
    const body = requireObject(await req.body());
    const email = validateEmail(body.email);
    if (typeof body.password !== 'string' || body.password.length > 200) throw new ApiError(401, 'invalid_credentials', 'That email and password do not match an account.');
    const user = await checkCredentials(s.db, email, body.password);
    const session = createSession(s.db, user.id, s.config.sessionDays);
    return { body: { user: publicUser(user), token: session.token, expiresAt: session.expiresAt } };
  });

  router.add('POST', '/v1/auth/logout', (req) => {
    const token = bearerToken(req.headers.authorization);
    if (token) endSession(s.db, token);
    return {};
  });

  /** Sign out on every device. */
  router.add('DELETE', '/v1/auth/sessions', (req) => {
    const user = requireUser(s, req);
    s.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    return {};
  });

  router.add('GET', '/v1/me', (req) => {
    const user = requireUser(s, req);
    return { body: { user: publicUser(user), entitlements: entitlements(s, user) } };
  });

  router.add('PATCH', '/v1/me', async (req) => {
    const user = requireUser(s, req);
    const body = requireObject(await req.body());
    const name = stringField(body, 'name', { max: 80, label: 'Name' }) as string;
    s.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    return { body: { user: publicUser({ ...user, name }) } };
  });

  router.add('GET', '/v1/entitlements', (req) => {
    const user = requireUser(s, req);
    return { body: entitlements(s, user) };
  });

  /** Everything stored about the account, as JSON. */
  router.add('GET', '/v1/me/export', (req) => {
    const user = requireUser(s, req);
    const recipes = s.db.prepare('SELECT * FROM recipes WHERE user_id = ? AND deleted_at IS NULL ORDER BY pk').all(user.id) as unknown as RecipeRow[];
    const shares = s.db
      .prepare('SELECT s.id, s.access, s.created_at, s.expires_at, s.revoked_at, s.view_count, r.recipe_id FROM shares s JOIN recipes r ON r.pk = s.recipe_pk WHERE s.created_by = ?')
      .all(user.id);
    const teams = s.db.prepare('SELECT t.id, t.name, m.role, m.joined_at FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ?').all(user.id);
    return {
      body: { exportedAt: new Date().toISOString(), user: publicUser(user), recipes: recipes.map((r) => recipeJson(s.db, r)), shares, teams },
      headers: { 'Content-Disposition': 'attachment; filename="material-lab-account.json"' },
    };
  });

  /**
   * Delete the account and its data: personal recipes, their share links and
   * sessions. Teams the user solely owns are deleted when nobody else is in
   * them; otherwise ownership must be transferred first.
   */
  router.add('DELETE', '/v1/me', async (req) => {
    const user = requireUser(s, req);
    const body = requireObject(await req.body());
    const row = s.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (typeof body.password !== 'string' || !(await verifyPassword(body.password, row.password_hash))) {
      throw new ApiError(403, 'password_incorrect', 'Enter your current password to delete the account.');
    }
    const owned = s.db
      .prepare(
        `SELECT t.id, t.name,
          (SELECT COUNT(*) FROM team_members o WHERE o.team_id = t.id AND o.role = 'owner') AS owners,
          (SELECT COUNT(*) FROM team_members a WHERE a.team_id = t.id) AS members
         FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? AND m.role = 'owner'`,
      )
      .all(user.id) as { id: string; name: string; owners: number; members: number }[];
    const blocking = owned.filter((t) => t.owners === 1 && t.members > 1);
    if (blocking.length > 0) {
      throw new ApiError(409, 'transfer_ownership_first', `Make someone else an owner of ${blocking.map((t) => `“${t.name}”`).join(', ')} first, or remove its other members.`, {
        teams: blocking.map((t) => ({ id: t.id, name: t.name })),
      });
    }
    transaction(s.db, () => {
      for (const t of owned) if (t.owners === 1) s.db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
      s.db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    });
    return {};
  });
}
