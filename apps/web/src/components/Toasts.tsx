import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  actions?: ToastAction[];
}

interface ToastApi {
  show: (message: string, options?: { tone?: Toast['tone']; actions?: ToastAction[]; duration?: number }) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback<ToastApi['show']>(
    (message, options = {}) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-3), { id, message, tone: options.tone ?? 'info', actions: options.actions }]);
      const duration = options.duration ?? (options.actions?.length ? 8000 : 4000);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === 'error' ? 'warning' : t.tone === 'success' ? 'check' : 'info'} />
            <span className="toast-message">{t.message}</span>
            {t.actions?.map((a) => (
              <button
                key={a.label}
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => {
                  dismiss(t.id);
                  a.onClick();
                }}
              >
                {a.label}
              </button>
            ))}
            <button type="button" className="icon-btn icon-btn-small" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
