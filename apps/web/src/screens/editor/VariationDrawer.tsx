import {
  createRandom,
  formatParamValue,
  generateVariations,
  getLayerDefinition,
  randomSeed,
  VARIATION_COUNTS,
  VARIATION_DIMENSIONS,
  type ParameterChange,
  type Recipe,
  type VariationCandidate,
  type VariationDimension,
} from '@material-lab/engine';
import { useMemo, useState } from 'react';
import { useApp } from '../../AppContext';
import { NumberField, Segmented } from '../../components/fields';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { RecipeThumb } from '../../components/RecipeThumb';
import { useToast } from '../../components/Toasts';
import { track } from '../../lib/analytics';

interface VariationDrawerProps {
  recipe: Recipe;
  onClose: () => void;
}

const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
// Fewer candidates on low-core devices keeps generation responsive.
const MAX_COUNT = cores <= 2 ? 4 : cores <= 4 ? 8 : 12;

export function VariationDrawer({ recipe, onClose }: VariationDrawerProps) {
  const { editor, edit, save, saveAsCopy } = useApp();
  const toast = useToast();
  const [count, setCount] = useState<number>(Math.min(8, MAX_COUNT));
  const [dimensions, setDimensions] = useState<VariationDimension[]>(['seed']);
  const [strength, setStrength] = useState(0.4);
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [batch, setBatch] = useState<{ source: Recipe; candidates: VariationCandidate[] } | null>(null);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [comparing, setComparing] = useState<VariationCandidate | null>(null);

  const selectedLayer = editor.selection !== 'canvas' ? recipe.layers.find((l) => l.id === editor.selection) : undefined;

  // Only offer dimensions that some layer of this recipe can actually vary.
  const available = useMemo(() => {
    const groups = new Set<VariationDimension>(['seed']);
    for (const layer of recipe.layers) {
      if (layer.enabled && recipe.layers.length > 0) groups.add('intensity');
      for (const p of getLayerDefinition(layer.type)?.params ?? []) if (p.variation) groups.add(p.variation);
    }
    return groups;
  }, [recipe.layers]);

  const toggleDimension = (d: VariationDimension) =>
    setDimensions((all) => (all.includes(d) ? all.filter((x) => x !== d) : [...all, d]));

  const generate = () => {
    const variationSeed = randomSeed(createRandom(Date.now() >>> 0));
    const candidates = generateVariations(recipe, {
      count,
      dimensions,
      strength,
      layerIds: scope === 'selected' && selectedLayer ? [selectedLayer.id] : undefined,
      variationSeed,
    });
    setFailed(new Set());
    setBatch({ source: recipe, candidates });
    track('variation_generation_started', { candidate_count: count, allowed_dimension_count: dimensions.length });
  };

  const apply = (candidate: VariationCandidate) => {
    edit(() => ({ ...candidate.recipe, name: recipe.name, recipeId: recipe.recipeId, metadata: recipe.metadata }));
    track('variation_selected', { family_id: recipe.family, candidate_index: candidate.index });
    setComparing(null);
    onClose();
    toast.show('Variation applied. The original is one undo away.', {
      actions: [
        { label: 'Save as new recipe', onClick: saveAsCopy },
        { label: 'Save', onClick: () => void save() },
      ],
      duration: 10000,
    });
  };

  const stale = batch !== null && batch.source !== recipe;

  return (
    <section className="variation-drawer" aria-label="Create variations">
      <div className="drawer-head">
        <h2 className="panel-title">
          <Icon name="sparkles" />
          Create variations
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close variations">
          <Icon name="close" />
        </button>
      </div>
      <div className="drawer-body">
        <div className="drawer-config">
          <Segmented
            label="Candidates"
            value={count}
            options={VARIATION_COUNTS.map((c) => ({
              value: c as number,
              label: String(c),
              disabled: c > MAX_COUNT,
              title: c > MAX_COUNT ? 'Limited on this device to keep rendering responsive' : undefined,
            }))}
            onChange={setCount}
          />
          <fieldset className="field">
            <legend className="field-label">What may change</legend>
            {VARIATION_DIMENSIONS.map((d) => (
              <label key={d.id} className={`check-row${available.has(d.id) ? '' : ' disabled'}`}>
                <input
                  type="checkbox"
                  checked={dimensions.includes(d.id)}
                  disabled={!available.has(d.id)}
                  onChange={() => toggleDimension(d.id)}
                />
                <span>
                  <strong>{d.label}</strong>
                  <span className="muted"> — {d.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <NumberField label="Range" value={strength} min={0.05} max={1} step={0.05} unit="%" help="How far changed settings may move from their current values." onChange={setStrength} />
          {selectedLayer && (
            <Segmented
              label="Apply to"
              value={scope}
              options={[
                { value: 'all', label: 'All layers' },
                { value: 'selected', label: `“${selectedLayer.name}” only` },
              ]}
              onChange={setScope}
            />
          )}
          <button type="button" className="btn btn-primary" onClick={generate} disabled={dimensions.length === 0}>
            <Icon name="sparkles" />
            {batch ? 'Generate again' : 'Generate'}
          </button>
          {dimensions.length === 0 && <p className="field-error">Choose at least one thing that may change.</p>}
        </div>

        <div className="drawer-results">
          {!batch ? (
            <div className="empty-state compact">
              <p>Choose what may change, then generate. Each candidate lists exactly what differs from your recipe; nothing else is touched.</p>
            </div>
          ) : (
            <>
              {stale && (
                <p className="callout callout-info compact">
                  <Icon name="info" />
                  The recipe changed since these were generated. Applying a candidate replaces your latest edits (you can undo).
                </p>
              )}
              {failed.size > 0 && (
                <p className="callout callout-warning compact" role="status">
                  <Icon name="warning" />
                  {failed.size} of {batch.candidates.length} candidates could not be rendered. The others are still usable.
                </p>
              )}
              <ul className="candidate-grid">
                {batch.candidates.map((c) => (
                  <li key={c.index} className="candidate">
                    <RecipeThumb
                      recipe={c.recipe}
                      width={220}
                      label={`Variation ${c.index + 1}`}
                      onError={() => setFailed((s) => new Set(s).add(c.index))}
                    />
                    <div className="candidate-body">
                      <span className="candidate-title">
                        #{c.index + 1} · seed {c.seed}
                      </span>
                      <span className="candidate-summary" title={c.summary}>
                        {c.changes.length === 0 ? 'No changes' : `${c.changes.length} change${c.changes.length > 1 ? 's' : ''}: ${c.summary}`}
                      </span>
                      <div className="button-row">
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => setComparing(c)}>
                          <Icon name="compare" />
                          Compare
                        </button>
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => apply(c)}>
                          Use this
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {comparing && batch && (
        <Modal
          open
          size="large"
          title={`Compare variation #${comparing.index + 1}`}
          onClose={() => setComparing(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setComparing(null)}>
                Keep original
              </button>
              <button type="button" className="btn btn-primary" onClick={() => apply(comparing)}>
                Use this variation
              </button>
            </>
          }
        >
          <div className="compare-grid">
            <figure>
              <RecipeThumb recipe={batch.source} width={420} label="Original recipe" />
              <figcaption>Original · seed {batch.source.seed}</figcaption>
            </figure>
            <figure>
              <RecipeThumb recipe={comparing.recipe} width={420} label={`Variation ${comparing.index + 1}`} />
              <figcaption>Variation #{comparing.index + 1} · seed {comparing.seed}</figcaption>
            </figure>
          </div>
          <h3 className="prop-section-title">Changes</h3>
          {comparing.changes.length === 0 ? (
            <p className="muted">No settings differ for the chosen dimensions.</p>
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th scope="col">Layer</th>
                  <th scope="col">Setting</th>
                  <th scope="col">Original</th>
                  <th scope="col">Variation</th>
                </tr>
              </thead>
              <tbody>
                {comparing.changes.map((ch) => (
                  <tr key={`${ch.layerId}.${ch.paramId}`}>
                    <td>{ch.layerName}</td>
                    <td>{ch.label}</td>
                    <td>
                      <ValueCell recipe={batch.source} change={ch} value={ch.from} />
                    </td>
                    <td>
                      <ValueCell recipe={batch.source} change={ch} value={ch.to} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </section>
  );
}

function ValueCell({ recipe, change, value }: { recipe: Recipe; change: ParameterChange; value: string | number | boolean }) {
  if (typeof value === 'string' && /^#[0-9A-F]{6}$/i.test(value)) {
    return (
      <span className="value-color">
        <span className="color-dot" style={{ background: value }} aria-hidden="true" />
        {value}
      </span>
    );
  }
  if (change.paramId === 'opacity' && typeof value === 'number') return <>{Math.round(value * 100)}%</>;
  const layer = recipe.layers.find((l) => l.id === change.layerId);
  const def = layer ? getLayerDefinition(layer.type)?.params.find((p) => p.id === change.paramId) : undefined;
  return <>{formatParamValue(def ?? null, value)}</>;
}
