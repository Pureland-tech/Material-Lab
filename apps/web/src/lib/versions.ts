import type { Recipe } from '@material-lab/engine';
import { dbDelete, dbGetByPrefix, dbPut } from './db';

/** A saved state of a recipe, kept on this device (PRD FR-045). */
export interface RecipeVersion {
  key: string;
  recipeId: string;
  savedAt: string;
  recipe: Recipe;
}

export const MAX_VERSIONS_PER_RECIPE = 30;

function prefix(recipeId: string): string {
  return `${recipeId}|`;
}

export async function listVersions(recipeId: string): Promise<RecipeVersion[]> {
  const rows = await dbGetByPrefix<RecipeVersion>('versions', prefix(recipeId));
  return rows.map((r) => r.value).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Record a version; skips it when nothing changed since the latest one. */
export async function addVersion(recipe: Recipe, savedAt: string): Promise<void> {
  const existing = await listVersions(recipe.recipeId);
  const latest = existing[0];
  const strip = (r: Recipe) => JSON.stringify({ ...r, metadata: { ...r.metadata, updatedAt: '' } });
  if (latest && strip(latest.recipe) === strip(recipe)) return;
  const key = `${prefix(recipe.recipeId)}${savedAt}`;
  await dbPut<RecipeVersion>('versions', key, { key, recipeId: recipe.recipeId, savedAt, recipe });
  for (const old of existing.slice(MAX_VERSIONS_PER_RECIPE - 1)) await dbDelete('versions', old.key);
}

export async function deleteVersions(recipeId: string): Promise<void> {
  for (const v of await listVersions(recipeId)) await dbDelete('versions', v.key);
}
