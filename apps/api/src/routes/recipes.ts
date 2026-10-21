import { newId, newToken, type User } from '../auth';
import { requireUser, type Services } from '../context';
import { nowIso, transaction } from '../db';
import { ApiError, badRequest, intField, requireObject, type Router } from '../http';
import { planFor } from '../plans';
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
  type RecipeRow,
} from '../store';

export interface ShareRow {
  id: string;
  token: string;
  recipe_pk: number;
  created_by: string | null;
  access: 'view' | 'duplicate';
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
}

export function shareJson(s: Services, share: ShareRow) {
  const now = Date.now();
  const status = share.revoked_at ? 'revoked' : share.expires_at && Date.parse(share.expires_at) <= now ? 'expired' : 'active';
  return {
    id: share.id,
    access: share.access,
    status,
    url: `${s.config.publicWebUrl}/#/shared/${share.token}`,
    createdAt: share.created_at,
    expiresAt: share.expires_at,
    revokedAt: share.revoked_at,
    viewCount: share.view_count,
  };
}

/** Create a read-only link: `view` shows a preview only; `duplicate` also allows copying the recipe. */
export function createShare(s: Services, user: User, row: RecipeRow, body: Record<string, unknown>) {
  const access = body.access ?? 'view';
  if (access !== 'view' && access !== 'duplicate') throw badRequest('"access" must be "view" or "duplicate".');
  const days = intField(body, 'expiresInDays', { min: 1, max: 365, optional: true });
  const active = (s.db.prepare('SELECT COUNT(*) AS n FROM shares WHERE recipe_pk = ? AND revoked_at IS NULL').get(row.pk) as { n: number }).n;
  if (active >= 20) throw new ApiError(409, 'too_many_shares', 'This recipe has 20 active links. Revoke one before creating another.');
  const share: ShareRow = {
    id: newId('shr'),
    token: newToken('mlx'),
    recipe_pk: row.pk,
    created_by: user.id,
    access,
    created_at: nowIso(),
    expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
    revoked_at: null,
    view_count: 0,
  };
  s.db
    .prepare('INSERT INTO shares (id, token, recipe_pk, created_by, access, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(share.id, share.token, share.recipe_pk, share.created_by, share.access, share.created_at, share.expires_at);
  return { status: 201, body: { share: shareJson(s, share) } };
}

export function listShares(s: Services, row: RecipeRow) {
  const shares = s.db.prepare('SELECT * FROM shares WHERE recipe_pk = ? ORDER BY created_at DESC').all(row.pk) as unknown as ShareRow[];
  return { body: { shares: shares.map((sh) => shareJson(s, sh)) } };
}

export function registerRecipeRoutes(router: Router, s: Services): void {
  const scopeOf = (user: User) => ({ kind: 'user' as const, id: user.id });

  router.add('GET', '/v1/recipes', (req) => {
    const user = requireUser(s, req);
    const q = parseListQuery(req.url.searchParams);
    const page = listRecipes(s.db, scopeOf(user), q);
    return { body: { recipes: page.rows.map((r) => recipeJson(s.db, r, { summary: q.summary })), nextCursor: page.nextCursor, serverTime: nowIso() } };
  });

  router.add('POST', '/v1/recipes', async (req) => {
    const user = requireUser(s, req);
    const body = requireObject(await req.body());
    const recipe = parseIncomingRecipe(body.recipe);
    const row = transaction(s.db, () => {
      const limit = planFor(user.plan).cloudRecipes;
      if (countRecipes(s.db, scopeOf(user)) >= limit) {
        throw new ApiError(403, 'quota_exceeded', `Your plan syncs up to ${limit} recipes. Delete some cloud recipes or keep new ones on this device.`);
      }
      return insertRecipe(s.db, scopeOf(user), recipe, user.id);
    });
    return { status: 201, body: recipeJson(s.db, row), headers: { ETag: `"${row.version}"` } };
  });

  router.add('GET', '/v1/recipes/:recipeId', (req) => {
    const user = requireUser(s, req);
    const row = getRecipe(s.db, scopeOf(user), req.params.recipeId as string);
    return { body: recipeJson(s.db, row), headers: { ETag: `"${row.version}"` } };
  });

  router.add('PATCH', '/v1/recipes/:recipeId', async (req) => {
    const user = requireUser(s, req);
    const body = requireObject(await req.body());
    const recipe = parseIncomingRecipe(body.recipe);
    const base = baseVersionFrom(body, req.headers['if-match'] as string | undefined);
    const result = transaction(s.db, () => updateRecipe(s.db, getRecipe(s.db, scopeOf(user), req.params.recipeId as string), { recipe }, base, user.id));
    return { body: recipeJson(s.db, result.row), headers: { ETag: `"${result.row.version}"` } };
  });

  router.add('DELETE', '/v1/recipes/:recipeId', (req) => {
    const user = requireUser(s, req);
    const raw = req.url.searchParams.get('baseVersion');
    const base = raw === null ? undefined : Number(raw);
    if (base !== undefined && !Number.isInteger(base)) throw badRequest('"baseVersion" must be a whole number.');
    transaction(s.db, () => deleteRecipe(s.db, getRecipe(s.db, scopeOf(user), req.params.recipeId as string), user.id, base));
    return {};
  });

  router.add('POST', '/v1/recipes/:recipeId/share', async (req) => {
    const user = requireUser(s, req);
    const body = requireObject(await req.body());
    return createShare(s, user, getRecipe(s.db, scopeOf(user), req.params.recipeId as string), body);
  });

  router.add('GET', '/v1/recipes/:recipeId/shares', (req) => {
    const user = requireUser(s, req);
    return listShares(s, getRecipe(s.db, scopeOf(user), req.params.recipeId as string));
  });
}
