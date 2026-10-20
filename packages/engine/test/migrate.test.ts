import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrateRecipeData, SCHEMA_VERSION, type Migration } from '../src';

describe('schema migrations', () => {
  it('has a migration for every schema version below the current one', () => {
    for (let v = 1; v < SCHEMA_VERSION; v++) {
      expect(MIGRATIONS.some((m) => m.from === v), `missing migration from v${v}`).toBe(true);
    }
  });

  it('passes current-version data through untouched', () => {
    const data = { schemaVersion: SCHEMA_VERSION, name: 'x' };
    const r = migrateRecipeData(data);
    expect(r).toEqual({ ok: true, data, fromVersion: SCHEMA_VERSION, applied: [] });
  });

  it('applies migrations in order and stamps the new version', () => {
    // Simulates a future schema v3 with two upgrade steps.
    const steps: Migration[] = [
      { from: 2, description: 'rename blend → blendMode', migrate: (d) => ({ ...d, layers: (d.layers as Record<string, unknown>[]).map(({ blend, ...l }) => ({ ...l, blendMode: blend })) }) },
      { from: 1, description: 'add family', migrate: (d) => ({ ...d, family: d.family ?? 'custom' }) },
    ];
    const r = migrateRecipeData({ schemaVersion: 1, layers: [{ id: 'a', blend: 'multiply' }] }, steps, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.applied).toEqual([1, 2]);
    expect(r.data).toEqual({ schemaVersion: 3, family: 'custom', layers: [{ id: 'a', blendMode: 'multiply' }] });
  });

  it('reports gaps, missing and newer versions', () => {
    expect(migrateRecipeData({ schemaVersion: 1 }, [], 2)).toMatchObject({ ok: false, code: 'unsupported-schema' });
    expect(migrateRecipeData({})).toMatchObject({ ok: false, code: 'missing-schema-version' });
    expect(migrateRecipeData({ schemaVersion: SCHEMA_VERSION + 1 })).toMatchObject({ ok: false, code: 'newer-schema' });
  });
});
