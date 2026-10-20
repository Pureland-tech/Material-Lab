import type { ExportFormat } from '@material-lab/engine';
import { Observable, useObservable } from './store';

export type Theme = 'system' | 'light' | 'dark';
export type PreviewQuality = 'draft' | 'standard' | 'high';

export interface ExportDefaultsSetting {
  format: ExportFormat;
  /** null means "use the recipe canvas size". */
  width: number | null;
  height: number | null;
  scale: number;
}

export interface Settings {
  theme: Theme;
  previewQuality: PreviewQuality;
  exportDefaults: ExportDefaultsSetting;
}

/** Maximum preview pixels per quality level. */
export const PREVIEW_BUDGET: Record<PreviewQuality, number> = {
  draft: 350_000,
  standard: 1_000_000,
  high: 2_400_000,
};

export const PREVIEW_QUALITY_LABELS: Record<PreviewQuality, string> = {
  draft: 'Draft (fastest)',
  standard: 'Standard',
  high: 'High (slower)',
};

const DEFAULTS: Settings = {
  theme: 'system',
  previewQuality: 'standard',
  exportDefaults: { format: 'png', width: null, height: null, scale: 1 },
};

const KEY = 'material-lab:settings';

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const theme: Theme = parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system';
    const previewQuality: PreviewQuality =
      parsed.previewQuality === 'draft' || parsed.previewQuality === 'high' ? parsed.previewQuality : 'standard';
    const ex = parsed.exportDefaults ?? DEFAULTS.exportDefaults;
    const side = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 16 && v <= 8192 ? v : null);
    return {
      theme,
      previewQuality,
      exportDefaults: {
        format: ex.format === 'jpeg' ? 'jpeg' : 'png',
        width: side(ex.width),
        height: side(ex.height),
        scale: [1, 2, 3, 4].includes(ex.scale) ? ex.scale : 1,
      },
    };
  } catch {
    return DEFAULTS;
  }
}

const settings = new Observable<Settings>(typeof localStorage === 'undefined' ? DEFAULTS : read());

export function getSettings(): Settings {
  return settings.get();
}

export function updateSettings(patch: Partial<Settings>): void {
  const next = { ...settings.get(), ...patch };
  settings.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the setting still applies for this session.
  }
}

export function useSettings(): Settings {
  return useObservable(settings);
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
