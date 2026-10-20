import type { ExportSettings, Recipe } from '@material-lab/engine';
import { dbClear, dbDelete, dbGetAll, dbPut } from './db';
import { Observable, useObservable } from './store';

/** Metadata about an export kept on this device (never the image itself). */
export interface ExportRecord {
  id: string;
  createdAt: string;
  status: 'success' | 'failed';
  filename: string;
  format: ExportSettings['format'];
  /** Output size in pixels. */
  width: number;
  height: number;
  scale: number;
  fileSize?: number;
  durationMs?: number;
  error?: string;
  recipeId: string;
  recipeName: string;
  seed: number;
  engineVersion: string;
  /** Snapshot so the export can be retried or recreated later. */
  recipe: Recipe;
  settings: ExportSettings;
}

const MAX_RECORDS = 50;
const records = new Observable<ExportRecord[] | null>(null);
let loading: Promise<void> | null = null;

export function loadExportLog(): Promise<void> {
  if (!loading) {
    loading = dbGetAll<ExportRecord>('exports').then(
      (all) => records.set(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      () => records.set([]),
    );
  }
  return loading;
}

export function useExportLog(): ExportRecord[] | null {
  return useObservable(records);
}

export async function addExportRecord(record: ExportRecord): Promise<void> {
  await loadExportLog();
  const all = [record, ...(records.get() ?? [])];
  const keep = all.slice(0, MAX_RECORDS);
  records.set(keep);
  try {
    await dbPut('exports', record.id, record);
    for (const old of all.slice(MAX_RECORDS)) await dbDelete('exports', old.id);
  } catch {
    // The export itself succeeded or failed independently; losing the log entry is not fatal.
  }
}

export async function removeExportRecord(id: string): Promise<void> {
  records.set((records.get() ?? []).filter((r) => r.id !== id));
  await dbDelete('exports', id);
}

export async function clearExportLog(): Promise<void> {
  records.set([]);
  await dbClear('exports');
}
