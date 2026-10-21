/**
 * Opt-in cloud sync of saved recipes (PRD FR-043, flow L).
 *
 * Local-first: the device library is the source of truth for the UI and
 * nothing is lost when sync fails. Each saved recipe remembers the cloud
 * version it last matched; the server only accepts updates against that
 * version, so edits from two devices become a visible conflict for the user
 * to resolve — never a silent overwrite.
 */
import { contentFingerprint, type Recipe } from '@material-lab/engine';
import { account } from './account';
import { track } from './analytics';
import { api, apiBase, ApiRequestError, type CloudRecipe } from './api';
import {
  asNewRecipe,
  getEntry,
  getLibraryEntries,
  loadLibrary,
  onLibraryEvent,
  putEntry,
  removeEntry,
  saveRecipe,
  uniqueName,
  type CloudLink,
  type LibraryEntry,
} from './library';
import { getSettings, updateSettings } from './settings';
import { Observable, useObservable } from './store';

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  lastSyncedAt: string | null;
  error: string | null;
}

export const syncStatus = new Observable<SyncStatus>({ phase: 'off', lastSyncedAt: null, error: null });

/** A recipe the cloud replaced while it was open but unchanged, so the editor can refresh. */
export const remoteReplacements = new Observable<Recipe | null>(null);

export type EntrySyncState = 'local' | 'pending' | 'synced' | 'conflict' | 'team';

let editingGuard: (recipeId: string) => boolean = () => false;

/** Register a check for "open in the editor with unsaved changes": such recipes are never replaced. */
export function setEditingGuard(guard: (recipeId: string) => boolean): void {
  editingGuard = guard;
}

function userId(): string | null {
  const a = account.get();
  return a.status === 'signed-in' ? (a.user?.id ?? null) : null;
}

export function syncEnabled(): boolean {
  return apiBase() !== null && userId() !== null && getSettings().cloudSync;
}

/** The link to the signed-in account's copy (links from another account do not count). */
function linkOf(entry: LibraryEntry): CloudLink | undefined {
  const uid = userId();
  return entry.cloud && uid && entry.cloud.userId === uid ? entry.cloud : undefined;
}

export function entrySyncState(entry: LibraryEntry): EntrySyncState {
  if (!syncEnabled()) return 'local';
  if (entry.team) return 'team';
  const link = linkOf(entry);
  if (link?.conflict) return 'conflict';
  if (!link || contentFingerprint(entry.recipe) !== link.fingerprint) return 'pending';
  return 'synced';
}

// --- Persistence of sync bookkeeping (per account) ---------------------------

interface PendingDelete {
  recipeId: string;
  version: number;
}

const cursorKey = (uid: string) => `material-lab:sync-cursor:${uid}`;
const deletesKey = (uid: string) => `material-lab:sync-deletes:${uid}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage, the next sync re-reads everything; nothing is lost.
  }
}

// --- Sync ------------------------------------------------------------------------

const now = () => new Date().toISOString();

function link(uid: string, version: number, fingerprint: string): CloudLink {
  return { userId: uid, version, fingerprint, syncedAt: now() };
}

function isUnmodified(entry: LibraryEntry): boolean {
  const l = linkOf(entry);
  return !!l && contentFingerprint(entry.recipe) === l.fingerprint && !editingGuard(entry.recipe.recipeId);
}

async function markConflict(entry: LibraryEntry, uid: string, remote: Recipe | null, remoteVersion: number): Promise<void> {
  const current = getEntry(entry.recipe.recipeId) ?? entry;
  const base = linkOf(current) ?? link(uid, 0, '');
  await putEntry({ ...current, cloud: { ...base, conflict: { remote, remoteVersion, detectedAt: now() } } });
}

async function applyRemote(remote: CloudRecipe, uid: string): Promise<void> {
  const local = getEntry(remote.recipeId);
  if (local?.team) return;
  const localLink = local ? linkOf(local) : undefined;
  if (localLink && remote.version <= localLink.version) return; // Already have it (often our own push).

  if (remote.deleted) {
    if (!local || !localLink) return;
    if (isUnmodified(local)) await removeEntry(local.recipe.recipeId);
    else await markConflict(local, uid, null, remote.version);
    return;
  }
  const recipe = remote.recipe as Recipe;
  const fingerprint = contentFingerprint(recipe);
  if (!local) {
    await putEntry({ recipe, favorite: false, savedAt: remote.updatedAt, cloud: link(uid, remote.version, fingerprint) });
    return;
  }
  if (contentFingerprint(local.recipe) === fingerprint) {
    await putEntry({ ...local, cloud: link(uid, remote.version, fingerprint) });
    return;
  }
  if (isUnmodified(local)) {
    await putEntry({ ...local, recipe, savedAt: remote.updatedAt, cloud: link(uid, remote.version, fingerprint) });
    remoteReplacements.set(recipe);
    return;
  }
  await markConflict(local, uid, recipe, remote.version);
}

/** Push one local recipe. Returns a user-facing problem that stops further uploads, if any. */
async function pushEntry(entry: LibraryEntry, uid: string): Promise<string | null> {
  if (entry.team) return null;
  const l = linkOf(entry);
  if (l?.conflict) return null;
  const fingerprint = contentFingerprint(entry.recipe);
  if (l && l.fingerprint === fingerprint) return null;
  const id = entry.recipe.recipeId;
  try {
    const saved = l
      ? await api<CloudRecipe>('PATCH', `/v1/recipes/${encodeURIComponent(id)}`, { body: { recipe: entry.recipe, baseVersion: l.version } })
      : await api<CloudRecipe>('POST', '/v1/recipes', { body: { recipe: entry.recipe } });
    // Re-read: the user may have saved again during the request. That newer copy stays pending.
    const latest = getEntry(id);
    if (latest) await putEntry({ ...latest, cloud: link(uid, saved.version, fingerprint) });
    return null;
  } catch (error) {
    if (!(error instanceof ApiRequestError)) throw error;
    const current = error.details.current as CloudRecipe | undefined;
    if (error.code === 'version_conflict' || error.code === 'recipe_exists') {
      if (current && !current.deleted && current.recipe && contentFingerprint(current.recipe) === fingerprint) {
        await putEntry({ ...entry, cloud: link(uid, current.version, fingerprint) });
      } else {
        await markConflict(entry, uid, current?.deleted ? null : (current?.recipe ?? null), current?.version ?? 0);
      }
      return null;
    }
    if (error.code === 'recipe_not_found') {
      await markConflict(entry, uid, null, l?.version ?? 0);
      return null;
    }
    if (error.code === 'quota_exceeded' || error.code === 'invalid_recipe' || error.code === 'recipe_too_large') {
      return error.code === 'quota_exceeded' ? error.message : `“${entry.recipe.name}” could not be synced: ${error.message}`;
    }
    throw error;
  }
}

async function run(): Promise<void> {
  const uid = userId();
  if (!uid || !syncEnabled()) return;
  await loadLibrary();
  // Deletions made on this device; the base version keeps newer cloud edits safe.
  const deletes = readJson<PendingDelete[]>(deletesKey(uid), []);
  for (const d of [...deletes]) {
    try {
      await api('DELETE', `/v1/recipes/${encodeURIComponent(d.recipeId)}?baseVersion=${d.version}`);
    } catch (error) {
      // 404: already gone. 409: edited elsewhere since — the pull below brings that copy back.
      if (!(error instanceof ApiRequestError) || ![404, 409].includes(error.status)) throw error;
    }
    deletes.splice(deletes.indexOf(d), 1);
    writeJson(deletesKey(uid), deletes);
  }

  const since = readJson<string | null>(cursorKey(uid), null);
  let cursor: string | null = null;
  let serverTime: string | null = null;
  do {
    const q = new URLSearchParams({ limit: '100' });
    if (since) q.set('since', since);
    if (cursor) q.set('cursor', cursor);
    const page: { recipes: CloudRecipe[]; nextCursor: string | null; serverTime: string } = await api('GET', `/v1/recipes?${q.toString()}`);
    serverTime ??= page.serverTime;
    for (const remote of page.recipes) await applyRemote(remote, uid);
    cursor = page.nextCursor;
  } while (cursor);

  let problem: string | null = null;
  for (const entry of [...getLibraryEntries()]) {
    problem = await pushEntry(entry, uid);
    if (problem) break;
  }
  writeJson(cursorKey(uid), serverTime);
  if (problem) throw new Error(problem);
}

let running: Promise<void> | null = null;
let rerun = false;

/** Sync now (coalesces overlapping requests). Failures leave every local recipe untouched. */
export function syncNow(): Promise<void> {
  if (!syncEnabled()) {
    syncStatus.set({ ...syncStatus.get(), phase: 'off', error: null });
    return Promise.resolve();
  }
  if (running) {
    rerun = true;
    return running;
  }
  syncStatus.set({ ...syncStatus.get(), phase: 'syncing', error: null });
  running = (async () => {
    try {
      do {
        rerun = false;
        await run();
      } while (rerun);
      syncStatus.set({ phase: 'idle', lastSyncedAt: now(), error: null });
      track('sync_status_changed', { status: 'synced', platform: 'web' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      syncStatus.set({ ...syncStatus.get(), phase: syncEnabled() ? 'error' : 'off', error: message });
      track('sync_status_changed', { status: 'sync_error', platform: 'web' });
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer: number | undefined;
function scheduleSync(delay = 1500): void {
  if (!syncEnabled()) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), delay);
}

export function setCloudSync(enabled: boolean): void {
  updateSettings({ cloudSync: enabled });
  if (enabled) void syncNow();
  else syncStatus.set({ phase: 'off', lastSyncedAt: syncStatus.get().lastSyncedAt, error: null });
}

export type ConflictChoice = 'local' | 'cloud' | 'both';

/** Resolve a conflict the way the user chose. "both" keeps the local edits as a separate recipe. */
export async function resolveConflict(recipeId: string, choice: ConflictChoice): Promise<void> {
  const uid = userId();
  const entry = getEntry(recipeId);
  const conflict = entry && linkOf(entry)?.conflict;
  if (!uid || !entry || !conflict) return;
  if (choice === 'local') {
    const saved = conflict.remote
      ? await api<CloudRecipe>('PATCH', `/v1/recipes/${encodeURIComponent(recipeId)}`, { body: { recipe: entry.recipe, baseVersion: conflict.remoteVersion } })
      : await api<CloudRecipe>('POST', '/v1/recipes', { body: { recipe: entry.recipe } });
    await putEntry({ ...entry, cloud: link(uid, saved.version, contentFingerprint(entry.recipe)) });
  } else {
    if (choice === 'both') await saveRecipe(asNewRecipe(entry.recipe, uniqueName(`${entry.recipe.name} (this device)`)));
    if (conflict.remote) {
      await putEntry({ ...entry, recipe: conflict.remote, cloud: link(uid, conflict.remoteVersion, contentFingerprint(conflict.remote)) });
      remoteReplacements.set(conflict.remote);
    } else {
      await removeEntry(recipeId);
    }
  }
  void syncNow();
}

let started = false;

/** Start automatic sync: on sign-in, after saves, when the tab regains focus, and every 5 minutes. */
export function startSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  onLibraryEvent((event) => {
    const uid = userId();
    if (event.type === 'cleared') {
      if (uid) {
        writeJson(cursorKey(uid), null);
        writeJson(deletesKey(uid), null);
      }
      return;
    }
    if (event.type === 'deleted') {
      const l = linkOf(event.entry);
      if (!uid || !l || !syncEnabled() || event.entry.team) return;
      const deletes = readJson<PendingDelete[]>(deletesKey(uid), []);
      writeJson(deletesKey(uid), [...deletes.filter((d) => d.recipeId !== event.entry.recipe.recipeId), { recipeId: event.entry.recipe.recipeId, version: l.conflict ? l.conflict.remoteVersion : l.version }]);
    }
    scheduleSync();
  });
  let lastStatus = account.get().status;
  account.subscribe(() => {
    const status = account.get().status;
    if (status !== lastStatus) {
      lastStatus = status;
      if (status === 'signed-in') scheduleSync(0);
      else syncStatus.set({ phase: 'off', lastSyncedAt: null, error: null });
    }
  });
  let lastFocusSync = 0;
  const onFocus = () => {
    if (Date.now() - lastFocusSync < 30_000) return;
    lastFocusSync = Date.now();
    scheduleSync(0);
  };
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onFocus);
  window.setInterval(() => scheduleSync(0), 5 * 60_000);
  scheduleSync(0);
}

export function useSyncStatus(): SyncStatus {
  return useObservable(syncStatus);
}
