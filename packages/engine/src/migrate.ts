import { SCHEMA_VERSION } from './version';

export type RecipeData = Record<string, unknown>;

/** Upgrades raw recipe data from schema `from` to `from + 1`. */
export interface Migration {
  from: number;
  description: string;
  migrate(data: RecipeData): RecipeData;
}

/**
 * Registered schema migrations, oldest first. Schema 1 is the first public
 * schema, so there is nothing to migrate yet. When the schema changes:
 * bump SCHEMA_VERSION, add a migration from the previous version here, and
 * add a fixture of the old format to the migration tests.
 */
export const MIGRATIONS: readonly Migration[] = [];

export type MigrationResult =
  | { ok: true; data: RecipeData; fromVersion: number; applied: number[] }
  | { ok: false; code: 'missing-schema-version' | 'newer-schema' | 'unsupported-schema'; message: string };

export function migrateRecipeData(
  input: RecipeData,
  migrations: readonly Migration[] = MIGRATIONS,
  targetVersion: number = SCHEMA_VERSION,
): MigrationResult {
  const version = input.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { ok: false, code: 'missing-schema-version', message: 'Recipe has no valid schemaVersion.' };
  }
  if (version > targetVersion) {
    return {
      ok: false,
      code: 'newer-schema',
      message: `Recipe uses schema version ${version}, which is newer than this app supports (${targetVersion}). Update Material Lab to open it.`,
    };
  }
  let data = input;
  const applied: number[] = [];
  for (let v = version; v < targetVersion; v++) {
    const step = migrations.find((m) => m.from === v);
    if (!step) {
      return {
        ok: false,
        code: 'unsupported-schema',
        message: `Recipe schema version ${version} cannot be upgraded to version ${targetVersion}.`,
      };
    }
    data = { ...step.migrate(data), schemaVersion: v + 1 };
    applied.push(v);
  }
  return { ok: true, data, fromVersion: version, applied };
}
