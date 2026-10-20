import { normalizeHex } from '@material-lab/engine';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface FieldShellProps {
  id: string;
  label: string;
  help?: string;
  error?: string | null;
  onReset?: () => void;
  resetLabel?: string;
  children: ReactNode;
  inline?: boolean;
}

/** Label row (with optional reset) + control + help/error text. */
export function FieldShell({ id, label, help, error, onReset, resetLabel, children, inline }: FieldShellProps) {
  return (
    <div className={`field${inline ? ' field-inline' : ''}${error ? ' field-invalid' : ''}`}>
      <div className="field-label-row">
        <label htmlFor={id} className="field-label" title={help}>
          {label}
          {help && (
            <span className="field-help-icon" aria-hidden="true">
              <Icon name="info" size={12} />
            </span>
          )}
        </label>
        {onReset && (
          <button type="button" className="icon-btn icon-btn-small field-reset" onClick={onReset} aria-label={resetLabel ?? `Reset ${label}`} title="Reset to default">
            <Icon name="reset" size={13} />
          </button>
        )}
      </div>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : help ? (
        <p className="sr-only" id={`${id}-help`}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** `%` displays and accepts 0–100 for stored 0–1 values. */
  unit?: string;
  integer?: boolean;
  onChange: (value: number) => void;
  onReset?: () => void;
  help?: string;
  disabled?: boolean;
  /** Hide the slider (numeric entry only). */
  noSlider?: boolean;
}

function decimalsFor(step: number): number {
  const s = String(step);
  return s.includes('.') ? (s.split('.')[1]?.length ?? 0) : 0;
}

/** Slider paired with a numeric input; invalid typed values are explained and never applied. */
export function NumberField({ label, value, min, max, step, unit, integer, onChange, onReset, help, disabled, noSlider }: NumberFieldProps) {
  const id = useId();
  const percent = unit === '%';
  const k = percent ? 100 : 1;
  const displayStep = percent ? Math.max(1, step * 100) : step;
  const decimals = percent ? Math.max(0, decimalsFor(step * 100)) : integer ? 0 : decimalsFor(step);
  const display = (v: number) => (v * k).toFixed(decimals).replace(/\.0+$/, '');
  const formatted = display(value);
  const [text, setText] = useState(formatted);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // Follow external changes (slider, undo) unless the user is typing.
  useEffect(() => {
    if (!editing) setText(formatted);
  }, [formatted, editing]);

  // A new value (from any source) makes an earlier entry error obsolete.
  useEffect(() => setError(null), [formatted]);

  const commitText = () => {
    setEditing(false);
    const parsed = Number(text.trim().replace(',', '.').replace(/%$/, ''));
    const lo = min * k;
    const hi = max * k;
    if (text.trim() === '' || !Number.isFinite(parsed)) {
      setError(`Enter a number between ${display(min)} and ${display(max)}${unit && unit !== '×' ? ` ${unit}` : ''}.`);
      setText(display(value));
      return;
    }
    if (parsed < lo || parsed > hi) {
      setError(`${label} must be between ${display(min)} and ${display(max)}${unit && unit !== '×' ? ` ${unit}` : ''}.`);
      setText(display(value));
      return;
    }
    setError(null);
    let v = parsed / k;
    if (integer) v = Math.round(v);
    if (v !== value) onChange(v);
    setText(display(v));
  };

  return (
    <FieldShell id={id} label={label} help={help} error={error} onReset={onReset}>
      <div className="number-field">
        {!noSlider && (
          <input
            type="range"
            className="slider"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            aria-label={label}
            aria-valuetext={`${display(value)}${unit ?? ''}`}
            onChange={(e) => {
              setError(null);
              onChange(Number(e.target.value));
            }}
          />
        )}
        <div className="number-input-wrap">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            className="input number-input"
            value={text}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
            onFocus={() => setEditing(true)}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setText(display(value));
                setError(null);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const delta = (e.key === 'ArrowUp' ? 1 : -1) * displayStep * (e.shiftKey ? 10 : 1);
                const next = Math.min(max, Math.max(min, (value * k + delta) / k));
                onChange(integer ? Math.round(next) : Number(next.toFixed(6)));
                setText(display(next));
              }
            }}
          />
          {unit && <span className="number-unit">{unit}</span>}
        </div>
      </div>
    </FieldShell>
  );
}

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  onReset?: () => void;
  help?: string;
}

export function ColorField({ label, value, onChange, onReset, help }: ColorFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(value), [value]);

  const commit = () => {
    const hex = normalizeHex(text);
    if (!hex) {
      setError('Enter a hex color such as #E8D9BD.');
      setText(value);
      return;
    }
    setError(null);
    if (hex !== value) onChange(hex);
    setText(hex);
  };

  return (
    <FieldShell id={id} label={label} help={help} error={error} onReset={onReset}>
      <div className="color-field">
        <input
          type="color"
          className="color-swatch"
          value={value.toLowerCase()}
          aria-label={`${label} picker`}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <input
          id={id}
          type="text"
          className="input color-hex"
          value={text}
          spellCheck={false}
          maxLength={7}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
    </FieldShell>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  help?: string;
  disabled?: boolean;
  description?: string;
}

export function Toggle({ label, checked, onChange, help, disabled, description }: ToggleProps) {
  const id = useId();
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <span id={id} className="field-label" title={help}>
          {label}
        </span>
        {description && <span className="toggle-description">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        className="switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  hideLabel?: boolean;
}

export function Segmented<T extends string | number>({ label, value, options, onChange, hideLabel }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div className="field">
      <span id={id} className={hideLabel ? 'sr-only' : 'field-label'}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? 'active' : ''}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  onReset?: () => void;
  help?: string;
}

export function SelectField({ label, value, options, onChange, onReset, help }: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} help={help} onReset={onReset}>
      <select id={id} className="input select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
