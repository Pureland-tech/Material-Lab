import { SUGGESTION_LIMITS, suggestionFromSpec, suggestLocally, type RecipeSuggestion } from '@material-lab/engine';
import { AiError } from '../ai';
import { limit, requireUser, type Services } from '../context';
import { ApiError, requireObject, stringField, type Router } from '../http';
import { planFor } from '../plans';

const FALLBACK_NOTICE: Record<string, string> = {
  off: 'AI suggestions are not enabled on this server, so this uses Material Lab’s built-in keyword matching.',
  quota: 'You have used today’s AI suggestions, so this uses Material Lab’s built-in keyword matching.',
  refused: 'The AI service declined this description, so this uses Material Lab’s built-in keyword matching.',
  failed: 'The AI service was unavailable, so this uses Material Lab’s built-in keyword matching.',
};

/**
 * POST /v1/ai/recipe-suggestion — optional text-to-recipe (FR-080–FR-084).
 * Requires explicit consent per request because the description is sent to a
 * third-party AI service. Always returns an editable recipe: when AI is off,
 * over quota or failing, the deterministic local matcher answers instead.
 */
export function registerAssistantRoutes(router: Router, s: Services): void {
  router.add('POST', '/v1/ai/recipe-suggestion', async (req) => {
    const user = requireUser(s, req);
    limit(s, 'ai', user.id);
    const body = requireObject(await req.body());
    const prompt = stringField(body, 'prompt', { min: SUGGESTION_LIMITS.minPromptLength, max: SUGGESTION_LIMITS.maxPromptLength, label: 'Description' }) as string;
    if (body.consent !== true) {
      throw new ApiError(400, 'consent_required', 'Confirm that your description may be sent to the AI service, or use the built-in suggestions instead.');
    }
    const local = (reason: keyof typeof FALLBACK_NOTICE): { suggestion: RecipeSuggestion; notice: string } => ({
      suggestion: suggestLocally(prompt),
      notice: FALLBACK_NOTICE[reason] as string,
    });
    if (!s.suggester) return { body: local('off') };

    const day = new Date().toISOString().slice(0, 10);
    const used = (s.db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(user.id, day) as { count: number } | undefined)?.count ?? 0;
    if (used >= planFor(user.plan).aiSuggestionsPerDay) return { body: local('quota') };
    s.db
      .prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1')
      .run(user.id, day);

    try {
      const spec = await s.suggester.suggest(prompt);
      return { body: { suggestion: suggestionFromSpec(spec), notice: null } };
    } catch (error) {
      // Invalid model output (recipeFromSpec throws a plain Error) also falls back.
      if (error instanceof AiError && error.reason === 'refused') return { body: local('refused') };
      console.warn(`[ai] suggestion fell back to local: ${error instanceof Error ? error.message : String(error)}`);
      return { body: local('failed') };
    }
  });
}
