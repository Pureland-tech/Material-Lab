import { createId, FAMILY_LABELS, parseRecipeJson, RECIPE_LIMITS, type ValidationResult } from '@material-lab/engine';
import { useId, useState } from 'react';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { RecipeThumb } from '../components/RecipeThumb';
import { track } from '../lib/analytics';

interface ImportDialogProps {
  onClose: () => void;
}

/** Import a recipe from a JSON file: validate, summarize, then open as a new recipe. */
export function ImportDialog({ onClose }: ImportDialogProps) {
  const { openRecipe } = useApp();
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const inputId = useId();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    if (file.size > RECIPE_LIMITS.maxJsonBytes) {
      setResult({
        ok: false,
        warnings: [],
        errors: [{ severity: 'error', path: '', code: 'too-large', message: `File is ${Math.ceil(file.size / 1024)} KB; recipes can be at most ${RECIPE_LIMITS.maxJsonBytes / 1024} KB.` }],
      });
      return;
    }
    setReading(true);
    try {
      setResult(parseRecipeJson(await file.text()));
    } catch {
      setResult({ ok: false, warnings: [], errors: [{ severity: 'error', path: '', code: 'unreadable', message: 'The file could not be read.' }] });
    } finally {
      setReading(false);
    }
  };

  const open = () => {
    if (!result?.ok) return;
    // Imports always become a new recipe so nothing existing is overwritten.
    const recipe = { ...result.recipe, recipeId: createId('recipe') };
    track('recipe_imported', { layer_count: recipe.layers.length, warning_count: result.warnings.length });
    track('recipe_created', { source: 'import' });
    onClose();
    openRecipe(recipe, 'import', false);
  };

  return (
    <Modal
      open
      title="Import recipe JSON"
      onClose={onClose}
      size="medium"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!result?.ok} onClick={open}>
            Open as new recipe
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">
          Choose a <code>.json</code> recipe exported from Material Lab. It is checked before anything is rendered; files are never executed.
        </p>
        <label htmlFor={inputId} className="file-drop">
          <Icon name="upload" size={20} />
          <span>{fileName ? `Selected: ${fileName}` : 'Choose a recipe file'}</span>
          <input id={inputId} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} data-autofocus />
        </label>
        {reading && <p className="muted">Reading…</p>}
        {result && !result.ok && (
          <div className="callout callout-error" role="alert">
            <Icon name="warning" />
            <div className="stack-tight">
              <p>
                <strong>This file can’t be imported.</strong>
              </p>
              <ul className="issue-list">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    {e.message}
                    {e.path && <span className="muted"> ({e.path})</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {result?.ok && (
          <div className="import-summary">
            <RecipeThumb recipe={result.recipe} width={200} label={`Preview of ${result.recipe.name}`} />
            <div className="stack-tight">
              <p>
                <strong>{result.recipe.name}</strong>
              </p>
              <p className="muted small">
                {result.recipe.family === 'custom' ? 'Custom' : FAMILY_LABELS[result.recipe.family]} · {result.recipe.layers.length} layer
                {result.recipe.layers.length === 1 ? '' : 's'} · {result.recipe.canvas.width} × {result.recipe.canvas.height} · seed {result.recipe.seed} · engine{' '}
                {result.recipe.engineVersion}
              </p>
              {result.warnings.length > 0 ? (
                <details className="import-warnings">
                  <summary>
                    <Icon name="warning" size={14} /> {result.warnings.length} compatibility note{result.warnings.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="issue-list">
                    {result.warnings.map((w, i) => (
                      <li key={i}>
                        {w.message}
                        {w.path && <span className="muted"> ({w.path})</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="small">
                  <Icon name="check" size={14} /> Fully compatible with this version.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
