import type { ExportSettings } from '@material-lab/engine';

/**
 * Export settings handed from the Exports page to the editor ("Retry" on a
 * failed export): the editor opens the export dialog with them once.
 */
let pending: ExportSettings | null = null;

export function setPendingExport(settings: ExportSettings): void {
  pending = settings;
}

export function takePendingExport(): ExportSettings | null {
  const value = pending;
  pending = null;
  return value;
}
