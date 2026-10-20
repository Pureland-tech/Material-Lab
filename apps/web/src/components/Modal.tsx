import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ModalProps {
  open: boolean;
  title: string;
  /** Called on Escape, the close button, or a click on the backdrop. */
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'small' | 'medium' | 'large';
  /** Prevent closing (e.g. while an export is running). */
  dismissible?: boolean;
  description?: string;
}

/**
 * Accessible modal built on the native <dialog>: focus moves into the dialog,
 * stays there, and returns to the element that opened it on close.
 */
export function Modal({ open, title, onClose, children, footer, size = 'medium', dismissible = true, description }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      // Focus the first field or the primary action rather than the close button.
      const target = dialog.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea, .btn-primary');
      target?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocus.current?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onMouseDown={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="modal-body-wrap">
          <header className="modal-header">
            <h2 id={titleId}>{title}</h2>
            {dismissible && (
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
                <Icon name="close" />
              </button>
            )}
          </header>
          {description && (
            <p id={descId} className="modal-description">
              {description}
            </p>
          )}
          <div className="modal-content">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
