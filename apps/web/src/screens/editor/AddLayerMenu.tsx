import { FAMILY_LABELS, LAYER_DEFINITIONS, LAYER_TYPE_ORDER, RECIPE_LIMITS, type LayerType } from '@material-lab/engine';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';
import { LayerSwatch } from './LayerSwatch';

interface AddLayerMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (type: LayerType) => void;
  disabled: boolean;
}

/** "Add layer" button with a menu of supported layer types. */
export function AddLayerMenu({ open, onOpenChange, onAdd, disabled }: AddLayerMenuProps) {
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onOpenChange]);

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') {
      onOpenChange(false);
    }
  };

  const title = disabled ? `Recipes can have up to ${RECIPE_LIMITS.maxLayers} layers, to keep previews responsive.` : 'Add layer';

  return (
    <div className="menu-anchor">
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Add layer"
        title={title}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        <Icon name="plus" />
      </button>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label="Layer types" className="menu menu-left add-layer-menu" onKeyDown={onKeyDown}>
          {LAYER_TYPE_ORDER.map((type) => {
            const def = LAYER_DEFINITIONS[type];
            return (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="menu-item menu-item-rich"
                onClick={() => {
                  onOpenChange(false);
                  onAdd(type);
                  buttonRef.current?.focus();
                }}
              >
                <LayerSwatch type={type} />
                <span className="menu-item-text">
                  <span className="menu-item-title">
                    {def.label}
                    {def.family && def.label !== FAMILY_LABELS[def.family] && <span className="muted"> · {FAMILY_LABELS[def.family]}</span>}
                  </span>
                  <span className="menu-item-desc">{def.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
