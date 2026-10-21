import {
  createRecipe,
  instantiatePreset,
  type Preset,
  type Recipe,
} from '@material-lab/engine';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useToast } from './components/Toasts';
import { editorReducer, initialEditorState, isDirty, type EditorAction, type EditorState, type RecipeSource, type Selection } from './editor/state';
import { track } from './lib/analytics';
import { clearDraft, writeDraft } from './lib/draft';
import { saveRecipe } from './lib/library';
import { navigate } from './lib/router';
import { remoteReplacements, setEditingGuard } from './lib/sync';
import { SaveDialog, type SaveRequest } from './screens/editor/SaveDialog';
import { UnsavedChangesDialog } from './screens/editor/UnsavedChangesDialog';

export type SaveStatus = 'idle' | 'saving' | 'error';

interface AppApi {
  editor: EditorState;
  dirty: boolean;
  dispatch: (action: EditorAction) => void;
  /** Apply an undoable edit to the open recipe. */
  edit: (update: (recipe: Recipe) => Recipe, options?: { coalesceKey?: string; select?: Selection }) => void;
  /** Open a recipe in the editor, asking about unsaved changes first. */
  openRecipe: (recipe: Recipe, source: RecipeSource, persisted: boolean, options?: { draft?: boolean }) => void;
  openPreset: (preset: Preset) => void;
  openBlank: () => void;
  /** Run `action` after resolving unsaved changes (Save / Discard / Cancel). */
  guard: (action: () => void) => void;
  /** Save the open recipe; asks for a name the first time. Resolves true when saved. */
  save: () => Promise<boolean>;
  /** Save the open recipe under a new identity. */
  saveAsCopy: () => void;
  saveStatus: SaveStatus;
}

const AppContext = createContext<AppApi | null>(null);

export function useApp(): AppApi {
  const api = useContext(AppContext);
  if (!api) throw new Error('useApp must be used inside AppProvider');
  return api;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [editor, dispatch] = useReducer(editorReducer, initialEditorState);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveDialog, setSaveDialog] = useState<SaveRequest | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const toast = useToast();
  const dirty = isDirty(editor);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  // Resolvers waiting for the save dialog to finish.
  const saveWaiters = useRef<((saved: boolean) => void)[]>([]);

  const edit = useCallback<AppApi['edit']>((update, options) => {
    dispatch({ type: 'edit', update, coalesceKey: options?.coalesceKey, select: options?.select, now: performance.now() });
  }, []);

  const finishSaveDialog = useCallback((saved: boolean) => {
    setSaveDialog(null);
    const waiters = saveWaiters.current;
    saveWaiters.current = [];
    for (const w of waiters) w(saved);
  }, []);

  const persist = useCallback(
    async (recipe: Recipe): Promise<boolean> => {
      setSaveStatus('saving');
      try {
        const entry = await saveRecipe(recipe);
        dispatch({ type: 'saved', recipe: entry.recipe });
        setSaveStatus('idle');
        track('recipe_saved', { destination: 'local', layer_count: recipe.layers.length });
        return true;
      } catch (error) {
        setSaveStatus('error');
        track('recipe_save_failed', { destination: 'local', error_category: error instanceof Error ? error.name : 'unknown' });
        toast.show('Could not save the recipe on this device. Your changes are still open in the editor.', {
          tone: 'error',
          actions: [{ label: 'Retry', onClick: () => void persist(recipe) }],
        });
        return false;
      }
    },
    [toast],
  );

  const save = useCallback(async (): Promise<boolean> => {
    const current = editorRef.current;
    if (!current.recipe) return false;
    if (current.persisted) {
      const ok = await persist(current.recipe);
      if (ok) toast.show('Saved on this device', { tone: 'success' });
      return ok;
    }
    return new Promise<boolean>((resolve) => {
      saveWaiters.current.push(resolve);
      setSaveDialog({ mode: 'save' });
    });
  }, [persist, toast]);

  const saveAsCopy = useCallback(() => {
    if (editorRef.current.recipe) setSaveDialog({ mode: 'copy' });
  }, []);

  const guard = useCallback(
    (action: () => void) => {
      if (!isDirty(editorRef.current)) action();
      else setPendingAction(() => action);
    },
    [],
  );

  const openRecipe = useCallback<AppApi['openRecipe']>(
    (recipe, source, persisted, options) => {
      guard(() => {
        dispatch({ type: 'load', recipe, source, persisted, draft: options?.draft });
        if (source === 'library') track('recipe_reopened', { layer_count: recipe.layers.length });
        navigate('create');
      });
    },
    [guard],
  );

  const openPreset = useCallback<AppApi['openPreset']>(
    (preset) => {
      guard(() => {
        dispatch({ type: 'load', recipe: instantiatePreset(preset), source: 'preset', persisted: false });
        track('preset_selected', { family_id: preset.family, preset_id: preset.id });
        track('recipe_created', { source: 'preset' });
        navigate('create');
      });
    },
    [guard],
  );

  const openBlank = useCallback(() => {
    guard(() => {
      dispatch({ type: 'load', recipe: createRecipe({ name: 'Untitled texture' }), source: 'blank', persisted: false });
      track('recipe_created', { source: 'blank' });
      navigate('create');
    });
  }, [guard]);

  // Cloud sync never replaces a recipe that is open with unsaved changes, and
  // refreshes the editor when it replaces one that is open without changes.
  useEffect(() => {
    setEditingGuard((id) => editorRef.current.recipe?.recipeId === id && isDirty(editorRef.current));
    return remoteReplacements.subscribe(() => {
      const next = remoteReplacements.get();
      const current = editorRef.current;
      if (next && current.recipe?.recipeId === next.recipeId && !isDirty(current)) {
        dispatch({ type: 'load', recipe: next, source: current.source ?? 'library', persisted: true, selection: current.selection });
        toast.show(`“${next.name}” was updated from your other device.`);
      }
    });
  }, [toast]);

  // Keep a recoverable draft while there are unsaved changes.
  useEffect(() => {
    if (!editor.recipe || !dirty) {
      clearDraft();
      return;
    }
    const t = window.setTimeout(() => writeDraft(editor.recipe as Recipe, editor.persisted), 600);
    return () => window.clearTimeout(t);
  }, [editor.recipe, editor.persisted, dirty]);

  // Last-resort browser prompt when closing the tab with unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const api = useMemo<AppApi>(
    () => ({ editor, dirty, dispatch, edit, openRecipe, openPreset, openBlank, guard, save, saveAsCopy, saveStatus }),
    [editor, dirty, edit, openRecipe, openPreset, openBlank, guard, save, saveAsCopy, saveStatus],
  );

  return (
    <AppContext.Provider value={api}>
      {children}
      {saveDialog && editor.recipe && (
        <SaveDialog
          request={saveDialog}
          recipe={editor.recipe}
          onCancel={() => finishSaveDialog(false)}
          onSave={async (recipe) => {
            const ok = await persist(recipe);
            if (ok) {
              toast.show(saveDialog.mode === 'copy' ? `Saved a copy as “${recipe.name}”` : 'Saved on this device', { tone: 'success' });
              finishSaveDialog(true);
            }
            return ok;
          }}
        />
      )}
      <UnsavedChangesDialog
        open={pendingAction !== null}
        recipeName={editor.recipe?.name ?? ''}
        onCancel={() => setPendingAction(null)}
        onDiscard={() => {
          const action = pendingAction;
          setPendingAction(null);
          clearDraft();
          action?.();
        }}
        onSave={async () => {
          const action = pendingAction;
          setPendingAction(null);
          const saved = await save();
          // If saving fails or is cancelled, stay in the editor with the draft intact.
          if (saved) action?.();
        }}
      />
    </AppContext.Provider>
  );
}
