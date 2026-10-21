import { FAMILY_IDS, FAMILY_LABELS, PRESETS, type FamilyId } from '@material-lab/engine';
import { useState } from 'react';
import { useApp } from '../AppContext';
import { AssistantPanel } from '../components/AssistantPanel';
import { Icon } from '../components/Icon';
import { RecipeThumb } from '../components/RecipeThumb';
import { clearDraft, readDraft, type Draft } from '../lib/draft';
import { formatRelative } from '../lib/format';
import { useLibrary } from '../lib/library';
import { routeHref } from '../lib/router';

/** One representative preset per family for the family tiles. */
const FAMILY_SAMPLES: Record<FamilyId, string> = {
  glass: 'glass-aurora-panel',
  grain: 'grain-night-film',
  paper: 'paper-warm-recycled',
  metallic: 'metal-champagne-gold',
  fabric: 'fabric-indigo-twill',
  noise: 'noise-topo-ridges',
  liquid: 'liquid-iridescent',
};

export function WelcomeScreen() {
  const { openBlank, openRecipe, editor } = useApp();
  const library = useLibrary();
  const [draft, setDraft] = useState<Draft | null>(() => readDraft());
  const recent = library.entries.slice(0, 4);
  // Offer the draft only when it is not what is already open.
  const showDraft = draft && editor.recipe?.recipeId !== draft.recipe.recipeId;

  return (
    <div className="page welcome">
      <section className="hero">
        <div className="hero-text">
          <h1>Make textures you can recreate.</h1>
          <p className="lede">
            Build glass, grain, paper, metallic, fabric, noise and liquid textures from editable layers. Save the recipe, make controlled variations, and
            export PNG or JPEG.
          </p>
          <div className="button-row">
            <a className="btn btn-primary btn-large" href={routeHref('explore')}>
              <Icon name="sparkles" />
              Start from a preset
            </a>
            <button type="button" className="btn btn-secondary btn-large" onClick={openBlank}>
              <Icon name="plus" />
              Start blank
            </button>
          </div>
          <p className="muted small">
            <Icon name="lock" size={13} /> No account needed. Textures render in your browser and export straight to your device. Sign in only if you want sync, sharing or teams.
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          {(['glass-aurora-panel', 'paper-warm-recycled', 'metal-brushed-silver'] as const).map((id, i) => {
            const preset = PRESETS.find((p) => p.id === id);
            return preset ? <RecipeThumb key={id} recipe={preset.recipe} width={300} label="" className={`hero-card hero-card-${i}`} /> : null;
          })}
        </div>
      </section>

      {showDraft && draft && (
        <section className="callout callout-info draft-banner" aria-label="Unsaved draft">
          <Icon name="info" />
          <div>
            <p>
              <strong>Unsaved draft found:</strong> “{draft.recipe.name}”{draft.savedAt ? `, last edited ${formatRelative(draft.savedAt)}` : ''}. It
              was not saved before the page closed.
            </p>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => openRecipe(draft.recipe, 'library', draft.persisted, { draft: true })}
            >
              Restore draft
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                clearDraft();
                setDraft(null);
              }}
            >
              Discard
            </button>
          </div>
        </section>
      )}

      <AssistantPanel />

      {editor.recipe && (
        <section className="section">
          <div className="section-head">
            <h2>Continue editing</h2>
          </div>
          <a className="continue-card" href={routeHref('create')}>
            <RecipeThumb recipe={editor.recipe} width={160} label={`Preview of ${editor.recipe.name}`} />
            <span>
              <strong>{editor.recipe.name}</strong>
              <span className="muted">Open in the editor</span>
            </span>
            <Icon name="chevronRight" />
          </a>
        </section>
      )}

      {recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Recent recipes</h2>
            <a href={routeHref('recipes')} className="link">
              All recipes
            </a>
          </div>
          <ul className="card-grid card-grid-4">
            {recent.map((entry) => (
              <li key={entry.recipe.recipeId}>
                <button type="button" className="card card-button" onClick={() => openRecipe(entry.recipe, 'library', true)}>
                  <RecipeThumb recipe={entry.recipe} width={280} label={`Preview of ${entry.recipe.name}`} />
                  <span className="card-body">
                    <span className="card-title">{entry.recipe.name}</span>
                    <span className="card-meta">Saved {formatRelative(entry.savedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Texture families</h2>
          <a href={routeHref('explore')} className="link">
            Browse all presets
          </a>
        </div>
        <ul className="family-grid">
          {FAMILY_IDS.map((family) => {
            const sample = PRESETS.find((p) => p.id === FAMILY_SAMPLES[family]);
            const count = PRESETS.filter((p) => p.family === family).length;
            return (
              <li key={family}>
                <a className="family-tile" href={routeHref('explore', { family })}>
                  {sample && <RecipeThumb recipe={sample.recipe} width={200} label="" />}
                  <span className="family-tile-label">
                    <strong>{FAMILY_LABELS[family]}</strong>
                    <span className="muted">{count} presets</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
