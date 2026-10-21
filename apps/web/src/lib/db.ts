/**
 * Minimal promise wrapper around IndexedDB. Falls back to an in-memory store
 * when IndexedDB is unavailable (private browsing in some browsers), so the
 * app keeps working; data then lasts only for the session.
 */

const DB_NAME = 'material-lab';
const DB_VERSION = 2;
export const STORES = ['recipes', 'exports', 'versions'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory: Record<StoreName, Map<string, unknown>> = { recipes: new Map(), exports: new Map(), versions: new Map() };

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Let a newer version in another tab upgrade the database.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => resolve(null);
    // An older tab is holding the database open; it closes itself on
    // `versionchange`, but fall back to memory if it does not.
    request.onblocked = () => setTimeout(() => resolve(null), 3000);
  });
  return dbPromise;
}

/** Whether data persists across sessions on this device. */
export async function isPersistent(): Promise<boolean> {
  return (await openDb()) !== null;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Storage request failed'));
  });
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory[store].get(key) as T | undefined;
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function dbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  if (!db) return [...memory[store].values()] as T[];
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}

/** All values whose key starts with `prefix` (keys are strings). */
export async function dbGetByPrefix<T>(store: StoreName, prefix: string): Promise<{ key: string; value: T }[]> {
  const db = await openDb();
  if (!db) {
    return [...memory[store].entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value: value as T }));
  }
  const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
  const os = db.transaction(store, 'readonly').objectStore(store);
  const [keys, values] = await Promise.all([wrap(os.getAllKeys(range)), wrap(os.getAll(range))]);
  return keys.map((key, i) => ({ key: String(key), value: values[i] as T }));
}

export async function dbPut<T>(store: StoreName, key: string, value: T): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory[store].set(key, structuredClone(value));
    return;
  }
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Storage write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Storage write was aborted (storage may be full)'));
  });
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory[store].delete(key);
    return;
  }
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Storage delete failed'));
  });
}

export async function dbClear(store: StoreName): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory[store].clear();
    return;
  }
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Storage clear failed'));
  });
}
