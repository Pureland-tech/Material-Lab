import { contentFingerprint, type Recipe } from '@material-lab/engine';

/** `canvas` selects the recipe/canvas settings instead of a layer. */
export type Selection = string | 'canvas';

export type RecipeSource = 'preset' | 'blank' | 'library' | 'import' | 'export-log';

interface Snapshot {
  recipe: Recipe;
  selection: Selection;
}

export interface EditorState {
  recipe: Recipe | null;
  selection: Selection;
  past: Snapshot[];
  future: Snapshot[];
  /** Fingerprint of the last loaded/saved content, for unsaved-change detection. */
  baseline: string | null;
  /** True once the recipe exists in the local library. */
  persisted: boolean;
  source: RecipeSource | null;
  /** Edits with the same key within COALESCE_MS merge into one undo step (e.g. a slider drag). */
  lastEdit: { key: string; at: number } | null;
  /** Restored from an unsaved draft; stays labeled as a draft until saved. */
  restoredDraft: boolean;
}

export type EditorAction =
  | { type: 'load'; recipe: Recipe; source: RecipeSource; persisted: boolean; selection?: Selection; draft?: boolean }
  | { type: 'edit'; update: (recipe: Recipe) => Recipe; coalesceKey?: string; select?: Selection; now: number }
  | { type: 'select'; selection: Selection }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; recipe: Recipe }
  | { type: 'close' };

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 800;

export const initialEditorState: EditorState = {
  recipe: null,
  selection: 'canvas',
  past: [],
  future: [],
  baseline: null,
  persisted: false,
  source: null,
  lastEdit: null,
  restoredDraft: false,
};

function validSelection(recipe: Recipe, selection: Selection): Selection {
  if (selection === 'canvas') return selection;
  return recipe.layers.some((l) => l.id === selection) ? selection : defaultSelection(recipe);
}

/** Select the top layer by default, or the canvas when there are no layers. */
export function defaultSelection(recipe: Recipe): Selection {
  return recipe.layers[recipe.layers.length - 1]?.id ?? 'canvas';
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return {
        ...initialEditorState,
        recipe: action.recipe,
        selection: validSelection(action.recipe, action.selection ?? defaultSelection(action.recipe)),
        // A restored draft is unsaved work by definition.
        baseline: action.draft ? null : contentFingerprint(action.recipe),
        persisted: action.persisted,
        source: action.source,
        restoredDraft: action.draft === true,
      };
    case 'edit': {
      if (!state.recipe) return state;
      const next = action.update(state.recipe);
      if (next === state.recipe) return state;
      const selection = validSelection(next, action.select ?? state.selection);
      const coalesce =
        action.coalesceKey !== undefined &&
        state.lastEdit?.key === action.coalesceKey &&
        action.now - state.lastEdit.at < COALESCE_MS &&
        state.past.length > 0;
      const past = coalesce ? state.past : [...state.past, { recipe: state.recipe, selection: state.selection }].slice(-HISTORY_LIMIT);
      return {
        ...state,
        recipe: next,
        selection,
        past,
        future: [],
        lastEdit: action.coalesceKey !== undefined ? { key: action.coalesceKey, at: action.now } : null,
      };
    }
    case 'select':
      if (!state.recipe) return state;
      return { ...state, selection: validSelection(state.recipe, action.selection), lastEdit: null };
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev || !state.recipe) return state;
      return {
        ...state,
        recipe: prev.recipe,
        selection: validSelection(prev.recipe, prev.selection),
        past: state.past.slice(0, -1),
        future: [{ recipe: state.recipe, selection: state.selection }, ...state.future],
        lastEdit: null,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next || !state.recipe) return state;
      return {
        ...state,
        recipe: next.recipe,
        selection: validSelection(next.recipe, next.selection),
        past: [...state.past, { recipe: state.recipe, selection: state.selection }],
        future: state.future.slice(1),
        lastEdit: null,
      };
    }
    case 'saved': {
      if (!state.recipe) return state;
      // Take the saved identity (a "save as copy" has a new id and name) but keep
      // any edits made while the save was in progress; they stay unsaved.
      const saved = action.recipe;
      const recipe: Recipe = {
        ...state.recipe,
        recipeId: saved.recipeId,
        name: saved.name,
        family: saved.family,
        engineVersion: saved.engineVersion,
        metadata: saved.metadata,
      };
      // History keeps working, but every step now belongs to the saved recipe's
      // identity, so undoing past a "save as copy" never targets the original.
      const rebase = (s: Snapshot): Snapshot => ({
        ...s,
        recipe: { ...s.recipe, recipeId: saved.recipeId, metadata: saved.metadata },
      });
      return {
        ...state,
        recipe,
        past: state.past.map(rebase),
        future: state.future.map(rebase),
        baseline: contentFingerprint(saved),
        persisted: true,
        lastEdit: null,
        restoredDraft: false,
      };
    }
    case 'close':
      return initialEditorState;
    default:
      return state;
  }
}

export function isDirty(state: EditorState): boolean {
  return state.recipe !== null && contentFingerprint(state.recipe) !== state.baseline;
}
