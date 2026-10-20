import { RECIPE_LIMITS, type Recipe } from '@material-lab/engine';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { asNewRecipe, findByName, loadLibrary, uniqueName, type LibraryEntry } from '../../lib/library';
import { track } from '../../lib/analytics';

export interface SaveRequest {
  mode: 'save' | 'copy';
}

interface SaveDialogProps {
  request: SaveRequest;
  recipe: Recipe;
  onCancel: () => void;
  /** Persist the given recipe; resolves false if saving failed (dialog stays open). */
  onSave: (recipe: Recipe) => Promise<boolean>;
}

export function SaveDialog({ request, recipe, onCancel, onSave }: SaveDialogProps) {
  const copy = request.mode === 'copy';
  const [name, setName] = useState(() => (copy ? uniqueName(`${recipe.name} copy`) : recipe.name));
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<LibraryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCloudInfo, setShowCloudInfo] = useState(false);
  const nameId = useId();

  useEffect(() => {
    void loadLibrary();
  }, []);

  const build = (finalName: string, replace: LibraryEntry | null): Recipe => {
    const base = copy ? asNewRecipe(recipe, finalName) : { ...recipe, name: finalName };
    // "Replace" overwrites the existing saved recipe of that name.
    return replace ? { ...base, recipeId: replace.recipe.recipeId } : base;
  };

  const commit = async (finalName: string, replace: LibraryEntry | null) => {
    setBusy(true);
    const ok = await onSave(build(finalName, replace));
    setBusy(false);
    if (!ok) setError('Saving failed. Your work is still open; try again.');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) {
      setError('Enter a name for the recipe.');
      return;
    }
    if (clean.length > RECIPE_LIMITS.maxNameLength) {
      setError(`Names can be up to ${RECIPE_LIMITS.maxNameLength} characters.`);
      return;
    }
    setError(null);
    await loadLibrary();
    const existing = findByName(clean, copy ? undefined : recipe.recipeId);
    if (existing) {
      setName(clean);
      setConflict(existing);
      return;
    }
    await commit(clean, null);
  };

  return (
    <Modal
      open
      title={copy ? 'Save a copy' : 'Save recipe'}
      onClose={onCancel}
      dismissible={!busy}
      size="small"
      footer={
        conflict ? null : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form="save-recipe-form" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : copy ? 'Save copy' : 'Save'}
            </button>
          </>
        )
      }
    >
      <form id="save-recipe-form" onSubmit={submit} className="stack">
        <div className={`field${error ? ' field-invalid' : ''}`}>
          <label htmlFor={nameId} className="field-label">
            Recipe name
          </label>
          <input
            id={nameId}
            className="input"
            value={name}
            maxLength={RECIPE_LIMITS.maxNameLength + 10}
            onChange={(e) => {
              setName(e.target.value);
              setConflict(null);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${nameId}-error` : undefined}
            data-autofocus
          />
          {error && (
            <p className="field-error" id={`${nameId}-error`} role="alert">
              {error}
            </p>
          )}
        </div>

        <fieldset className="field">
          <legend className="field-label">Save to</legend>
          <label className="radio-row">
            <input type="radio" name="destination" checked readOnly />
            <span>
              <strong>This device</strong>
              <span className="muted"> — stored in this browser. No account needed.</span>
            </span>
          </label>
          <label className="radio-row disabled">
            <input type="radio" name="destination" disabled />
            <span>
              <strong>Cloud library</strong>
              <span className="muted"> — sync across devices and design tools.</span>
              <span className="badge">Not available yet</span>
            </span>
          </label>
          <button
            type="button"
            className="link-btn"
            aria-expanded={showCloudInfo}
            onClick={() => {
              if (!showCloudInfo) track('auth_prompt_opened', { trigger_feature: 'cloud_save' });
              setShowCloudInfo((v) => !v);
            }}
          >
            Why can’t I save to the cloud?
          </button>
          {showCloudInfo && (
            <p className="note">
              Cloud sync needs a Pureland account and is planned for a later release. Recipes saved on this device can be exported as JSON from My
              Recipes and imported elsewhere.
            </p>
          )}
        </fieldset>
      </form>

      {conflict && (
        <div className="callout callout-warning" role="alert">
          <Icon name="warning" />
          <div className="stack-tight">
            <p>
              A recipe named <strong>“{conflict.recipe.name}”</strong> already exists on this device.
            </p>
            <div className="button-row">
              <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => void commit(conflict.recipe.name, conflict)}>
                Replace it
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void commit(uniqueName(conflict.recipe.name), null)}>
                Save as “{uniqueName(conflict.recipe.name)}”
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  setConflict(null);
                  document.getElementById(nameId)?.focus();
                }}
              >
                Change name
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
