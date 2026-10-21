import { getLayerDefinition, isSeamless, renderRecipe, type Recipe } from '@material-lab/engine';
import { limit, requireUser, type Services } from '../context';
import { nowIso } from '../db';
import { ApiError, notFound, type Router } from '../http';
import { encodePng } from '../png';
import { userName, type RecipeRow } from '../store';
import { shareJson, type ShareRow } from './recipes';
import { roleOf } from './teams';

const PREVIEW = { defaultWidth: 640, minWidth: 160, maxWidth: 800, cacheEntries: 64 } as const;

/** Rendered previews keyed by recipe version and width; versions change on every edit. */
const previewCache = new Map<string, Buffer>();

function cachePreview(key: string, png: Buffer): void {
  previewCache.delete(key);
  previewCache.set(key, png);
  while (previewCache.size > PREVIEW.cacheEntries) previewCache.delete(previewCache.keys().next().value as string);
}

/**
 * Resolve a public link. Unknown, revoked, expired and deleted links fail
 * with distinct codes but reveal nothing about the recipe.
 */
function resolveShare(s: Services, token: string): { share: ShareRow; row: RecipeRow } {
  const share = s.db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as ShareRow | undefined;
  if (!share) throw notFound('This link does not exist. Check that it was copied completely.', 'share_not_found');
  const row = s.db.prepare('SELECT * FROM recipes WHERE pk = ?').get(share.recipe_pk) as unknown as RecipeRow | undefined;
  if (!row || row.deleted_at) throw new ApiError(410, 'recipe_deleted', 'The recipe behind this link was deleted.');
  if (share.revoked_at) throw new ApiError(410, 'share_revoked', 'This link was turned off by the person who shared it.');
  if (share.expires_at && Date.parse(share.expires_at) <= Date.now()) throw new ApiError(410, 'share_expired', 'This link has expired.');
  return { share, row };
}

export function registerShareRoutes(router: Router, s: Services): void {
  router.add('DELETE', '/v1/shares/:shareId', (req) => {
    const user = requireUser(s, req);
    const share = s.db.prepare('SELECT * FROM shares WHERE id = ?').get(req.params.shareId as string) as ShareRow | undefined;
    if (!share) throw notFound('Link not found.', 'share_not_found');
    const row = s.db.prepare('SELECT user_id, team_id FROM recipes WHERE pk = ?').get(share.recipe_pk) as { user_id: string | null; team_id: string | null };
    // The creator can always revoke; for team recipes, editors and owners can too.
    const allowed =
      share.created_by === user.id ||
      row.user_id === user.id ||
      (row.team_id !== null && ['owner', 'editor'].includes(roleOf(s.db, row.team_id, user.id) ?? ''));
    if (!allowed) throw notFound('Link not found.', 'share_not_found');
    s.db.prepare('UPDATE shares SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(nowIso(), share.id);
    return {};
  });

  router.add(
    'GET',
    '/v1/shared/:token',
    (req) => {
      limit(s, 'public', req.ip);
      const { share, row } = resolveShare(s, req.params.token as string);
      s.db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?').run(share.id);
      const recipe = JSON.parse(row.data as string) as Recipe;
      const owner = row.team_id
        ? { kind: 'team', name: (s.db.prepare('SELECT name FROM teams WHERE id = ?').get(row.team_id) as { name: string }).name }
        : { kind: 'user', name: userName(s.db, row.user_id)?.name ?? 'A Material Lab user' };
      return {
        body: {
          share: { access: share.access, createdAt: share.created_at, expiresAt: share.expires_at },
          sharedBy: owner,
          recipe: {
            name: row.name,
            family: row.family,
            version: row.version,
            updatedAt: row.updated_at,
            engineVersion: recipe.engineVersion,
            canvas: recipe.canvas,
            seamless: isSeamless(recipe),
            layers: recipe.layers.map((l) => ({ type: l.type, name: l.name, supported: getLayerDefinition(l.type) !== undefined })),
          },
          previewUrl: `/v1/shared/${encodeURIComponent(req.params.token as string)}/preview.png`,
          // Full parameters only when the sharer allowed duplication.
          fullRecipe: share.access === 'duplicate' ? recipe : null,
        },
      };
    },
    { cors: 'public' },
  );

  router.add(
    'GET',
    '/v1/shared/:token/preview.png',
    (req) => {
      limit(s, 'preview', req.ip);
      const { row } = resolveShare(s, req.params.token as string);
      const requested = Number(req.url.searchParams.get('width') ?? PREVIEW.defaultWidth);
      const width = Math.round(Math.min(PREVIEW.maxWidth, Math.max(PREVIEW.minWidth, Number.isFinite(requested) ? requested : PREVIEW.defaultWidth)));
      const key = `${row.pk}:${row.version}:${width}`;
      let png = previewCache.get(key);
      if (!png) {
        const recipe = JSON.parse(row.data as string) as Recipe;
        const pixelRatio = width / recipe.canvas.width;
        const height = Math.max(1, Math.round(recipe.canvas.height * pixelRatio));
        const result = renderRecipe(recipe, { width, height, pixelRatio, transparent: recipe.canvas.transparentBackground, tile: isSeamless(recipe) });
        png = encodePng(result.data, width, height);
        cachePreview(key, png);
      }
      return { raw: png, contentType: 'image/png', headers: { 'Cache-Control': 'private, max-age=60' } };
    },
    { cors: 'public' },
  );
}
