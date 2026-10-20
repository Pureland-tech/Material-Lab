import { validateRecipe, type Recipe } from '@material-lab/engine';

/**
 * Crash/close recovery: while the open recipe has unsaved changes, a copy is
 * kept in localStorage. On the next visit it is offered back, labeled as a
 * draft until the user saves it.
 */
const KEY = 'material-lab:draft';

export interface Draft {
  recipe: Recipe;
  persisted: boolean;
  savedAt: string;
}

export function writeDraft(recipe: Recipe, persisted: boolean): void {
  try {
    const draft: Draft = { recipe, persisted, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage full or unavailable: recovery is best-effort.
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    // Drafts are untrusted like any stored data: validate before use.
    const result = validateRecipe(parsed.recipe);
    if (!result.ok) return null;
    return { recipe: result.recipe, persisted: parsed.persisted === true, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '' };
  } catch {
    return null;
  }
}
