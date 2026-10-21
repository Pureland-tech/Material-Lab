import { createId, duplicateRecipe, ENGINE_VERSION, inferFamily, type Recipe } from '@material-lab/engine';
import { dbClear, dbDelete, dbGetAll, dbPut } from './db';
import { addVersion, deleteVersions } from './versions';
import { Observable, useObservable } from './store';

/** A recipe saved on this device. */
export interface LibraryEntry {
  recipe: Recipe;
  favorite: boolean;
  savedAt: string;
}

export interface LibraryState {
  status: 'loading' | 'ready' | 'error';
  entries: LibraryEntry[];
  error?: string;
}

const state = new Observable<LibraryState>({ status: 'loading', entries: [] });

function setEntries(entries: LibraryEntry[]): void {
  state.set({ status: 'ready', entries: [...entries].sort((a, b) => b.savedAt.localeCompare(a.savedAt)) });
}

let loading: Promise<void> | null = null;

export function loadLibrary(): Promise<void> {
  if (!loading) {
    loading = dbGetAll<LibraryEntry>('recipes').then(
      (entries) => setEntries(entries),
      (error: unknown) => {
        loading = null;
        state.set({ status: 'error', entries: [], error: error instanceof Error ? error.message : String(error) });
      },
    );
  }
  return loading;
}

export function useLibrary(): LibraryState {
  return useObservable(state);
}

export function getEntry(recipeId: string): LibraryEntry | undefined {
  return state.get().entries.find((e) => e.recipe.recipeId === recipeId);
}

/** Another saved recipe with the same name (case-insensitive), if any. */
export function findByName(name: string, excludeId?: string): LibraryEntry | undefined {
  const target = name.trim().toLowerCase();
  return state.get().entries.find((e) => e.recipe.recipeId !== excludeId && e.recipe.name.trim().toLowerCase() === target);
}

/** "Name", "Name (2)", "Name (3)"… — the first name not already in the library. */
export function uniqueName(name: string): string {
  if (!findByName(name)) return name;
  const base = name.replace(/\s\(\d+\)$/, '');
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`;
    if (!findByName(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

async function put(entry: LibraryEntry): Promise<LibraryEntry> {
  await dbPut('recipes', entry.recipe.recipeId, entry);
  const others = state.get().entries.filter((e) => e.recipe.recipeId !== entry.recipe.recipeId);
  setEntries([entry, ...others]);
  return entry;
}

/**
 * Save a recipe locally. Records the current engine version (the output a
 * user sees is rendered by this engine) and update time.
 */
export async function saveRecipe(recipe: Recipe): Promise<LibraryEntry> {
  await loadLibrary();
  const now = new Date().toISOString();
  const existing = getEntry(recipe.recipeId);
  const saved: Recipe = {
    ...structuredClone(recipe),
    engineVersion: ENGINE_VERSION,
    family: recipe.family === 'custom' ? inferFamily(recipe) : recipe.family,
    metadata: { ...recipe.metadata, updatedAt: now },
  };
  const entry = await put({ recipe: saved, favorite: existing?.favorite ?? false, savedAt: now });
  try {
    await addVersion(saved, now);
  } catch {
    // History is a convenience; the save itself succeeded.
  }
  return entry;
}

export async function renameRecipe(recipeId: string, name: string): Promise<void> {
  const entry = getEntry(recipeId);
  if (!entry) return;
  const now = new Date().toISOString();
  await put({ ...entry, savedAt: now, recipe: { ...entry.recipe, name, metadata: { ...entry.recipe.metadata, updatedAt: now } } });
}

export async function toggleFavorite(recipeId: string): Promise<void> {
  const entry = getEntry(recipeId);
  if (!entry) return;
  await put({ ...entry, favorite: !entry.favorite });
}

export async function duplicateEntry(recipeId: string): Promise<LibraryEntry | undefined> {
  const entry = getEntry(recipeId);
  if (!entry) return undefined;
  const copy = duplicateRecipe(entry.recipe, uniqueName(`${entry.recipe.name} copy`));
  return put({ recipe: copy, favorite: false, savedAt: copy.metadata.createdAt });
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  await dbDelete('recipes', recipeId);
  await deleteVersions(recipeId).catch(() => undefined);
  setEntries(state.get().entries.filter((e) => e.recipe.recipeId !== recipeId));
}

export async function clearLibrary(): Promise<void> {
  await dbClear('recipes');
  await dbClear('versions');
  setEntries([]);
}

/** A copy of a recipe with a fresh id, for "Save as copy". */
export function asNewRecipe(recipe: Recipe, name: string): Recipe {
  const copy = structuredClone(recipe);
  copy.recipeId = createId('recipe');
  copy.name = name;
  copy.metadata.createdAt = new Date().toISOString();
  copy.metadata.updatedAt = copy.metadata.createdAt;
  return copy;
}
