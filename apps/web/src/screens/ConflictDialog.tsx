import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { RecipeThumb } from '../components/RecipeThumb';
import { useToast } from '../components/Toasts';
import { formatRelative } from '../lib/format';
import type { LibraryEntry } from '../lib/library';
import { resolveConflict, type ConflictChoice } from '../lib/sync';

/** Choose between this device's and the cloud's version of a recipe. Nothing is discarded without a choice. */
export function ConflictDialog({ entry, onClose }: { entry: LibraryEntry; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const conflict = entry.cloud?.conflict;
  if (!conflict) return null;

  const choose = async (choice: ConflictChoice) => {
    setBusy(true);
    try {
      await resolveConflict(entry.recipe.recipeId, choice);
      toast.show(choice === 'local' ? 'Kept this device’s version' : choice === 'cloud' ? 'Using the version from your other device' : 'Kept both versions', {
        tone: 'success',
      });
      onClose();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'That did not work. Please try again.', { tone: 'error' });
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Two versions of this recipe"
      size="large"
      dismissible={!busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Decide later
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void choose('both')} disabled={busy}>
            Keep both
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void choose('cloud')} disabled={busy}>
            {conflict.remote ? 'Use other device’s version' : 'Delete it here too'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void choose('local')} disabled={busy}>
            Keep this device’s version
          </button>
        </>
      }
    >
      <p className="muted">
        “{entry.recipe.name}” was changed on this device and {conflict.remote ? 'on another device' : 'deleted on another device'} since they last synced (noticed{' '}
        {formatRelative(conflict.detectedAt)}).
      </p>
      <div className="conflict-grid">
        <figure>
          <RecipeThumb recipe={entry.recipe} width={420} label="This device’s version" />
          <figcaption>
            <strong>This device</strong> · {entry.recipe.name} · {entry.recipe.layers.length} layers
          </figcaption>
        </figure>
        <figure>
          {conflict.remote ? (
            <RecipeThumb recipe={conflict.remote} width={420} label="Other device’s version" />
          ) : (
            <div className="conflict-deleted">
              <Icon name="trash" size={24} />
              <span>Deleted</span>
            </div>
          )}
          <figcaption>
            <strong>Other device</strong>
            {conflict.remote ? ` · ${conflict.remote.name} · ${conflict.remote.layers.length} layers` : ' · deleted'}
          </figcaption>
        </figure>
      </div>
      <p className="muted small">“Keep both” saves this device’s edits as a new recipe and brings in the other version.</p>
    </Modal>
  );
}
