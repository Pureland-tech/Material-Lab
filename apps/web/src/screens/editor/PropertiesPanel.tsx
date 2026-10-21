import {
  analyzeSeamless,
  BLEND_MODES,
  DIMENSION_PRESETS,
  ENGINE_VERSION,
  FAMILY_LABELS,
  fixSeamlessSeams,
  getLayerDefinition,
  isSeamless,
  isParamVisible,
  MAX_SEED,
  PARAM_SECTION_LABELS,
  PARAM_SECTIONS,
  RECIPE_LIMITS,
  type BlendMode,
  type Layer,
  type LayerDefinition,
  type ParamDef,
  type Recipe,
  setSeamless,
} from '@material-lab/engine';
import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { ColorField, NumberField, SelectField, Toggle } from '../../components/fields';
import { Icon } from '../../components/Icon';
import { track } from '../../lib/analytics';
import {
  removeLayer,
  resetLayer,
  resetParam,
  setCanvasSize,
  setLayerBlend,
  setLayerOpacity,
  setLayerSeedOffset,
  setName,
  setParam,
  setSeed,
  setTransparentBackground,
} from '../../editor/ops';
import { LayerSwatch } from './LayerSwatch';
import { RecolorSection } from './RecolorSection';

const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  'soft-light': 'Soft light',
};

/** Report parameter edits at most once per parameter every few seconds (slider drags fire constantly). */
const lastTracked = new Map<string, number>();
function trackParam(family: string, paramId: string, inputType: string) {
  const key = `${family}.${paramId}`;
  const now = performance.now();
  if (now - (lastTracked.get(key) ?? -Infinity) < 3000) return;
  lastTracked.set(key, now);
  track('parameter_changed', { family_id: family, parameter_id: paramId, input_type: inputType });
}

export function PropertiesPanel({ recipe }: { recipe: Recipe }) {
  const { editor } = useApp();
  const layer = editor.selection === 'canvas' ? undefined : recipe.layers.find((l) => l.id === editor.selection);
  return (
    <aside className="panel properties-panel" aria-label="Properties">
      {layer ? <LayerProperties key={layer.id} recipe={recipe} layer={layer} /> : <CanvasProperties recipe={recipe} />}
    </aside>
  );
}

function LayerProperties({ recipe, layer }: { recipe: Recipe; layer: Layer }) {
  const { edit } = useApp();
  const def = getLayerDefinition(layer.type);

  if (!def) {
    return (
      <>
        <div className="panel-head">
          <h2 className="panel-title">{layer.name}</h2>
        </div>
        <div className="panel-scroll">
          <div className="callout callout-warning">
            <Icon name="warning" />
            <p>
              This layer uses the type “{layer.type}”, which this version of Material Lab does not support. It is kept in the recipe so nothing is lost,
              but it is skipped when rendering.
            </p>
          </div>
          <button type="button" className="btn btn-danger-ghost" onClick={() => edit((r) => removeLayer(r, layer.id))}>
            <Icon name="trash" />
            Remove layer
          </button>
        </div>
      </>
    );
  }

  const family = def.family ?? 'base';
  const visible = def.params.filter((p) => isParamVisible(p, layer.parameters));
  const isCustomized = def.params.some((p) => layer.parameters[p.id] !== p.default) || layer.opacity !== def.defaultOpacity || layer.blendMode !== def.defaultBlendMode;

  return (
    <>
      <div className="panel-head">
        <LayerSwatch type={layer.type} />
        <div className="panel-title-stack">
          <h2 className="panel-title">{layer.name}</h2>
          <span className="muted small">
            {def.label} layer{def.family ? ` · ${FAMILY_LABELS[def.family]} family` : ''}
          </span>
        </div>
      </div>
      <div className="panel-scroll">
        {(def.note || def.backgroundDependent) && (
          <div className="callout callout-info compact">
            <Icon name="info" />
            <p>{def.note}</p>
          </div>
        )}

        <section className="prop-section" aria-labelledby={`sec-layer-${layer.id}`}>
          <h3 id={`sec-layer-${layer.id}`} className="prop-section-title">
            Layer
          </h3>
          <NumberField
            label="Opacity"
            value={layer.opacity}
            min={0}
            max={1}
            step={0.01}
            unit="%"
            onChange={(v) => {
              edit((r) => setLayerOpacity(r, layer.id, v), { coalesceKey: `${layer.id}.opacity` });
              trackParam(family, 'opacity', 'slider');
            }}
            onReset={layer.opacity !== def.defaultOpacity ? () => edit((r) => setLayerOpacity(r, layer.id, def.defaultOpacity)) : undefined}
          />
          <SelectField
            label="Blend mode"
            value={layer.blendMode}
            options={BLEND_MODES.map((m) => ({ value: m, label: BLEND_LABELS[m] }))}
            help="How this layer combines with the layers beneath it. Overlay and soft light suit grain and noise."
            onChange={(v) => edit((r) => setLayerBlend(r, layer.id, v as BlendMode))}
            onReset={layer.blendMode !== def.defaultBlendMode ? () => edit((r) => setLayerBlend(r, layer.id, def.defaultBlendMode)) : undefined}
          />
        </section>

        {PARAM_SECTIONS.filter((s) => s !== 'advanced').map((section) => {
          const params = visible.filter((p) => p.section === section);
          if (params.length === 0) return null;
          return (
            <section key={section} className="prop-section" aria-labelledby={`sec-${section}-${layer.id}`}>
              <h3 id={`sec-${section}-${layer.id}`} className="prop-section-title">
                {PARAM_SECTION_LABELS[section]}
              </h3>
              {params.map((p) => (
                <ParamControl key={p.id} def={def} param={p} layer={layer} />
              ))}
            </section>
          );
        })}

        <details className="prop-section advanced">
          <summary className="prop-section-title">
            <Icon name="chevronRight" className="disclosure" />
            Advanced
          </summary>
          {visible
            .filter((p) => p.section === 'advanced')
            .map((p) => (
              <ParamControl key={p.id} def={def} param={p} layer={layer} />
            ))}
          <NumberField
            label="Seed offset"
            value={layer.seedOffset}
            min={-999999}
            max={999999}
            step={1}
            integer
            noSlider
            help="Combined with the recipe seed to give this layer its own random structure. Duplicated layers share an offset, so they look identical until you change it."
            onChange={(v) => edit((r) => setLayerSeedOffset(r, layer.id, v))}
          />
        </details>

        <div className="panel-actions">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={!isCustomized}
            onClick={() => {
              edit((r) => resetLayer(r, layer.id));
              track('layer_operation', { operation: 'reset', layer_count: recipe.layers.length });
            }}
          >
            <Icon name="reset" />
            Reset layer to defaults
          </button>
        </div>
      </div>
    </>
  );
}

function ParamControl({ def, param, layer }: { def: LayerDefinition; param: ParamDef; layer: Layer }) {
  const { edit } = useApp();
  const value = layer.parameters[param.id];
  const family = def.family ?? 'base';
  const isDefault = value === param.default;
  const onReset = isDefault ? undefined : () => edit((r) => resetParam(r, layer.id, param.id));
  const key = `${layer.id}.${param.id}`;

  switch (param.kind) {
    case 'number':
      return (
        <NumberField
          label={param.label}
          value={typeof value === 'number' ? value : param.default}
          min={param.min}
          max={param.max}
          step={param.step}
          unit={param.unit}
          integer={param.integer}
          help={param.help}
          onReset={onReset}
          onChange={(v) => {
            edit((r) => setParam(r, layer.id, param.id, v), { coalesceKey: key });
            trackParam(family, param.id, 'number');
          }}
        />
      );
    case 'color':
      return (
        <ColorField
          label={param.label}
          value={typeof value === 'string' ? value : param.default}
          help={param.help}
          onReset={onReset}
          onChange={(v) => {
            edit((r) => setParam(r, layer.id, param.id, v), { coalesceKey: key });
            trackParam(family, param.id, 'color');
          }}
        />
      );
    case 'boolean':
      return (
        <Toggle
          label={param.label}
          checked={value === true}
          help={param.help}
          description={param.help}
          onChange={(v) => {
            edit((r) => setParam(r, layer.id, param.id, v));
            trackParam(family, param.id, 'toggle');
          }}
        />
      );
    case 'select':
      return (
        <SelectField
          label={param.label}
          value={typeof value === 'string' ? value : param.default}
          options={param.options}
          help={param.help}
          onReset={onReset}
          onChange={(v) => {
            edit((r) => setParam(r, layer.id, param.id, v));
            trackParam(family, param.id, 'select');
          }}
        />
      );
  }
}

function CanvasProperties({ recipe }: { recipe: Recipe }) {
  const { edit } = useApp();
  const [nameDraft, setNameDraft] = useState(recipe.name);
  // Follow renames from elsewhere (undo, save as copy).
  useEffect(() => setNameDraft(recipe.name), [recipe.name]);
  const presetMatch = DIMENSION_PRESETS.find((p) => p.width === recipe.canvas.width && p.height === recipe.canvas.height);

  return (
    <>
      <div className="panel-head">
        <Icon name="frame" />
        <div className="panel-title-stack">
          <h2 className="panel-title">Canvas & recipe</h2>
          <span className="muted small">Applies to the whole recipe</span>
        </div>
      </div>
      <div className="panel-scroll">
        <section className="prop-section">
          <h3 className="prop-section-title">Recipe</h3>
          <div className="field">
            <label className="field-label" htmlFor="recipe-name">
              Name
            </label>
            <input
              id="recipe-name"
              className="input"
              value={nameDraft}
              maxLength={RECIPE_LIMITS.maxNameLength}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                if (!nameDraft.trim()) setNameDraft(recipe.name);
                else edit((r) => setName(r, nameDraft));
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
          <NumberField
            label="Seed"
            value={recipe.seed}
            min={0}
            max={MAX_SEED}
            step={1}
            integer
            noSlider
            help="Every random element of the texture derives from this number. The same seed and settings always give the same result."
            onChange={(v) => edit((r) => setSeed(r, v))}
          />
          <dl className="meta-list">
            <div>
              <dt>Family</dt>
              <dd>{recipe.family === 'custom' ? 'Custom' : FAMILY_LABELS[recipe.family]}</dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>
                {recipe.engineVersion}
                {recipe.engineVersion !== ENGINE_VERSION ? ` (rendering with ${ENGINE_VERSION})` : ''}
              </dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>v{recipe.schemaVersion}</dd>
            </div>
          </dl>
        </section>

        <section className="prop-section">
          <h3 className="prop-section-title">Canvas</h3>
          <SelectField
            label="Size preset"
            value={presetMatch?.id ?? 'custom'}
            options={[...DIMENSION_PRESETS.map((p) => ({ value: p.id, label: `${p.label} — ${p.width} × ${p.height}` })), { value: 'custom', label: 'Custom' }]}
            onChange={(id) => {
              const p = DIMENSION_PRESETS.find((d) => d.id === id);
              if (p) edit((r) => setCanvasSize(r, p.width, p.height));
            }}
          />
          <div className="field-pair">
            <NumberField
              label="Width"
              value={recipe.canvas.width}
              min={RECIPE_LIMITS.minCanvasSide}
              max={RECIPE_LIMITS.maxCanvasSide}
              step={1}
              unit="px"
              integer
              noSlider
              onChange={(v) => edit((r) => setCanvasSize(r, v, r.canvas.height))}
            />
            <NumberField
              label="Height"
              value={recipe.canvas.height}
              min={RECIPE_LIMITS.minCanvasSide}
              max={RECIPE_LIMITS.maxCanvasSide}
              step={1}
              unit="px"
              integer
              noSlider
              onChange={(v) => edit((r) => setCanvasSize(r, r.canvas.width, v))}
            />
          </div>
          <p className="muted small">Texture features are sized in px of this canvas. Export at 2× or 3× for sharper detail at the same look.</p>
          <Toggle
            label="Transparent background"
            checked={recipe.canvas.transparentBackground}
            description="Keep areas not covered by layers transparent in PNG exports."
            onChange={(v) => edit((r) => setTransparentBackground(r, v))}
          />
        </section>

        <SeamlessSection recipe={recipe} />

        <RecolorSection recipe={recipe} />
      </div>
    </>
  );
}

function SeamlessSection({ recipe }: { recipe: Recipe }) {
  const { edit } = useApp();
  const seamless = isSeamless(recipe);
  const analysis = seamless ? analyzeSeamless(recipe) : null;
  return (
    <section className="prop-section">
      <h3 className="prop-section-title">Seamless tile</h3>
      <Toggle
        label="Seamless tile"
        checked={seamless}
        description="Make the canvas repeat without visible edges, for website and pattern backgrounds. Exports render one tile at the canvas size."
        onChange={(v) => edit((r) => setSeamless(r, v))}
      />
      {analysis && analysis.seams.length > 0 && (
        <div className="callout callout-warning compact" role="status">
          <Icon name="warning" />
          <div className="stack-tight">
            <p>These settings will show seams between tiles:</p>
            <ul className="issue-list">
              {analysis.seams.map((issue, i) => (
                <li key={i}>
                  <strong>{issue.layerName}:</strong> {issue.message}
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => edit((r) => fixSeamlessSeams(r))}>
              Fix seams
            </button>
          </div>
        </div>
      )}
      {analysis && analysis.seams.length === 0 && (
        <p className="callout callout-success compact">
          <Icon name="check" />
          Tiles without seams. Use “Tile preview” below the canvas to check.
        </p>
      )}
      {analysis && analysis.notes.length > 0 && (
        <ul className="issue-list muted">
          {analysis.notes.map((n, i) => (
            <li key={i}>
              {n.layerName}: {n.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
