import { normalizeHex } from './color';
import { getLayerDefinition } from './layers';
import { migrateRecipeData, type RecipeData } from './migrate';
import type { LayerDefinition } from './params';
import { normalizeSeed } from './random';
import {
  BLEND_MODES,
  FAMILY_IDS,
  type BlendMode,
  type ExportFormat,
  type Layer,
  type LayerParameters,
  type Recipe,
  type RecipeFamily,
  type ValidationIssue,
} from './types';
import { ENGINE_VERSION, SCHEMA_VERSION } from './version';

export const RECIPE_LIMITS = {
  /** Layer count is capped to keep previews responsive on typical hardware. */
  maxLayers: 8,
  maxNameLength: 80,
  maxLayerNameLength: 60,
  minCanvasSide: 16,
  maxCanvasSide: 8192,
  maxExportScale: 4,
  /** Maximum size of imported recipe JSON. */
  maxJsonBytes: 256 * 1024,
  maxUnknownParams: 64,
  maxTags: 20,
  maxTagLength: 40,
} as const;

export type ValidationResult =
  | { ok: true; recipe: Recipe; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LAYER_TYPE_RE = /^[a-z0-9-]{1,40}$/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

let idCounter = 0;
/** Create a short unique id with a prefix (not cryptographic). */
export function createId(prefix: string): string {
  idCounter = (idCounter + 1) % 0x10000;
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0x100000).toString(36);
  return `${prefix}_${time}${rand}${idCounter.toString(36)}`;
}

class Issues {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];
  error(path: string, code: string, message: string) {
    this.errors.push({ severity: 'error', path, code, message });
  }
  warn(path: string, code: string, message: string) {
    this.warnings.push({ severity: 'warning', path, code, message });
  }
}

/**
 * Coerce layer parameters to the definition: keep only known parameters,
 * clamp numbers to their range, and fall back to defaults for missing or
 * invalid values.
 */
export function normalizeLayerParameters(
  def: LayerDefinition,
  input: unknown,
  path = 'parameters',
): { parameters: LayerParameters; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const source = isRecord(input) ? input : {};
  const parameters: LayerParameters = {};
  for (const p of def.params) {
    const has = Object.prototype.hasOwnProperty.call(source, p.id);
    const raw = has ? source[p.id] : undefined;
    const at = `${path}.${p.id}`;
    switch (p.kind) {
      case 'number': {
        if (isFiniteNumber(raw)) {
          let v = Math.min(p.max, Math.max(p.min, raw));
          if (p.integer) v = Math.round(v);
          if (v !== raw) {
            issues.push({
              severity: 'warning',
              path: at,
              code: 'out-of-range',
              message: `${p.label} must be between ${p.min} and ${p.max}; adjusted to ${v}.`,
            });
          }
          parameters[p.id] = v;
        } else {
          if (has) issues.push({ severity: 'warning', path: at, code: 'invalid-value', message: `${p.label} is not a number; reset to default.` });
          parameters[p.id] = p.default;
        }
        break;
      }
      case 'color': {
        const hex = typeof raw === 'string' ? normalizeHex(raw) : null;
        if (!hex && has) issues.push({ severity: 'warning', path: at, code: 'invalid-value', message: `${p.label} is not a hex color; reset to default.` });
        parameters[p.id] = hex ?? p.default;
        break;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') parameters[p.id] = raw;
        else {
          if (has) issues.push({ severity: 'warning', path: at, code: 'invalid-value', message: `${p.label} must be true or false; reset to default.` });
          parameters[p.id] = p.default;
        }
        break;
      }
      case 'select': {
        if (typeof raw === 'string' && p.options.some((o) => o.value === raw)) parameters[p.id] = raw;
        else {
          if (has) issues.push({ severity: 'warning', path: at, code: 'invalid-value', message: `${p.label} has an unknown option; reset to default.` });
          parameters[p.id] = p.default;
        }
        break;
      }
    }
  }
  const unknown = Object.keys(source).filter((k) => !def.params.some((p) => p.id === k));
  if (unknown.length > 0) {
    issues.push({
      severity: 'warning',
      path,
      code: 'unknown-parameters',
      message: `Ignored unknown parameter${unknown.length > 1 ? 's' : ''}: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}.`,
    });
  }
  return { parameters, issues };
}

/** Keep only primitive values for layers of an unknown type, so they round-trip safely. */
function sanitizeUnknownParameters(input: unknown, path: string, issues: Issues): LayerParameters {
  const out: LayerParameters = {};
  if (!isRecord(input)) return out;
  let count = 0;
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(key) || key.length > 64) continue;
    const v = input[key];
    if (isFiniteNumber(v) || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200)) {
      if (count >= RECIPE_LIMITS.maxUnknownParams) {
        issues.warn(path, 'too-many-parameters', 'Some parameters of an unsupported layer were dropped.');
        break;
      }
      out[key] = v;
      count++;
    }
  }
  return out;
}

function cleanName(raw: unknown, fallback: string, max: number, path: string, issues: Issues): string {
  if (typeof raw !== 'string') {
    if (raw !== undefined) issues.warn(path, 'invalid-value', 'Name must be text; a default name was used.');
    return fallback;
  }
  // Strip control characters and collapse whitespace.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) {
    issues.warn(path, 'empty-name', 'Name was empty; a default name was used.');
    return fallback;
  }
  if (cleaned.length > max) {
    issues.warn(path, 'name-too-long', `Name was shortened to ${max} characters.`);
    return cleaned.slice(0, max).trim();
  }
  return cleaned;
}

function clampSide(raw: unknown, fallback: number, path: string, issues: Issues, required: boolean): number {
  if (!isFiniteNumber(raw)) {
    if (required) issues.error(path, 'invalid-dimension', 'Dimension must be a number.');
    else if (raw !== undefined) issues.warn(path, 'invalid-dimension', 'Dimension was invalid; default used.');
    return fallback;
  }
  const v = Math.round(Math.min(RECIPE_LIMITS.maxCanvasSide, Math.max(RECIPE_LIMITS.minCanvasSide, raw)));
  if (v !== raw) {
    issues.warn(path, 'out-of-range', `Dimension must be a whole number between ${RECIPE_LIMITS.minCanvasSide} and ${RECIPE_LIMITS.maxCanvasSide}; adjusted to ${v}.`);
  }
  return v;
}

function validDate(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.length <= 40 && !Number.isNaN(Date.parse(raw))) return raw;
  return fallback;
}

/**
 * Validate, migrate and normalize untrusted recipe data. Unknown fields are
 * dropped, values are clamped to their ranges, and nothing in the input is
 * ever executed. Structural problems are errors; recoverable ones are
 * warnings and the normalized recipe is returned.
 */
export function validateRecipe(input: unknown): ValidationResult {
  const issues = new Issues();
  if (!isRecord(input)) {
    issues.error('', 'not-an-object', 'Recipe must be a JSON object.');
    return { ok: false, errors: issues.errors, warnings: issues.warnings };
  }
  const migrated = migrateRecipeData(input as RecipeData);
  if (!migrated.ok) {
    issues.error('schemaVersion', migrated.code, migrated.message);
    return { ok: false, errors: issues.errors, warnings: issues.warnings };
  }
  if (migrated.applied.length > 0) {
    issues.warn('schemaVersion', 'migrated', `Recipe was upgraded from schema version ${migrated.fromVersion} to ${SCHEMA_VERSION}.`);
  }
  const data = migrated.data;
  const now = new Date().toISOString();

  // Identity and naming.
  let recipeId = data.recipeId;
  if (typeof recipeId !== 'string' || !ID_RE.test(recipeId)) {
    if (recipeId !== undefined) issues.warn('recipeId', 'invalid-id', 'Recipe id was invalid; a new id was assigned.');
    recipeId = createId('recipe');
  }
  const name = cleanName(data.name, 'Untitled texture', RECIPE_LIMITS.maxNameLength, 'name', issues);

  let family: RecipeFamily = 'custom';
  if (typeof data.family === 'string' && ((FAMILY_IDS as readonly string[]).includes(data.family) || data.family === 'custom')) {
    family = data.family as RecipeFamily;
  } else if (data.family !== undefined) {
    issues.warn('family', 'unknown-family', 'Unknown texture family; recipe marked as custom.');
  }

  let engineVersion = ENGINE_VERSION;
  if (typeof data.engineVersion === 'string' && SEMVER_RE.test(data.engineVersion)) {
    engineVersion = data.engineVersion;
    const major = data.engineVersion.split('.')[0];
    if (major !== ENGINE_VERSION.split('.')[0]) {
      issues.warn(
        'engineVersion',
        'engine-version-mismatch',
        `Recipe was made with engine ${data.engineVersion}; this app renders with ${ENGINE_VERSION}, so output may differ.`,
      );
    }
  } else if (data.engineVersion !== undefined) {
    issues.warn('engineVersion', 'invalid-value', 'Engine version was invalid; current engine version recorded.');
  }

  // Seed is required for reproducibility.
  let seed = 0;
  if (isFiniteNumber(data.seed)) {
    seed = normalizeSeed(data.seed);
    if (seed !== data.seed) issues.warn('seed', 'out-of-range', `Seed was normalized to ${seed}.`);
  } else {
    issues.error('seed', 'invalid-seed', 'Recipe must include a numeric seed.');
  }

  // Canvas.
  const canvasIn = isRecord(data.canvas) ? data.canvas : null;
  if (!canvasIn) issues.error('canvas', 'missing-canvas', 'Recipe must include canvas dimensions.');
  const canvas = {
    width: clampSide(canvasIn?.width, 1600, 'canvas.width', issues, canvasIn !== null),
    height: clampSide(canvasIn?.height, 1000, 'canvas.height', issues, canvasIn !== null),
    colorSpace: 'sRGB' as const,
    transparentBackground: canvasIn?.transparentBackground === true,
  };
  if (canvasIn && canvasIn.colorSpace !== undefined && canvasIn.colorSpace !== 'sRGB') {
    issues.warn('canvas.colorSpace', 'unsupported-color-space', 'Only sRGB is supported; color space set to sRGB.');
  }

  // Layers.
  const layers: Layer[] = [];
  if (!Array.isArray(data.layers)) {
    issues.error('layers', 'missing-layers', 'Recipe must include a list of layers.');
  } else if (data.layers.length > RECIPE_LIMITS.maxLayers) {
    issues.error('layers', 'too-many-layers', `Recipes can have at most ${RECIPE_LIMITS.maxLayers} layers (found ${data.layers.length}).`);
  } else {
    const seenIds = new Set<string>();
    data.layers.forEach((raw: unknown, index: number) => {
      const path = `layers[${index}]`;
      if (!isRecord(raw)) {
        issues.error(path, 'invalid-layer', 'Layer must be an object.');
        return;
      }
      const type = raw.type;
      if (typeof type !== 'string' || !LAYER_TYPE_RE.test(type)) {
        issues.error(`${path}.type`, 'invalid-layer-type', 'Layer type is missing or invalid.');
        return;
      }
      const def = getLayerDefinition(type);
      if (!def) {
        issues.warn(`${path}.type`, 'unsupported-layer', `Layer type "${type}" is not supported by this version; it will be skipped when rendering.`);
      }
      let id = raw.id;
      if (typeof id !== 'string' || !ID_RE.test(id) || seenIds.has(id)) {
        if (id !== undefined) issues.warn(`${path}.id`, 'invalid-id', 'Layer id was invalid or duplicated; a new id was assigned.');
        id = createId('layer');
      }
      seenIds.add(id as string);
      const layerName = cleanName(raw.name, def?.label ?? type, RECIPE_LIMITS.maxLayerNameLength, `${path}.name`, issues);

      let opacity = 1;
      if (isFiniteNumber(raw.opacity)) {
        opacity = Math.min(1, Math.max(0, raw.opacity));
        if (opacity !== raw.opacity) issues.warn(`${path}.opacity`, 'out-of-range', 'Opacity must be between 0 and 1.');
      } else if (raw.opacity !== undefined) {
        issues.warn(`${path}.opacity`, 'invalid-value', 'Opacity was invalid; set to 100%.');
      }

      let blendMode: BlendMode = def?.defaultBlendMode ?? 'normal';
      if (typeof raw.blendMode === 'string' && (BLEND_MODES as readonly string[]).includes(raw.blendMode)) {
        blendMode = raw.blendMode as BlendMode;
      } else if (raw.blendMode !== undefined) {
        issues.warn(`${path}.blendMode`, 'invalid-value', 'Unsupported blend mode; layer default used.');
      }

      let seedOffset: number;
      if (isFiniteNumber(raw.seedOffset) && Number.isInteger(raw.seedOffset)) {
        seedOffset = raw.seedOffset;
      } else {
        // Assign an explicit offset so the recipe stays reproducible from here on.
        seedOffset = (index + 1) * 17;
        if (def?.params.length) issues.warn(`${path}.seedOffset`, 'missing-seed-offset', `Layer had no seed offset; ${seedOffset} was assigned.`);
      }

      let parameters: LayerParameters;
      if (def) {
        const res = normalizeLayerParameters(def, raw.parameters, `${path}.parameters`);
        parameters = res.parameters;
        issues.warnings.push(...res.issues);
      } else {
        parameters = sanitizeUnknownParameters(raw.parameters, `${path}.parameters`, issues);
      }

      layers.push({
        id: id as string,
        type,
        name: layerName,
        enabled: raw.enabled !== false,
        opacity,
        blendMode,
        seedOffset,
        parameters,
      });
    });
  }

  // Export defaults.
  const exIn = isRecord(data.exportDefaults) ? data.exportDefaults : {};
  const format: ExportFormat = exIn.format === 'jpeg' ? 'jpeg' : 'png';
  if (exIn.format !== undefined && exIn.format !== 'png' && exIn.format !== 'jpeg') {
    issues.warn('exportDefaults.format', 'invalid-value', 'Unsupported export format; PNG used.');
  }
  let scale = 1;
  if (isFiniteNumber(exIn.scale)) scale = Math.min(RECIPE_LIMITS.maxExportScale, Math.max(1, Math.round(exIn.scale)));
  const exportDefaults = {
    format,
    width: clampSide(exIn.width, canvas.width, 'exportDefaults.width', issues, false),
    height: clampSide(exIn.height, canvas.height, 'exportDefaults.height', issues, false),
    scale,
    seamless: exIn.seamless === true,
  };

  // Metadata.
  const metaIn = isRecord(data.metadata) ? data.metadata : {};
  const metadata: Recipe['metadata'] = {
    createdAt: validDate(metaIn.createdAt, now),
    updatedAt: validDate(metaIn.updatedAt, now),
  };
  if (typeof metaIn.presetId === 'string' && ID_RE.test(metaIn.presetId)) metadata.presetId = metaIn.presetId;
  if (Array.isArray(metaIn.tags)) {
    metadata.tags = metaIn.tags
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim().slice(0, RECIPE_LIMITS.maxTagLength))
      .filter((t) => t.length > 0)
      .slice(0, RECIPE_LIMITS.maxTags);
  }

  if (issues.errors.length > 0) return { ok: false, errors: issues.errors, warnings: issues.warnings };
  return {
    ok: true,
    warnings: issues.warnings,
    recipe: {
      schemaVersion: SCHEMA_VERSION,
      recipeId: recipeId as string,
      name,
      family,
      engineVersion,
      seed,
      canvas,
      layers,
      exportDefaults,
      metadata,
    },
  };
}

/** Parse and validate recipe JSON text from an untrusted source (file import, paste). */
export function parseRecipeJson(text: string): ValidationResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > RECIPE_LIMITS.maxJsonBytes) {
    return {
      ok: false,
      warnings: [],
      errors: [
        {
          severity: 'error',
          path: '',
          code: 'too-large',
          message: `Recipe file is ${Math.ceil(bytes / 1024)} KB; the limit is ${RECIPE_LIMITS.maxJsonBytes / 1024} KB.`,
        },
      ],
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      warnings: [],
      errors: [{ severity: 'error', path: '', code: 'invalid-json', message: 'File is not valid JSON.' }],
    };
  }
  return validateRecipe(data);
}
