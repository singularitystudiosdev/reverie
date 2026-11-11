/**
 * Claude, through the official Anthropic SDK. Three jobs:
 *   - chat: a reply in the persona's voice. The persona prompt is the cached
 *     system block (stable per persona version), so every user of that
 *     version reads it from cache.
 *   - author: structured JSON (persona edits, new personas, the manipulation
 *     judge) via output_config.format json_schema.
 * Requests opt into server-side refusal fallbacks (`fallbacks: "default"`,
 * beta server-side-fallback-2026-07-01): if the model declines, the API
 * re-runs the request on a fallback model inside the same call.
 *
 * Without credentials (`cfg.llm.enabled` false) every method returns null and
 * callers use their offline paths (scripted replies on the client, heuristic
 * edits, template personas), so the whole loop runs and tests offline.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.ts';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface Llm {
  readonly enabled: boolean;
  chat(system: string, history: ChatTurn[]): Promise<string | null>;
  json<T>(system: string, prompt: string, schema: Record<string, unknown>, maxTokens?: number): Promise<T | null>;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function makeLlm(cfg: Config): Llm {
  if (!cfg.llm.enabled) return offlineLlm;
  const client = new Anthropic();
  const model = cfg.llm.model;

  const textOf = (msg: Anthropic.Beta.BetaMessage): string | null => {
    if (msg.stop_reason === 'refusal') return null;
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return text || null;
  };

  return {
    enabled: true,

    async chat(system, history) {
      try {
        const msg = await client.beta.messages.create({
          model,
          max_tokens: 2048,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          output_config: { effort: cfg.llm.chatEffort },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: history.slice(-40),
        });
        return textOf(msg);
      } catch (e) {
        logApiError('chat', e);
        return null;
      }
    },

    async json<T>(system: string, prompt: string, schema: Record<string, unknown>, maxTokens = 16000) {
      try {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: maxTokens,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          output_config: { effort: cfg.llm.authorEffort, format: { type: 'json_schema', schema } },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: prompt }],
        });
        const msg = await stream.finalMessage();
        const text = textOf(msg);
        return text ? (JSON.parse(text) as T) : null;
      } catch (e) {
        logApiError('json', e);
        return null;
      }
    },
  };
}

function logApiError(where: string, e: unknown): void {
  if (e instanceof Anthropic.RateLimitError) console.warn(`[llm:${where}] rate limited`);
  else if (e instanceof Anthropic.AuthenticationError) console.warn(`[llm:${where}] authentication failed: check ANTHROPIC_API_KEY`);
  else if (e instanceof Anthropic.BadRequestError) console.warn(`[llm:${where}] bad request: ${e.message}`);
  else if (e instanceof Anthropic.APIError) console.warn(`[llm:${where}] API error ${e.status}: ${e.message}`);
  else if (e instanceof SyntaxError) console.warn(`[llm:${where}] response was not valid JSON`);
  else console.warn(`[llm:${where}]`, e);
}

export const offlineLlm: Llm = {
  enabled: false,
  chat: async () => null,
  json: async () => null,
};
