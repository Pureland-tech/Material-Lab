import { getLayerDefinition, RECIPE_LIMITS, type Layer, type LayerType, type Recipe } from '@material-lab/engine';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useApp } from '../../AppContext';
import { Icon } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { useToast } from '../../components/Toasts';
import { track } from '../../lib/analytics';
import { addLayer, canAddLayer, duplicateLayer, moveLayerBy, moveLayerTo, removeLayer, renameLayer, setLayerEnabled } from '../../editor/ops';
import { AddLayerMenu } from './AddLayerMenu';
import { LayerSwatch } from './LayerSwatch';

interface LayerPanelProps {
  recipe: Recipe;
  addMenuOpen: boolean;
  onAddMenuOpenChange: (open: boolean) => void;
}

export function LayerPanel({ recipe, addMenuOpen, onAddMenuOpenChange }: LayerPanelProps) {
  const { editor, edit, dispatch } = useApp();
  const toast = useToast();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const selection = editor.selection;
  // Displayed top-first, like most design tools; recipe.layers is bottom-first.
  const ordered = [...recipe.layers].reverse();
  const canAdd = canAddLayer(recipe);

  const focusRow = (id: string) => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-layer-id="${id}"] .layer-name-btn`)?.focus());
  };

  const add = (type: LayerType) => {
    const aboveId = selection !== 'canvas' ? selection : undefined;
    const result = addLayer(recipe, type, aboveId);
    if (!result.layerId) return;
    edit(() => result.recipe, { select: result.layerId });
    track('layer_added', { family_id: getLayerDefinition(type)?.family ?? 'base', layer_count: result.recipe.layers.length });
    focusRow(result.layerId);
  };

  const remove = (layer: Layer) => {
    edit((r) => removeLayer(r, layer.id));
    track('layer_operation', { operation: 'delete', layer_count: recipe.layers.length - 1 });
    toast.show(`Deleted “${layer.name}”`, { actions: [{ label: 'Undo', onClick: () => dispatch({ type: 'undo' }) }] });
  };

  const move = (layer: Layer, delta: number) => {
    edit((r) => moveLayerBy(r, layer.id, delta));
    track('layer_operation', { operation: 'move', layer_count: recipe.layers.length });
    focusRow(layer.id);
  };

  const onRowKeyDown = (e: KeyboardEvent, layer: Layer) => {
    if (renaming) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(layer, e.key === 'ArrowUp' ? 1 : -1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const i = ordered.findIndex((l) => l.id === layer.id);
      const next = ordered[i + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) {
        dispatch({ type: 'select', selection: next.id });
        focusRow(next.id);
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(layer);
    } else if (e.key === 'F2') {
      e.preventDefault();
      setRenaming(layer.id);
    }
  };

  const onDragStart = (e: DragEvent, layer: Layer) => {
    setDragId(layer.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', layer.id);
  };

  const onDragOver = (e: DragEvent, displayIndex: number) => {
    if (!dragId) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropIndex(displayIndex + (after ? 1 : 0));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragId !== null && dropIndex !== null) {
      const from = ordered.findIndex((l) => l.id === dragId);
      // Convert the display slot (top-first) to a stack index (bottom-first).
      let slot = dropIndex;
      if (from < slot) slot -= 1;
      const toIndex = recipe.layers.length - 1 - slot;
      edit((r) => moveLayerTo(r, dragId, toIndex));
      track('layer_operation', { operation: 'move', layer_count: recipe.layers.length });
    }
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <aside className="panel layer-panel" aria-label="Layers">
      <div className="panel-head">
        <h2 className="panel-title">
          <Icon name="layers" />
          Layers
        </h2>
        <span className="muted small" title={`Up to ${RECIPE_LIMITS.maxLayers} layers per recipe`}>
          {recipe.layers.length}/{RECIPE_LIMITS.maxLayers}
        </span>
        <AddLayerMenu open={addMenuOpen} onOpenChange={onAddMenuOpenChange} onAdd={add} disabled={!canAdd} />
      </div>

      {recipe.layers.length === 0 ? (
        <div className="layer-empty">
          <p>No layers yet.</p>
          <p className="muted small">Start with a base color or a texture family.</p>
          {/* Opens the single "Add layer" menu in the panel header. */}
          <button type="button" className="btn btn-secondary btn-small" onClick={() => onAddMenuOpenChange(true)}>
            <Icon name="plus" />
            Add layer
          </button>
        </div>
      ) : (
        <ol ref={listRef} className="layer-list" onDragLeave={(e) => e.currentTarget === e.target && setDropIndex(null)} onDrop={onDrop}>
          {ordered.map((layer, displayIndex) => {
            const def = getLayerDefinition(layer.type);
            const selected = selection === layer.id;
            const stackIndex = recipe.layers.length - 1 - displayIndex;
            return (
              <li
                key={layer.id}
                data-layer-id={layer.id}
                className={`layer-row${selected ? ' selected' : ''}${!layer.enabled ? ' hidden-layer' : ''}${dragId === layer.id ? ' dragging' : ''}${
                  dropIndex === displayIndex ? ' drop-before' : ''
                }${dropIndex === displayIndex + 1 && displayIndex === ordered.length - 1 ? ' drop-after' : ''}`}
                draggable={renaming !== layer.id}
                onDragStart={(e) => onDragStart(e, layer)}
                onDragOver={(e) => onDragOver(e, displayIndex)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropIndex(null);
                }}
                onClick={() => dispatch({ type: 'select', selection: layer.id })}
              >
                <span className="drag-handle" aria-hidden="true" title="Drag to reorder">
                  <Icon name="grip" size={14} />
                </span>
                <LayerSwatch type={layer.type} />
                {renaming === layer.id ? (
                  <RenameInput
                    initial={layer.name}
                    onDone={(name) => {
                      setRenaming(null);
                      if (name !== null) {
                        edit((r) => renameLayer(r, layer.id, name));
                        track('layer_operation', { operation: 'rename', layer_count: recipe.layers.length });
                      }
                      focusRow(layer.id);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="layer-name-btn"
                    aria-pressed={selected}
                    aria-label={`${layer.name}, ${def?.label ?? 'unsupported'} layer${layer.enabled ? '' : ', hidden'}${
                      layer.opacity < 1 ? `, ${Math.round(layer.opacity * 100)}% opacity` : ''
                    }`}
                    title="Double-click or press F2 to rename. Alt+↑/↓ to reorder."
                    onDoubleClick={() => setRenaming(layer.id)}
                    onKeyDown={(e) => onRowKeyDown(e, layer)}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: 'select', selection: layer.id });
                    }}
                  >
                    <span className="layer-name">{layer.name}</span>
                    <span className="layer-meta">
                      {def ? def.label : 'Unsupported'}
                      {layer.opacity < 1 ? ` · ${Math.round(layer.opacity * 100)}%` : ''}
                      {layer.blendMode !== 'normal' ? ` · ${layer.blendMode}` : ''}
                    </span>
                  </button>
                )}
                {!def && (
                  <span className="layer-warning" title="This layer type is not supported by this version and is skipped when rendering.">
                    <Icon name="warning" size={14} label="Unsupported layer" />
                  </span>
                )}
                <button
                  type="button"
                  className="icon-btn icon-btn-small"
                  aria-pressed={!layer.enabled}
                  aria-label={layer.enabled ? `Hide ${layer.name}` : `Show ${layer.name}`}
                  title={layer.enabled ? 'Hide layer' : 'Show layer'}
                  onClick={(e) => {
                    e.stopPropagation();
                    edit((r) => setLayerEnabled(r, layer.id, !layer.enabled));
                    track('layer_operation', { operation: 'toggle', layer_count: recipe.layers.length });
                  }}
                >
                  <Icon name={layer.enabled ? 'eye' : 'eyeOff'} />
                </button>
                <Menu
                  label={`Actions for ${layer.name}`}
                  buttonClassName="icon-btn icon-btn-small"
                  items={[
                    { label: 'Rename', icon: 'pencil', hint: 'F2', onSelect: () => setRenaming(layer.id) },
                    {
                      label: 'Duplicate',
                      icon: 'copy',
                      disabled: !canAdd,
                      onSelect: () => {
                        const result = duplicateLayer(recipe, layer.id);
                        if (result.layerId) {
                          edit(() => result.recipe, { select: result.layerId });
                          track('layer_operation', { operation: 'duplicate', layer_count: result.recipe.layers.length });
                        }
                      },
                    },
                    { label: 'Move up', icon: 'chevronUp', hint: '⌥↑', disabled: stackIndex === recipe.layers.length - 1, onSelect: () => move(layer, 1) },
                    { label: 'Move down', icon: 'chevronDown', hint: '⌥↓', disabled: stackIndex === 0, onSelect: () => move(layer, -1) },
                    { label: 'Delete', icon: 'trash', hint: 'Del', danger: true, onSelect: () => remove(layer) },
                  ]}
                />
              </li>
            );
          })}
        </ol>
      )}

      <div className="panel-foot">
        <button
          type="button"
          className={`canvas-row${selection === 'canvas' ? ' selected' : ''}`}
          aria-pressed={selection === 'canvas'}
          onClick={() => dispatch({ type: 'select', selection: 'canvas' })}
        >
          <Icon name="frame" />
          <span>
            <span className="layer-name">Canvas & recipe</span>
            <span className="layer-meta">
              {recipe.canvas.width} × {recipe.canvas.height}
              {recipe.canvas.transparentBackground ? ' · transparent' : ''}
            </span>
          </span>
        </button>
        {!canAdd && <p className="muted small limit-note">Layer limit reached ({RECIPE_LIMITS.maxLayers}). Remove or merge layers to add more.</p>}
      </div>
    </aside>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      ref={ref}
      className="input layer-rename"
      value={value}
      aria-label="Layer name"
      maxLength={RECIPE_LIMITS.maxLayerNameLength}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(value.trim() ? value : null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(value.trim() ? value : null);
        if (e.key === 'Escape') finish(null);
      }}
    />
  );
}
