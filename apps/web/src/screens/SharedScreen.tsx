import { ENGINE_VERSION, FAMILY_LABELS, type FamilyId, type Recipe } from '@material-lab/engine';
import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { Icon } from '../components/Icon';
import { RecipeThumb } from '../components/RecipeThumb';
import { useToast } from '../components/Toasts';
import { track } from '../lib/analytics';
import { api, apiUrl, ApiRequestError } from '../lib/api';
import { formatRelative } from '../lib/format';
import { asNewRecipe, saveRecipe, uniqueName } from '../lib/library';
import { routeHref } from '../lib/router';

interface SharedRecipe {
  share: { access: 'view' | 'duplicate'; createdAt: string; expiresAt: string | null };
  sharedBy: { kind: 'user' | 'team'; name: string };
  recipe: {
    name: string;
    family: string;
    version: number;
    updatedAt: string;
    engineVersion: string;
    canvas: { width: number; height: number; transparentBackground: boolean };
    seamless: boolean;
    layers: { type: string; name: string; supported: boolean }[];
  };
  previewUrl: string;
  fullRecipe: Recipe | null;
}

const FAILURES: Record<string, { title: string; body: string }> = {
  share_not_found: { title: 'Link not found', body: 'This link does not exist. Check that it was copied completely, or ask for a new one.' },
  share_revoked: { title: 'Link turned off', body: 'The person who shared this recipe turned the link off. Ask them for a new link if you still need it.' },
  share_expired: { title: 'Link expired', body: 'This link has expired. Ask the person who shared it for a new one.' },
  recipe_deleted: { title: 'Recipe deleted', body: 'The recipe behind this link was deleted, so it can no longer be viewed.' },
  not_configured: { title: 'Shared links unavailable', body: 'This version of Material Lab is not connected to an account server, so it cannot open shared links.' },
};

const major = (v: string) => Number(v.split('.')[0]);

/** Read-only view of a shared recipe (PRD flow M). Duplicating creates a new, independent recipe. */
export function SharedScreen({ token }: { token: string | null }) {
  const { openRecipe } = useApp();
  const toast = useToast();
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; data: SharedRecipe } | { status: 'error'; code: string; message: string }>({
    status: 'loading',
  });

  useEffect(() => {
    if (!token) return setState({ status: 'error', code: 'share_not_found', message: '' });
    const controller = new AbortController();
    setState({ status: 'loading' });
    api<SharedRecipe>('GET', `/v1/shared/${encodeURIComponent(token)}`, { auth: false, signal: controller.signal }).then(
      (data) => {
        setState({ status: 'ready', data });
        track('shared_recipe_opened', { access: data.share.access });
      },
      (e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({ status: 'error', code: e instanceof ApiRequestError ? e.code : 'unknown', message: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => controller.abort();
  }, [token]);

  if (state.status === 'loading') return <div className="page narrow"><p className="muted">Opening shared recipe…</p></div>;
  if (state.status === 'error') {
    const f = FAILURES[state.code] ?? { title: 'Could not open this link', body: state.message };
    return (
      <div className="page narrow">
        <div className="empty-state">
          <Icon name="warning" size={28} />
          <h1>{f.title}</h1>
          <p className="muted">{f.body}</p>
          <a className="btn btn-primary" href={routeHref('explore')}>
            Browse presets instead
          </a>
        </div>
      </div>
    );
  }

  const { data } = state;
  const r = data.recipe;
  const unsupported = r.layers.filter((l) => !l.supported);
  const newer = major(r.engineVersion) > major(ENGINE_VERSION);
  const preview = apiUrl(`${data.previewUrl}?width=800`);
  const familyLabel = r.family in FAMILY_LABELS ? FAMILY_LABELS[r.family as FamilyId] : 'Custom';

  const duplicate = async (open: boolean) => {
    if (!data.fullRecipe) return;
    const copy = asNewRecipe(data.fullRecipe, uniqueName(data.fullRecipe.name));
    copy.metadata.tags = [...(copy.metadata.tags ?? []), 'shared'];
    try {
      await saveRecipe(copy);
      toast.show(`Saved “${copy.name}” to My Recipes`, { tone: 'success' });
      if (open) openRecipe(copy, 'shared', true);
    } catch {
      toast.show('Could not save the copy on this device.', { tone: 'error' });
    }
  };

  return (
    <div className="page shared">
      <header className="page-head">
        <div>
          <p className="eyebrow">Shared recipe · read-only</p>
          <h1>{r.name}</h1>
          <p className="muted">
            Shared by {data.sharedBy.kind === 'team' ? `the team “${data.sharedBy.name}”` : data.sharedBy.name} · updated {formatRelative(r.updatedAt)}
            {data.share.expiresAt ? ` · link expires ${formatRelative(data.share.expiresAt)}` : ''}
          </p>
        </div>
        {data.share.access === 'duplicate' && (
          <div className="button-row">
            <button type="button" className="btn btn-primary" onClick={() => void duplicate(true)}>
              <Icon name="copy" />
              Duplicate to my recipes
            </button>
          </div>
        )}
      </header>
      <div className="shared-layout">
        <div className="shared-preview">
          {data.fullRecipe ? (
            <RecipeThumb recipe={data.fullRecipe} width={960} label={`Preview of ${r.name}`} />
          ) : preview ? (
            <img src={preview} alt={`Preview of ${r.name}`} width={r.canvas.width} height={r.canvas.height} />
          ) : null}
        </div>
        <aside className="card stack shared-details">
          <dl className="meta-list">
            <div>
              <dt>Family</dt>
              <dd>{familyLabel}</dd>
            </div>
            <div>
              <dt>Canvas</dt>
              <dd>
                {r.canvas.width} × {r.canvas.height}
                {r.canvas.transparentBackground ? ', transparent' : ''}
                {r.seamless ? ', seamless tile' : ''}
              </dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>{r.engineVersion}</dd>
            </div>
          </dl>
          <div>
            <h2 className="small-heading">Layers (bottom to top)</h2>
            <ol className="layer-summary">
              {r.layers.map((l, i) => (
                <li key={i} className={l.supported ? '' : 'unsupported'}>
                  {l.name} <span className="muted small">{l.type}</span>
                </li>
              ))}
            </ol>
          </div>
          {(unsupported.length > 0 || newer) && (
            <p className="callout callout-warning compact">
              <Icon name="warning" />
              {newer
                ? `Made with a newer engine (${r.engineVersion}); some settings may look different here.`
                : `${unsupported.length} layer type${unsupported.length === 1 ? ' is' : 's are'} not supported in this version and will be skipped.`}
            </p>
          )}
          {data.share.access === 'duplicate' ? (
            <p className="muted small">Duplicating saves an independent copy on this device. The original stays unchanged.</p>
          ) : (
            <p className="muted small">The person who shared this allowed viewing only, so the recipe’s settings are not included.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
