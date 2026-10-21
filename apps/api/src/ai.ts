import Anthropic from '@anthropic-ai/sdk';
import { textureSpecInstructions, textureSpecSchema } from '@material-lab/engine';
import type { Config } from './config';

/** Produces an untrusted TextureSpec for a description; the caller validates it. */
export interface Suggester {
  suggest(prompt: string, signal?: AbortSignal): Promise<unknown>;
}

export type AiFailure = 'refused' | 'incomplete' | 'invalid_output' | 'rate_limited' | 'unavailable';

export class AiError extends Error {
  constructor(
    readonly reason: AiFailure,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/**
 * Suggester backed by Claude. Structured outputs constrain the reply to the
 * engine's TextureSpec schema; the server still validates and clamps it.
 * Only the user's description is sent — never recipes, images or account data.
 */
export function createClaudeSuggester(config: Config['ai']): Suggester {
  const client = new Anthropic({ timeout: config.timeoutMs, maxRetries: 1 });
  const schema = textureSpecSchema();
  const instructions = textureSpecInstructions();
  return {
    async suggest(prompt, signal) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create(
          {
            model: config.model,
            max_tokens: 16000,
            // On a policy decline, retry server-side on the recommended fallback model.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: config.effort, format: { type: 'json_schema', schema } },
            system: [{ type: 'text', text: instructions, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: `Texture description: ${prompt}` }],
          },
          { signal },
        );
      } catch (error) {
        if (error instanceof Anthropic.RateLimitError) throw new AiError('rate_limited', 'The AI service is busy.');
        if (error instanceof Anthropic.APIUserAbortError) throw error;
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new AiError('unavailable', 'The AI service timed out.');
        if (error instanceof Anthropic.APIError) throw new AiError('unavailable', `The AI service returned an error (${error.status ?? 'network'}).`);
        throw error;
      }
      if (response.stop_reason === 'refusal') throw new AiError('refused', 'The AI service declined this description.');
      if (response.stop_reason === 'max_tokens') throw new AiError('incomplete', 'The AI reply was cut short.');
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AiError('invalid_output', 'The AI reply was not a usable recipe.');
      }
    },
  };
}
