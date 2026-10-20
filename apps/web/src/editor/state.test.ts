import { createLayer, createRecipe, PRESETS, instantiatePreset, type Recipe } from '@material-lab/engine';
import { describe, expect, it } from 'vitest';
import { addLayer, duplicateLayer, moveLayerBy, removeLayer, resetLayer, setCanvasSize, setLayerEnabled, setParam } from './ops';
import { COALESCE_MS, editorReducer, initialEditorState, isDirty, type EditorAction, type EditorState } from './state';

function recipe(): Recipe {
  return createRecipe({
    name: 'Test',
    seed: 1,
    layers: [createLayer('base-color', { id: 'base' }), createLayer('grain', { id: 'grain', seedOffset: 34 })],
  });
}

function run(actions: EditorAction[], start: EditorState = initialEditorState): EditorState {
  return actions.reduce(editorReducer, start);
}

const load: EditorAction = { type: 'load', recipe: recipe(), source: 'blank', persisted: false };

describe('editor history', () => {
  it('loads a recipe clean, with the top layer selected', () => {
    const s = run([load]);
    expect(isDirty(s)).toBe(false);
    expect(s.selection).toBe('grain');
  });

  it('undoes and redoes edits', () => {
    const s1 = run([load, { type: 'edit', update: (r) => setParam(r, 'grain', 'amount', 0.5), now: 0 }]);
    expect(isDirty(s1)).toBe(true);
    const s2 = run([{ type: 'undo' }], s1);
    expect(s2.recipe?.layers[1]?.parameters.amount).toBe(0.25);
    expect(isDirty(s2)).toBe(false);
    const s3 = run([{ type: 'redo' }], s2);
    expect(s3.recipe?.layers[1]?.parameters.amount).toBe(0.5);
  });

  it('coalesces rapid edits of the same control into one undo step', () => {
    const edit = (v: number, now: number): EditorAction => ({ type: 'edit', update: (r) => setParam(r, 'grain', 'amount', v), coalesceKey: 'grain.amount', now });
    const s = run([load, edit(0.3, 0), edit(0.4, 100), edit(0.5, 200)]);
    expect(s.past).toHaveLength(1);
    const later = run([edit(0.6, 200 + COALESCE_MS + 1)], s);
    expect(later.past).toHaveLength(2);
    expect(run([{ type: 'undo' }], s).recipe?.layers[1]?.parameters.amount).toBe(0.25);
  });

  it('ignores no-op edits', () => {
    const s = run([load, { type: 'edit', update: (r) => r, now: 0 }]);
    expect(s.past).toHaveLength(0);
  });

  it('drops redo history after a new edit', () => {
    const s = run([
      load,
      { type: 'edit', update: (r) => setParam(r, 'grain', 'amount', 0.5), now: 0 },
      { type: 'undo' },
      { type: 'edit', update: (r) => setParam(r, 'grain', 'size', 3), now: 1 },
    ]);
    expect(s.future).toHaveLength(0);
  });

  it('keeps selection valid when the selected layer disappears', () => {
    const s = run([load, { type: 'edit', update: (r) => removeLayer(r, 'grain'), now: 0 }]);
    expect(s.selection).toBe('base');
    const back = run([{ type: 'undo' }], s);
    expect(back.selection).toBe('grain');
  });

  it('marks the recipe clean after saving and keeps the saved identity in history', () => {
    const edited = run([load, { type: 'edit', update: (r) => setParam(r, 'grain', 'amount', 0.5), now: 0 }]);
    const savedCopy = { ...edited.recipe!, recipeId: 'recipe_copy', name: 'Copy' };
    const s = run([{ type: 'saved', recipe: savedCopy }], edited);
    expect(isDirty(s)).toBe(false);
    expect(s.persisted).toBe(true);
    const undone = run([{ type: 'undo' }], s);
    expect(undone.recipe?.recipeId).toBe('recipe_copy');
    expect(isDirty(undone)).toBe(true);
  });
});

describe('recipe ops', () => {
  it('adds layers above the selection with explicit, distinct seed offsets', () => {
    const { recipe: r, layerId } = addLayer(recipe(), 'noise', 'base');
    expect(r.layers.map((l) => l.type)).toEqual(['base-color', 'noise', 'grain']);
    const added = r.layers.find((l) => l.id === layerId)!;
    expect(r.layers.filter((l) => l.seedOffset === added.seedOffset)).toHaveLength(1);
  });

  it('names repeated layer types distinctly', () => {
    const r = addLayer(recipe(), 'grain').recipe;
    expect(r.layers[2]?.name).toBe('Grain 2');
  });

  it('duplicates directly above with an identical look', () => {
    const { recipe: r, layerId } = duplicateLayer(recipe(), 'base');
    expect(r.layers[1]?.id).toBe(layerId);
    expect(r.layers[1]?.parameters).toEqual(r.layers[0]?.parameters);
    expect(r.layers[1]?.seedOffset).toBe(r.layers[0]?.seedOffset);
  });

  it('reorders within bounds', () => {
    const r = moveLayerBy(recipe(), 'base', 1);
    expect(r.layers.map((l) => l.id)).toEqual(['grain', 'base']);
    expect(moveLayerBy(r, 'base', 1)).toBe(r);
  });

  it('toggles visibility without touching other properties', () => {
    const r = setLayerEnabled(recipe(), 'grain', false);
    expect(r.layers[1]?.enabled).toBe(false);
    expect({ ...r.layers[1], enabled: true }).toEqual(recipe().layers[1]);
  });

  it('resets a layer to defaults', () => {
    const preset = instantiatePreset(PRESETS.find((p) => p.id === 'grain-night-film')!);
    const grain = preset.layers[1]!;
    const reset = resetLayer(preset, grain.id).layers[1]!;
    expect(reset.parameters.amount).toBe(0.25);
    expect(reset.blendMode).toBe('overlay');
  });

  it('keeps export defaults following the canvas', () => {
    const r = setCanvasSize(recipe(), 800, 600);
    expect(r.exportDefaults.width).toBe(800);
    expect(r.exportDefaults.height).toBe(600);
  });
});
