import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { clearExportLog, removeExportRecord, useExportLog, type ExportRecord } from '../lib/exports-log';
import { formatBytes, formatDateTime, formatDuration, formatRelative } from '../lib/format';
import { routeHref } from '../lib/router';
import { setPendingExport } from './editor/handoff';

export function ExportsScreen() {
  const records = useExportLog();
  const { openRecipe } = useApp();

  const reopen = (record: ExportRecord, retry: boolean) => {
    if (retry) setPendingExport(record.settings);
    openRecipe(record.recipe, 'export-log', false);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Exports</h1>
          <p className="muted">
            Details of recent exports on this device — the images themselves are not stored. Each entry keeps the recipe snapshot, so you can recreate it.
          </p>
        </div>
        {records && records.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => void clearExportLog()}>
            Clear history
          </button>
        )}
      </header>

      {records === null ? (
        <p className="muted">Loading…</p>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <Icon name="image" size={28} />
          <h2>No exports yet</h2>
          <p className="muted">When you export a PNG or JPEG, its dimensions, file size, seed and recipe are listed here.</p>
          <a className="btn btn-primary" href={routeHref('explore')}>
            Make your first texture
          </a>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Recipe</th>
                <th scope="col">Size</th>
                <th scope="col">Details</th>
                <th scope="col">When</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className={r.status === 'failed' ? 'row-failed' : undefined}>
                  <td>
                    <span className="cell-title">
                      {r.status === 'failed' ? (
                        <span className="status-pill danger">
                          <Icon name="warning" size={12} /> Failed
                        </span>
                      ) : (
                        <span className="status-pill success">
                          <Icon name="check" size={12} /> Done
                        </span>
                      )}
                      {r.filename}
                    </span>
                    {r.error && <span className="cell-sub">{r.error}</span>}
                  </td>
                  <td>
                    <span className="cell-title">{r.recipeName}</span>
                    <span className="cell-sub">
                      seed {r.seed} · engine {r.engineVersion}
                    </span>
                  </td>
                  <td>
                    {r.width} × {r.height}
                    <span className="cell-sub">
                      {r.format.toUpperCase()}
                      {r.scale > 1 ? ` · ${r.scale}×` : ''}
                    </span>
                  </td>
                  <td>
                    {r.fileSize !== undefined ? formatBytes(r.fileSize) : '—'}
                    {r.durationMs !== undefined && <span className="cell-sub">{formatDuration(r.durationMs)}</span>}
                  </td>
                  <td title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</td>
                  <td className="cell-actions">
                    {r.status === 'failed' ? (
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => reopen(r, true)}>
                        Retry
                      </button>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => reopen(r, true)} title="Open the recipe and export again with the same settings">
                        Export again
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-small" onClick={() => reopen(r, false)}>
                      Open recipe
                    </button>
                    <button type="button" className="icon-btn icon-btn-small" aria-label={`Remove ${r.filename} from history`} onClick={() => void removeExportRecord(r.id)}>
                      <Icon name="close" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
