import { contentFingerprint, type Recipe } from '@material-lab/engine';
import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { RecipeThumb } from '../../components/RecipeThumb';
import { useToast } from '../../components/Toasts';
import { formatDateTime, formatRelative } from '../../lib/format';
import { asNewRecipe, uniqueName } from '../../lib/library';
import { listVersions, MAX_VERSIONS_PER_RECIPE, type RecipeVersion } from '../../lib/versions';

/** Saved versions of the open recipe, newest first, with restore (PRD FR-045). */
export function HistoryDialog({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const { edit, openRecipe, dispatch } = useApp();
  const toast = useToast();
  const [versions, setVersions] = useState<RecipeVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = contentFingerprint(recipe);

  useEffect(() => {
    listVersions(recipe.recipeId).then(setVersions, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [recipe.recipeId]);

  const restore = (version: RecipeVersion) => {
    // Restoring is an ordinary edit: undoable, and saved only when the user saves.
    edit(() => ({ ...version.recipe, recipeId: recipe.recipeId, name: version.recipe.name, metadata: recipe.metadata }));
    onClose();
    toast.show(`Restored the version from ${formatDateTime(version.savedAt)}. Save to keep it.`, {
      actions: [{ label: 'Undo', onClick: () => dispatch({ type: 'undo' }) }],
    });
  };

  return (
    <Modal open title="Version history" size="medium" onClose={onClose}>
      <p className="muted small">
        A version is kept each time you save (the last {MAX_VERSIONS_PER_RECIPE}, on this device). Restoring replaces the editor contents; you can undo it.
      </p>
      {error && <p className="callout callout-error compact">Could not load history: {error}</p>}
      {versions === null && !error && <p className="muted">Loading…</p>}
      {versions?.length === 0 && (
        <div className="empty-state compact">
          <p>No saved versions yet. Save the recipe to start its history.</p>
        </div>
      )}
      {versions && versions.length > 0 && (
        <ol className="version-list">
          {versions.map((v, i) => {
            const isCurrent = contentFingerprint(v.recipe) === current;
            return (
              <li key={v.key} className="version-row">
                <RecipeThumb recipe={v.recipe} width={96} label={`Version from ${formatDateTime(v.savedAt)}`} />
                <div className="version-text">
                  <strong title={formatDateTime(v.savedAt)}>
                    {i === 0 ? 'Latest save' : `Saved ${formatRelative(v.savedAt)}`}
                    {isCurrent && <span className="badge">Matches editor</span>}
                  </strong>
                  <span className="muted small">
                    {formatDateTime(v.savedAt)} · {v.recipe.layers.length} layer{v.recipe.layers.length === 1 ? '' : 's'} · seed {v.recipe.seed}
                  </span>
                </div>
                <div className="button-row">
                  <button type="button" className="btn btn-secondary btn-small" disabled={isCurrent} onClick={() => restore(v)}>
                    <Icon name="reset" />
                    Restore
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => {
                      onClose();
                      openRecipe(asNewRecipe(v.recipe, uniqueName(`${v.recipe.name} (version)`)), 'library', false);
                    }}
                  >
                    Open as copy
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
