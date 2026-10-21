import { FAMILY_IDS, FAMILY_LABELS, RECIPE_LIMITS, slugify, type RecipeFamily } from '@material-lab/engine';
import { useId, useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { Modal } from '../components/Modal';
import { RecipeThumb } from '../components/RecipeThumb';
import { useToast } from '../components/Toasts';
import { apiBase } from '../lib/api';
import { downloadJson, formatRelative } from '../lib/format';
import { deleteRecipe, duplicateEntry, findByName, renameRecipe, toggleFavorite, useLibrary, type LibraryEntry } from '../lib/library';
import { routeHref } from '../lib/router';
import { entrySyncState, type EntrySyncState } from '../lib/sync';
import { ConflictDialog } from './ConflictDialog';
import { ShareDialog } from './editor/ShareDialog';
import { ImportDialog } from './ImportDialog';

const SYNC_BADGES: Partial<Record<EntrySyncState, { label: string; title: string; tone: string }>> = {
  synced: { label: 'Synced', title: 'The same version is in your account', tone: 'badge-success' },
  pending: { label: 'Not synced yet', title: 'Saved on this device; uploads on the next sync', tone: '' },
  conflict: { label: 'Changed on 2 devices', title: 'Choose which version to keep', tone: 'badge-warning' },
};

type Sort = 'recent' | 'name';
type Filter = 'all' | 'favorites' | RecipeFamily;

export function LibraryScreen() {
  const library = useLibrary();
  const { openRecipe, editor, dispatch, dirty } = useApp();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [renaming, setRenaming] = useState<LibraryEntry | null>(null);
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [conflict, setConflict] = useState<LibraryEntry | null>(null);
  const [sharing, setSharing] = useState<LibraryEntry | null>(null);
  const searchId = useId();

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = library.entries.filter((e) => {
      if (filter === 'favorites' && !e.favorite) return false;
      if (filter !== 'all' && filter !== 'favorites' && e.recipe.family !== filter) return false;
      if (!q) return true;
      return [e.recipe.name, e.recipe.family, ...(e.recipe.metadata.tags ?? [])].join(' ').toLowerCase().includes(q);
    });
    if (sort === 'name') list.sort((a, b) => a.recipe.name.localeCompare(b.recipe.name));
    return list;
  }, [library.entries, query, filter, sort]);

  const families = useMemo(() => FAMILY_IDS.filter((f) => library.entries.some((e) => e.recipe.family === f)), [library.entries]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>My Recipes</h1>
          <p className="muted">Recipes saved in this browser. Export one as JSON to back it up or move it to another device.</p>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>
            <Icon name="upload" />
            Import JSON
          </button>
        </div>
      </header>

      {library.status === 'loading' && <p className="muted">Loading your recipes…</p>}
      {library.status === 'error' && (
        <div className="callout callout-error" role="alert">
          <Icon name="warning" />
          <p>Your saved recipes could not be loaded from this browser’s storage. {library.error}</p>
        </div>
      )}

      {library.status === 'ready' && library.entries.length === 0 && (
        <div className="empty-state">
          <Icon name="save" size={28} />
          <h2>No saved recipes yet</h2>
          <p className="muted">
            You can create and export textures without saving or signing in. Save a recipe when you want to reopen, tweak or recreate it later — it stays in this
            browser.
          </p>
          <div className="button-row center">
            <a className="btn btn-primary" href={routeHref('explore')}>
              Browse presets
            </a>
            <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(true)}>
              Import a recipe file
            </button>
          </div>
        </div>
      )}

      {library.entries.length > 0 && (
        <>
          <div className="toolbar-row">
            <div className="search-field">
              <Icon name="search" />
              <label htmlFor={searchId} className="sr-only">
                Search recipes
              </label>
              <input id={searchId} type="search" className="input" placeholder="Search recipes" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="chips" role="group" aria-label="Filter recipes">
              <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </button>
              <button type="button" className="chip" aria-pressed={filter === 'favorites'} onClick={() => setFilter('favorites')}>
                <Icon name="star" size={13} /> Favorites
              </button>
              {families.map((f) => (
                <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {FAMILY_LABELS[f]}
                </button>
              ))}
            </div>
            <label className="sort-select">
              <span className="sr-only">Sort by</span>
              <select className="input select compact" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="recent">Recently saved</option>
                <option value="name">Name A–Z</option>
              </select>
            </label>
          </div>

          {entries.length === 0 ? (
            <div className="empty-state compact">
              <p>No recipes match.</p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Clear search and filters
              </button>
            </div>
          ) : (
            <ul className="card-grid">
              {entries.map((entry) => {
                const r = entry.recipe;
                const isOpen = editor.recipe?.recipeId === r.recipeId;
                return (
                  <li key={r.recipeId} className="card library-card">
                    <button type="button" className="card-button-area" onClick={() => openRecipe(r, 'library', true)} aria-label={`Open ${r.name}`}>
                      <RecipeThumb recipe={r} width={320} label={`Preview of ${r.name}`} />
                    </button>
                    <div className="card-body">
                      <div className="card-title-row">
                        <span className="card-title">{r.name}</span>
                        {isOpen && <span className="badge">Open</span>}
                        {entry.team && (
                          <span className="badge" title={`Working copy of a recipe in ${entry.team.teamName}`}>
                            {entry.team.teamName}
                          </span>
                        )}
                        {(() => {
                          const state = entrySyncState(entry);
                          const badge = SYNC_BADGES[state];
                          if (!badge) return null;
                          return state === 'conflict' ? (
                            <button type="button" className={`badge badge-button ${badge.tone}`} title={badge.title} onClick={() => setConflict(entry)}>
                              {badge.label}
                            </button>
                          ) : (
                            <span className={`badge ${badge.tone}`} title={badge.title}>
                              {badge.label}
                            </span>
                          );
                        })()}
                      </div>
                      <span className="card-meta">
                        {r.family === 'custom' ? 'Custom' : FAMILY_LABELS[r.family]} · {r.layers.length} layer{r.layers.length === 1 ? '' : 's'} · saved{' '}
                        {formatRelative(entry.savedAt)}
                      </span>
                      <div className="card-actions">
                        <button
                          type="button"
                          className={`icon-btn${entry.favorite ? ' favorite' : ''}`}
                          aria-pressed={entry.favorite}
                          aria-label={entry.favorite ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`}
                          title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
                          onClick={() => void toggleFavorite(r.recipeId)}
                        >
                          <Icon name="star" fill={entry.favorite ? 'currentColor' : 'none'} />
                        </button>
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => openRecipe(r, 'library', true)}>
                          Open
                        </button>
                        <Menu
                          label={`Actions for ${r.name}`}
                          items={[
                            { label: 'Rename…', icon: 'pencil', onSelect: () => setRenaming(entry) },
                            {
                              label: 'Duplicate',
                              icon: 'copy',
                              onSelect: async () => {
                                const copy = await duplicateEntry(r.recipeId);
                                if (copy) toast.show(`Duplicated as “${copy.recipe.name}”`, { tone: 'success' });
                              },
                            },
                            { label: 'Download JSON', icon: 'file', onSelect: () => downloadJson(r, `${slugify(r.name)}.recipe.json`) },
                            ...(entrySyncState(entry) === 'conflict' ? [{ label: 'Choose version…', icon: 'warning' as const, onSelect: () => setConflict(entry) }] : []),
                            ...(apiBase() && !entry.team ? [{ label: 'Share link…', icon: 'copy' as const, onSelect: () => setSharing(entry) }] : []),
                            { label: 'Delete…', icon: 'trash', danger: true, onSelect: () => setDeleting(entry) },
                          ]}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {renaming && (
        <RenameDialog
          entry={renaming}
          onClose={() => setRenaming(null)}
          onRename={async (name) => {
            await renameRecipe(renaming.recipe.recipeId, name);
            // Keep the open editor in step if this recipe is open with no other changes.
            // (With unsaved edits, the editor keeps its own name until the next save.)
            if (editor.recipe?.recipeId === renaming.recipe.recipeId && !dirty) {
              dispatch({ type: 'saved', recipe: { ...editor.recipe, name } });
            }
            setRenaming(null);
          }}
        />
      )}

      <Modal
        open={deleting !== null}
        title="Delete recipe?"
        size="small"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                if (!deleting) return;
                const name = deleting.recipe.name;
                await deleteRecipe(deleting.recipe.recipeId);
                setDeleting(null);
                toast.show(`Deleted “${name}”`);
              }}
            >
              Delete
            </button>
          </>
        }
      >
        <p>
          “{deleting?.recipe.name}” will be removed from this browser{deleting && entrySyncState(deleting) !== 'local' && !deleting.team ? ' and from your account on the next sync' : ''}. This cannot be undone. Exported images are not affected.
          {editor.recipe?.recipeId === deleting?.recipe.recipeId && ' The open copy in the editor stays open, unsaved.'}
        </p>
      </Modal>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {conflict && <ConflictDialog entry={library.entries.find((e) => e.recipe.recipeId === conflict.recipe.recipeId) ?? conflict} onClose={() => setConflict(null)} />}
      {sharing && <ShareDialog recipe={sharing.recipe} onClose={() => setSharing(null)} />}
    </div>
  );
}

function RenameDialog({ entry, onClose, onRename }: { entry: LibraryEntry; onClose: () => void; onRename: (name: string) => Promise<void> }) {
  const [name, setName] = useState(entry.recipe.name);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const submit = async () => {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) return setError('Enter a name.');
    if (clean.length > RECIPE_LIMITS.maxNameLength) return setError(`Names can be up to ${RECIPE_LIMITS.maxNameLength} characters.`);
    if (findByName(clean, entry.recipe.recipeId)) return setError('Another recipe already has this name. Choose a different one.');
    await onRename(clean);
  };
  return (
    <Modal
      open
      title="Rename recipe"
      size="small"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="rename-form" className="btn btn-primary">
            Rename
          </button>
        </>
      }
    >
      <form
        id="rename-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className={`field${error ? ' field-invalid' : ''}`}>
          <label className="field-label" htmlFor={id}>
            Name
          </label>
          <input
            id={id}
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            data-autofocus
          />
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}
