import {
  FAMILY_DESCRIPTIONS,
  FAMILY_IDS,
  FAMILY_LABELS,
  PRESET_PALETTES,
  PRESET_STYLES,
  presetTilesSeamlessly,
  searchPresets,
  type FamilyId,
  type PresetPalette,
  type PresetStyle,
} from '@material-lab/engine';
import { useEffect, useId, useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { RecipeThumb } from '../components/RecipeThumb';
import { track } from '../lib/analytics';
import { navigate, useRoute } from '../lib/router';

export function ExploreScreen() {
  const route = useRoute();
  const { openPreset } = useApp();
  const familyParam = route.params.get('family');
  const family = (FAMILY_IDS as readonly string[]).includes(familyParam ?? '') ? (familyParam as FamilyId) : null;
  const [query, setQuery] = useState(route.params.get('q') ?? '');
  const [style, setStyle] = useState<PresetStyle | null>(null);
  const [palette, setPalette] = useState<PresetPalette | null>(null);
  const [seamless, setSeamless] = useState(false);
  const searchId = useId();

  useEffect(() => {
    track('preset_browser_opened', { platform: 'web' });
  }, []);

  const results = useMemo(() => searchPresets(query, { family, style, palette, seamless }), [query, family, style, palette, seamless]);
  const filtered = family !== null || style !== null || palette !== null || seamless;

  const setFamily = (f: FamilyId | null) => navigate('explore', f ? { family: f } : undefined);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Explore presets</h1>
          <p className="muted">Every preset opens as an editable recipe. The original preset is never changed.</p>
        </div>
      </header>

      <div className="toolbar-row">
        <div className="search-field">
          <Icon name="search" />
          <label htmlFor={searchId} className="sr-only">
            Search presets
          </label>
          <input
            id={searchId}
            type="search"
            className="input"
            placeholder="Search by name, tag or use case — e.g. “subtle UI background”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chips" role="group" aria-label="Filter by texture family">
          <button type="button" className="chip" aria-pressed={family === null} onClick={() => setFamily(null)}>
            All
          </button>
          {FAMILY_IDS.map((f) => (
            <button key={f} type="button" className="chip" aria-pressed={family === f} onClick={() => setFamily(f)}>
              {FAMILY_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-row" role="group" aria-label="More filters">
        <label className="inline-select">
          <span>Style</span>
          <select className="input select compact" value={style ?? ''} onChange={(e) => setStyle((e.target.value || null) as PresetStyle | null)}>
            <option value="">Any</option>
            {PRESET_STYLES.map((v) => (
              <option key={v} value={v}>
                {capitalize(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-select">
          <span>Palette</span>
          <select className="input select compact" value={palette ?? ''} onChange={(e) => setPalette((e.target.value || null) as PresetPalette | null)}>
            <option value="">Any</option>
            {PRESET_PALETTES.map((v) => (
              <option key={v} value={v}>
                {capitalize(v)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="chip" aria-pressed={seamless} onClick={() => setSeamless((v) => !v)} title="Presets that repeat without visible edges">
          <Icon name="grid" size={13} /> Tiles seamlessly
        </button>
        {filtered && (
          <button
            type="button"
            className="link-btn small"
            onClick={() => {
              setStyle(null);
              setPalette(null);
              setSeamless(false);
              setFamily(null);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {family && <p className="family-description">{FAMILY_DESCRIPTIONS[family]}</p>}

      <p className="sr-only" role="status">
        {results.length} {results.length === 1 ? 'preset' : 'presets'} found
      </p>

      {results.length === 0 ? (
        <div className="empty-state">
          <Icon name="search" size={28} />
          <h2>{query ? `No presets match “${query}”` : 'No presets match these filters'}</h2>
          <p className="muted">Try a texture family or a use case such as “card background”.</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setQuery('');
              setStyle(null);
              setPalette(null);
              setSeamless(false);
              setFamily(null);
            }}
          >
            Clear search and filters
          </button>
        </div>
      ) : (
        <ul className="card-grid">
          {results.map((preset) => (
            <li key={preset.id}>
              <button type="button" className="card card-button preset-card" onClick={() => openPreset(preset)} aria-describedby={`${preset.id}-desc`}>
                <RecipeThumb recipe={preset.recipe} width={320} label={`Preview of ${preset.name}`} />
                <span className="card-body">
                  <span className="card-title-row">
                    <span className="card-title">{preset.name}</span>
                    <span className="badge">{FAMILY_LABELS[preset.family]}</span>
                    {preset.status === 'beta' && <span className="badge badge-warning">Beta</span>}
                    {preset.recipe.canvas.transparentBackground && <span className="badge">Transparent</span>}
                    {presetTilesSeamlessly(preset) && <span className="badge" title="Can render as a seamless tile without changes">Tileable</span>}
                  </span>
                  <span className="card-desc" id={`${preset.id}-desc`}>
                    {preset.description}
                    {preset.limitations ? ` Known limitation: ${preset.limitations}` : ''}
                  </span>
                  <span className="card-meta">{preset.useCases.join(' · ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
