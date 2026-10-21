import { RECIPE_LIMITS, validateRecipe, type Recipe } from '@material-lab/engine';
import { nowIso, type Db } from './db';
import { ApiError, badRequest, isRecord, notFound } from './http';

/** Whose library a recipe belongs to. */
export type Scope = { kind: 'user'; id: string } | { kind: 'team'; id: string };

export interface RecipeRow {
  pk: number;
  recipe_id: string;
  user_id: string | null;
  team_id: string | null;
  folder_id: string | null;
  name: string;
  family: string;
  data: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  approved_version: number | null;
  approved_by: string | null;
  approved_at: string | null;
}

const scopeColumn = (scope: Scope) => (scope.kind === 'user' ? 'user_id' : 'team_id');

/** Validate and normalize an untrusted recipe (same rules as file import in the apps). */
export function parseIncomingRecipe(raw: unknown): Recipe {
  if (!isRecord(raw)) throw badRequest('Send the recipe as a JSON object in "recipe".', 'invalid_recipe');
  const bytes = Buffer.byteLength(JSON.stringify(raw));
  if (bytes > RECIPE_LIMITS.maxJsonBytes) {
    throw new ApiError(413, 'recipe_too_large', `Recipes can be at most ${RECIPE_LIMITS.maxJsonBytes / 1024} KB.`);
  }
  const result = validateRecipe(raw);
  if (!result.ok) {
    throw new ApiError(422, 'invalid_recipe', result.errors[0]?.message ?? 'The recipe is not valid.', {
      issues: result.errors.slice(0, 20).map((e) => ({ path: e.path, code: e.code, message: e.message })),
    });
  }
  return result.recipe;
}

export function findRecipe(db: Db, scope: Scope, recipeId: string): RecipeRow | undefined {
  return db.prepare(`SELECT * FROM recipes WHERE ${scopeColumn(scope)} = ? AND recipe_id = ?`).get(scope.id, recipeId) as RecipeRow | undefined;
}

/** An active recipe, or 404. Other users' recipes are indistinguishable from missing ones. */
export function getRecipe(db: Db, scope: Scope, recipeId: string): RecipeRow {
  const row = findRecipe(db, scope, recipeId);
  if (!row || row.deleted_at) throw notFound('Recipe not found.', 'recipe_not_found');
  return row;
}

export function countRecipes(db: Db, scope: Scope): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM recipes WHERE ${scopeColumn(scope)} = ? AND deleted_at IS NULL`).get(scope.id) as { n: number };
  return row.n;
}

export function userName(db: Db, id: string | null): { id: string; name: string } | null {
  if (!id) return null;
  const row = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id) as { id: string; name: string } | undefined;
  return row ?? null;
}

/** API representation. `summary` omits the recipe body (for listings). */
export function recipeJson(db: Db, row: RecipeRow, options: { summary?: boolean } = {}) {
  const base = {
    recipeId: row.recipe_id,
    name: row.name,
    family: row.family,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deleted: row.deleted_at !== null,
  };
  if (row.deleted_at) return base;
  const team = row.team_id
    ? {
        teamId: row.team_id,
        folderId: row.folder_id,
        createdBy: userName(db, row.created_by),
        updatedBy: userName(db, row.updated_by),
        approval:
          row.approved_version !== null
            ? {
                approvedVersion: row.approved_version,
                current: row.approved_version === row.version,
                approvedBy: userName(db, row.approved_by),
                approvedAt: row.approved_at,
              }
            : null,
      }
    : {};
  return { ...base, ...team, ...(options.summary ? {} : { recipe: JSON.parse(row.data as string) as Recipe }) };
}

export function versionConflict(db: Db, row: RecipeRow): ApiError {
  return new ApiError(409, 'version_conflict', 'This recipe changed somewhere else since you last synced it.', {
    current: recipeJson(db, row),
  });
}

export function insertRecipe(db: Db, scope: Scope, recipe: Recipe, actorId: string, folderId: string | null = null): RecipeRow {
  const existing = findRecipe(db, scope, recipe.recipeId);
  const now = nowIso();
  const data = JSON.stringify(recipe);
  if (existing && !existing.deleted_at) {
    throw new ApiError(409, 'recipe_exists', 'A recipe with this id is already in the library.', { current: recipeJson(db, existing) });
  }
  if (existing) {
    // Re-creating a deleted recipe continues its version history, so other devices see the change.
    db.prepare(
      `UPDATE recipes SET name = ?, family = ?, data = ?, version = version + 1, folder_id = ?, updated_by = ?, updated_at = ?,
       deleted_at = NULL, approved_version = NULL, approved_by = NULL, approved_at = NULL WHERE pk = ?`,
    ).run(recipe.name, recipe.family, data, folderId, actorId, now, existing.pk);
    return db.prepare('SELECT * FROM recipes WHERE pk = ?').get(existing.pk) as unknown as RecipeRow;
  }
  const result = db
    .prepare(
      `INSERT INTO recipes (recipe_id, user_id, team_id, folder_id, name, family, data, version, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(recipe.recipeId, scope.kind === 'user' ? scope.id : null, scope.kind === 'team' ? scope.id : null, folderId, recipe.name, recipe.family, data, actorId, actorId, now, now);
  return db.prepare('SELECT * FROM recipes WHERE pk = ?').get(result.lastInsertRowid) as unknown as RecipeRow;
}

/**
 * Update with optimistic concurrency: `baseVersion` must be the version the
 * client last saw, so a newer edit from another device is never overwritten.
 */
export function updateRecipe(
  db: Db,
  row: RecipeRow,
  changes: { recipe?: Recipe; folderId?: string | null },
  baseVersion: number,
  actorId: string,
): { row: RecipeRow; approvalCleared: boolean } {
  if (baseVersion !== row.version) throw versionConflict(db, row);
  const recipe = changes.recipe;
  if (recipe && recipe.recipeId !== row.recipe_id) throw badRequest('The recipe id does not match the URL.', 'id_mismatch');
  const contentChanged = recipe !== undefined && JSON.stringify(recipe) !== row.data;
  const approvalCleared = contentChanged && row.approved_version !== null;
  const now = nowIso();
  const result = db.prepare(
    `UPDATE recipes SET name = ?, family = ?, data = ?, folder_id = ?, version = version + 1, updated_by = ?, updated_at = ?,
     approved_version = CASE WHEN ? THEN NULL ELSE approved_version END,
     approved_by = CASE WHEN ? THEN NULL ELSE approved_by END,
     approved_at = CASE WHEN ? THEN NULL ELSE approved_at END
     WHERE pk = ? AND version = ?`,
  ).run(
    recipe?.name ?? row.name,
    recipe?.family ?? row.family,
    recipe ? JSON.stringify(recipe) : row.data,
    changes.folderId !== undefined ? changes.folderId : row.folder_id,
    actorId,
    now,
    approvalCleared ? 1 : 0,
    approvalCleared ? 1 : 0,
    approvalCleared ? 1 : 0,
    row.pk,
    row.version,
  );
  const updated = db.prepare('SELECT * FROM recipes WHERE pk = ?').get(row.pk) as unknown as RecipeRow;
  // Another process changed the row between our read and write.
  if (result.changes === 0) throw versionConflict(db, updated);
  return { row: updated, approvalCleared };
}

/** Delete, keeping a tombstone so other devices learn about it on sync. Share links stop working. */
export function deleteRecipe(db: Db, row: RecipeRow, actorId: string, baseVersion?: number): void {
  if (baseVersion !== undefined && baseVersion !== row.version) throw versionConflict(db, row);
  const now = nowIso();
  db.prepare(
    `UPDATE recipes SET data = NULL, version = version + 1, deleted_at = ?, updated_at = ?, updated_by = ?,
     approved_version = NULL, approved_by = NULL, approved_at = NULL WHERE pk = ?`,
  ).run(now, now, actorId, row.pk);
  db.prepare('UPDATE shares SET revoked_at = COALESCE(revoked_at, ?) WHERE recipe_pk = ?').run(now, row.pk);
}

export interface ListOptions {
  /** Only rows changed after this time, including deletions (for sync). */
  since?: string;
  cursor?: string;
  limit: number;
  folderId?: string | null;
  approvedOnly?: boolean;
}

/** Page through recipes ordered by (updated_at, pk). */
export function listRecipes(db: Db, scope: Scope, options: ListOptions): { rows: RecipeRow[]; nextCursor: string | null } {
  const where = [`${scopeColumn(scope)} = ?`];
  const args: (string | number)[] = [scope.id];
  if (options.since) {
    where.push('updated_at > ?');
    args.push(options.since);
  } else {
    where.push('deleted_at IS NULL');
  }
  if (options.folderId !== undefined) {
    where.push(options.folderId === null ? 'folder_id IS NULL' : 'folder_id = ?');
    if (options.folderId !== null) args.push(options.folderId);
  }
  if (options.approvedOnly) where.push('approved_version = version');
  if (options.cursor) {
    const decoded = Buffer.from(options.cursor, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    const pk = Number(decoded.slice(sep + 1));
    if (sep < 0 || !Number.isInteger(pk)) throw badRequest('Invalid cursor.', 'invalid_cursor');
    where.push('(updated_at > ? OR (updated_at = ? AND pk > ?))');
    args.push(decoded.slice(0, sep), decoded.slice(0, sep), pk);
  }
  const rows = db
    .prepare(`SELECT * FROM recipes WHERE ${where.join(' AND ')} ORDER BY updated_at, pk LIMIT ?`)
    .all(...args, options.limit + 1) as unknown as RecipeRow[];
  const more = rows.length > options.limit;
  const page = more ? rows.slice(0, options.limit) : rows;
  const last = page[page.length - 1];
  return { rows: page, nextCursor: more && last ? Buffer.from(`${last.updated_at}|${last.pk}`).toString('base64url') : null };
}

export function parseListQuery(query: URLSearchParams): Omit<ListOptions, 'folderId' | 'approvedOnly'> & { summary: boolean } {
  const since = query.get('since') ?? undefined;
  if (since !== undefined && Number.isNaN(Date.parse(since))) throw badRequest('"since" must be an ISO date.', 'invalid_request');
  const limitRaw = query.get('limit');
  const limit = limitRaw === null ? 100 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw badRequest('"limit" must be 1–200.', 'invalid_request');
  return {
    since: since ? new Date(since).toISOString() : undefined,
    cursor: query.get('cursor') ?? undefined,
    limit,
    summary: query.get('fields') === 'summary',
  };
}

export function baseVersionFrom(body: Record<string, unknown>, ifMatch: string | undefined): number {
  const raw = body.baseVersion ?? (ifMatch ? Number(ifMatch.replace(/^W\//, '').replace(/"/g, '')) : undefined);
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new ApiError(428, 'base_version_required', 'Send "baseVersion" (the version you last saw) so newer changes are not overwritten.');
  }
  return raw;
}
