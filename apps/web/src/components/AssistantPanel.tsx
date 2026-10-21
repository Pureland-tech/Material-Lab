import { SUGGESTION_LIMITS, suggestLocally, type RecipeSuggestion } from '@material-lab/engine';
import { useId, useState } from 'react';
import { useApp } from '../AppContext';
import { useAccount } from '../lib/account';
import { track } from '../lib/analytics';
import { api, apiBase, ApiRequestError } from '../lib/api';
import { routeHref } from '../lib/router';
import { updateSettings, useSettings } from '../lib/settings';
import { Icon } from './Icon';
import { RecipeThumb } from './RecipeThumb';

type Mode = 'local' | 'ai';

const EXAMPLES = ['warm recycled paper with subtle dark fibers', 'frosted glass over a sunset gradient', 'fine film grain on cream', 'brushed gold metal'];

/**
 * “Describe a texture” (PRD FR-080–FR-084). Built-in suggestions run on this
 * device. The optional AI mode sends only the description, with explicit
 * consent, and always returns an editable recipe the user reviews first.
 */
export function AssistantPanel() {
  const { openRecipe } = useApp();
  const accountState = useAccount();
  const settings = useSettings();
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<Mode>('local');
  const [consent, setConsent] = useState(settings.aiConsent);
  const [remember, setRemember] = useState(settings.aiConsent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ suggestion: RecipeSuggestion; notice: string | null } | null>(null);
  const inputId = useId();
  const consentId = useId();

  const server = apiBase();
  const signedIn = accountState.status === 'signed-in';
  const aiOffered = accountState.entitlements?.features.aiSuggestions ?? false;
  const aiReady = server !== null && signedIn && aiOffered;
  const text = prompt.trim();
  const tooShort = text.length < SUGGESTION_LIMITS.minPromptLength;

  const suggest = async (useMode: Mode) => {
    setError(null);
    if (tooShort) return setError(`Describe the texture in at least ${SUGGESTION_LIMITS.minPromptLength} characters.`);
    track('suggestion_requested', { source: useMode });
    if (useMode === 'local') {
      setResult({ suggestion: suggestLocally(text), notice: null });
      return;
    }
    if (!consent) return setError('Tick the box to allow sending your description, or use built-in suggestions.');
    if (remember !== settings.aiConsent) updateSettings({ aiConsent: remember });
    setBusy(true);
    try {
      const res = await api<{ suggestion: RecipeSuggestion; notice: string | null }>('POST', '/v1/ai/recipe-suggestion', { body: { prompt: text, consent: true } });
      setResult(res);
    } catch (e) {
      const message = e instanceof ApiRequestError ? e.message : 'The suggestion could not be made.';
      setError(`${message} Built-in suggestions still work.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section assistant" aria-labelledby="assistant-title">
      <div className="section-head">
        <h2 id="assistant-title">Describe a texture</h2>
      </div>
      <div className="assistant-body">
        <form
          className="assistant-form stack"
          onSubmit={(e) => {
            e.preventDefault();
            void suggest(mode);
          }}
        >
          <label className="field-label" htmlFor={inputId}>
            What should it look like?
          </label>
          <textarea
            id={inputId}
            className="input textarea"
            rows={2}
            maxLength={SUGGESTION_LIMITS.maxPromptLength}
            placeholder={EXAMPLES[0]}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="chips" role="group" aria-label="Examples">
            {EXAMPLES.slice(1).map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => setPrompt(ex)}>
                {ex}
              </button>
            ))}
          </div>
          <fieldset className="assistant-modes">
            <legend className="field-label">Suggest with</legend>
            <label className="radio-row">
              <input type="radio" name="assistant-mode" checked={mode === 'local'} onChange={() => setMode('local')} />
              <span>
                <strong>Built-in suggestions</strong>
                <span className="muted small"> — instant, on this device, nothing is sent anywhere</span>
              </span>
            </label>
            <label className={`radio-row${aiReady ? '' : ' disabled'}`}>
              <input type="radio" name="assistant-mode" checked={mode === 'ai'} disabled={!aiReady} onChange={() => setMode('ai')} />
              <span>
                <strong>AI suggestions (Claude)</strong>
                <span className="muted small">
                  {' '}
                  —{' '}
                  {!server ? (
                    'not available in this version'
                  ) : !signedIn ? (
                    <>
                      needs an account. <a href={routeHref('account')}>Sign in</a>
                    </>
                  ) : !aiOffered ? (
                    'not enabled on this server'
                  ) : (
                    'reads your description and picks layers and settings'
                  )}
                </span>
              </span>
            </label>
          </fieldset>
          {mode === 'ai' && aiReady && (
            <div className="callout callout-info compact consent">
              <Icon name="info" />
              <div className="stack-tight">
                <label className="check-row" htmlFor={consentId}>
                  <input id={consentId} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>
                    Send this description to Anthropic’s Claude through the Material Lab server. Only the text above is sent — never your recipes, images or files.
                  </span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>Remember this choice on this device (change it in Settings)</span>
                </label>
              </div>
            </div>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Icon name="sparkles" />
              {busy ? 'Suggesting…' : 'Suggest a recipe'}
            </button>
            {error && mode === 'ai' && (
              <button type="button" className="btn btn-ghost" onClick={() => void suggest('local')}>
                Use built-in suggestion
              </button>
            )}
          </div>
        </form>

        {result && (
          <div className="assistant-result" aria-live="polite">
            <RecipeThumb recipe={result.suggestion.recipe} width={420} label={`Preview of the suggested recipe ${result.suggestion.recipe.name}`} />
            <div className="stack-tight">
              <p>
                <strong>{result.suggestion.recipe.name}</strong>{' '}
                <span className="badge">{result.suggestion.source === 'ai' ? 'AI suggestion' : 'Built-in suggestion'}</span>
              </p>
              <p className="muted small">{result.suggestion.summary}</p>
              {result.notice && <p className="callout callout-warning compact small">{result.notice}</p>}
              {result.suggestion.notes.length > 0 && (
                <ul className="bullet-list small">
                  {result.suggestion.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {result.suggestion.choices.length > 0 && (
                <details className="choices">
                  <summary>Settings it chose ({result.suggestion.choices.length})</summary>
                  <table className="choice-table">
                    <thead>
                      <tr>
                        <th scope="col">Layer</th>
                        <th scope="col">Setting</th>
                        <th scope="col">Value</th>
                        <th scope="col">Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.suggestion.choices.map((c) => (
                        <tr key={`${c.layerId}:${c.param}`}>
                          <td>{c.layerName}</td>
                          <td>{c.label}</td>
                          <td>{c.value}</td>
                          <td className="muted">{c.defaultValue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    track('suggestion_opened', { source: result.suggestion.source });
                    openRecipe(result.suggestion.recipe, 'suggestion', false);
                  }}
                >
                  Open in editor
                </button>
                <span className="muted small">Every setting stays editable. Nothing is saved until you save it.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
