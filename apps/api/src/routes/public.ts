import { ENGINE_VERSION, getPreset, PRESETS, presetTilesSeamlessly, SCHEMA_VERSION, type Preset } from '@material-lab/engine';
import { limit, type Services } from '../context';
import { notFound, type Router } from '../http';

function presetMeta(p: Preset) {
  return {
    id: p.id,
    name: p.name,
    family: p.family,
    description: p.description,
    tags: p.tags,
    useCases: p.useCases,
    status: p.status,
    style: p.style,
    palette: p.palette,
    limitations: p.limitations ?? null,
    tileable: presetTilesSeamlessly(p),
    canvas: { width: p.recipe.canvas.width, height: p.recipe.canvas.height, transparentBackground: p.recipe.canvas.transparentBackground },
  };
}

export function registerPublicRoutes(router: Router, s: Services): void {
  const etag = `"presets-${ENGINE_VERSION}"`;
  const cache = { 'Cache-Control': 'public, max-age=3600', ETag: etag };

  router.add('GET', '/healthz', () => ({ body: { ok: true, engineVersion: ENGINE_VERSION, schemaVersion: SCHEMA_VERSION, ai: s.suggester !== null } }), { cors: 'public' });

  /** Versioned preset catalogue (metadata + compatibility). */
  router.add(
    'GET',
    '/v1/presets',
    (req) => {
      limit(s, 'public', req.ip);
      if (req.headers['if-none-match'] === etag) return { status: 304, headers: cache };
      return { body: { engineVersion: ENGINE_VERSION, schemaVersion: SCHEMA_VERSION, presets: PRESETS.map(presetMeta) }, headers: cache };
    },
    { cors: 'public' },
  );

  router.add(
    'GET',
    '/v1/presets/:presetId',
    (req) => {
      limit(s, 'public', req.ip);
      const preset = getPreset(req.params.presetId as string);
      if (!preset) throw notFound('Preset not found.', 'preset_not_found');
      return { body: { ...presetMeta(preset), recipe: preset.recipe }, headers: cache };
    },
    { cors: 'public' },
  );
}
