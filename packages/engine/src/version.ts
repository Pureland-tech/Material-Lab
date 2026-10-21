/**
 * Version of the rendering algorithms. Bump whenever a change alters rendered
 * pixels for an existing recipe (and regenerate the golden hashes), so saved
 * recipes record which engine produced their output.
 */
export const ENGINE_VERSION = '1.1.0';

/** Version of the recipe JSON structure. Bump with a migration in migrate.ts. */
export const SCHEMA_VERSION = 1;
