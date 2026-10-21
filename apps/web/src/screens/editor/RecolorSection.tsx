import { applyPalette, BUILT_IN_PALETTES, createId, PALETTE_LIMITS, recipeColors, type Recipe } from '@material-lab/engine';
import { useMemo, useState } from 'react';
import { useApp } from '../../AppContext';
import { NumberField } from '../../components/fields';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/Toasts';
import { updateSettings, useSettings } from '../../lib/settings';

/** Recolor every compatible layer with a palette (PRD FR-026). */
export function RecolorSection({ recipe }: { recipe: Recipe }) {
  const { edit, dispatch } = useApp();
  const toast = useToast();
  const settings = useSettings();
  const palettes = [...BUILT_IN_PALETTES, ...settings.palettes];
  const [paletteId, setPaletteId] = useState<string>('custom');
  const [custom, setCustom] = useState<string[]>(() => recipeColors(recipe).slice(0, 4));
  const [strength, setStrength] = useState(1);
  const [saveName, setSaveName] = useState('');
  const current = useMemo(() => recipeColors(recipe), [recipe]);
  const selected = palettes.find((p) => p.id === paletteId);
  const colors = selected ? [...selected.colors] : custom;

  const apply = () => {
    const result = applyPalette(recipe, colors, { strength });
    if (result.changes.length === 0) {
      toast.show('Nothing to recolor: the colors already match.');
      return;
    }
    edit(() => result.recipe);
    toast.show(`Recolored ${result.changes.length} color${result.changes.length === 1 ? '' : 's'}`, {
      actions: [{ label: 'Undo', onClick: () => dispatch({ type: 'undo' }) }],
    });
  };

  return (
    <section className="prop-section" aria-labelledby="recolor-title">
      <h3 id="recolor-title" className="prop-section-title">
        Recolor with a palette
      </h3>
      <div className="field">
        <span className="field-label">Colors in this recipe</span>
        <div className="swatch-row" aria-label={`Current colors: ${current.join(', ')}`}>
          {current.map((c) => (
            <span key={c} className="swatch" style={{ background: c }} title={c} />
          ))}
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="palette-select">
          Palette
        </label>
        <select id="palette-select" className="input select" value={paletteId} onChange={(e) => setPaletteId(e.target.value)}>
          <option value="custom">Custom colors…</option>
          <optgroup label="Built in">
            {BUILT_IN_PALETTES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
          {settings.palettes.length > 0 && (
            <optgroup label="Saved on this device">
              {settings.palettes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      {selected ? (
        <div className="swatch-row" aria-label={`${selected.name}: ${selected.colors.join(', ')}`}>
          {selected.colors.map((c) => (
            <span key={c} className="swatch" style={{ background: c }} title={c} />
          ))}
          {settings.palettes.some((p) => p.id === selected.id) && (
            <button
              type="button"
              className="icon-btn icon-btn-small"
              aria-label={`Delete saved palette ${selected.name}`}
              onClick={() => {
                updateSettings({ palettes: settings.palettes.filter((p) => p.id !== selected.id) });
                setPaletteId('custom');
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
      ) : (
        <div className="stack-tight">
          <div className="swatch-row">
            {custom.map((c, i) => (
              <span key={i} className="swatch-edit">
                <input
                  type="color"
                  value={c.toLowerCase()}
                  aria-label={`Palette color ${i + 1}`}
                  onChange={(e) => setCustom((all) => all.map((v, j) => (j === i ? e.target.value.toUpperCase() : v)))}
                />
                {custom.length > PALETTE_LIMITS.min && (
                  <button
                    type="button"
                    className="swatch-remove"
                    aria-label={`Remove palette color ${i + 1}`}
                    onClick={() => setCustom((all) => all.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {custom.length < PALETTE_LIMITS.max && (
              <button type="button" className="icon-btn icon-btn-small" aria-label="Add a palette color" onClick={() => setCustom((all) => [...all, '#888888'])}>
                <Icon name="plus" size={14} />
              </button>
            )}
          </div>
          <div className="inline-form">
            <label className="sr-only" htmlFor="palette-name">
              Palette name
            </label>
            <input id="palette-name" className="input compact" placeholder="Name to save this palette" value={saveName} maxLength={40} onChange={(e) => setSaveName(e.target.value)} />
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={!saveName.trim()}
              onClick={() => {
                const palette = { id: createId('palette'), name: saveName.trim(), colors: [...custom] };
                updateSettings({ palettes: [...settings.palettes, palette] });
                setPaletteId(palette.id);
                setSaveName('');
                toast.show(`Saved palette “${palette.name}”`, { tone: 'success' });
              }}
            >
              Save palette
            </button>
          </div>
        </div>
      )}
      <NumberField label="Strength" value={strength} min={0.1} max={1} step={0.05} unit="%" help="How far colors move toward the palette." onChange={setStrength} />
      <p className="muted small">Colors are matched by lightness, so dark stays dark and light stays light.</p>
      <button type="button" className="btn btn-secondary btn-small" onClick={apply} disabled={colors.length === 0 || current.length === 0}>
        <Icon name="sparkles" />
        Apply palette
      </button>
    </section>
  );
}
