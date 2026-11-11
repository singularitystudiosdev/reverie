/**
 * A chat turn: record the user's message, answer in the persona's voice from
 * its markdown (or the experiment variant this user is assigned to), record
 * the reply with its drop-pattern features.
 *
 * Crisis language short-circuits to a fixed, caring reply with crisis
 * resources and a logged referral (California SB 243 style protocol), never a
 * model improvisation. With no LLM configured the server returns no reply and
 * the client answers from its local scripted voice, then reports that reply
 * as a `message` event so telemetry is identical either way.
 */
import type { Ctx } from './context.ts';
import { effectivePersona } from './experiments/engine.ts';
import type { ChatTurn } from './llm/claude.ts';
import { systemPrompt } from './personas/prompt.ts';
import { CRISIS_REPLY } from './personas/safety.ts';
import { appendEvent, convId, recordMessage } from './telemetry/ingest.ts';

export interface ChatResult {
  messages: string[];
  source: 'llm' | 'offline' | 'crisis';
  version: number | null;
  arm: string | null;
}

export async function chatTurn(ctx: Ctx, userId: string, personaId: string, text: string): Promise<ChatResult> {
  const persona = ctx.personas.get(personaId);
  if (!persona) throw new Error(`unknown persona ${personaId}`);
  const ts = ctx.now();
  const body = text.slice(0, 4000);
  appendEvent(ctx, userId, 'message', personaId, { from: 'user', text: body, via: 'chat' }, ts);
  const flags = recordMessage(ctx, userId, personaId, 'user', body, ts);

  if (flags.crisis) {
    appendEvent(ctx, userId, 'message', personaId, { from: 'persona', text: CRISIS_REPLY, via: 'crisis' }, ctx.now());
    recordMessage(ctx, userId, personaId, 'persona', CRISIS_REPLY, ctx.now());
    ctx.db.prepare('INSERT INTO safety_events (ts, user_id, conv_id, kind) VALUES (?, ?, ?, ?)').run(ctx.now(), userId, convId(userId, personaId), 'crisis_referral');
    return { messages: [CRISIS_REPLY], source: 'crisis', version: persona.meta.version, arm: null };
  }

  const eff = effectivePersona(ctx, userId, personaId);
  if (!eff || !ctx.llm.enabled) return { messages: [], source: 'offline', version: persona.meta.version, arm: eff?.arm ?? null };

  const rows = ctx.db
    .prepare('SELECT role, text FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT 40')
    .all(convId(userId, personaId)) as { role: string; text: string }[];
  const history: ChatTurn[] = [];
  for (const r of rows.reverse()) {
    const role = r.role === 'user' ? 'user' : 'assistant';
    const last = history[history.length - 1];
    if (last && last.role === role) last.content += `\n${r.text}`;
    else history.push({ role, content: r.text });
  }
  while (history.length && history[0].role !== 'user') history.shift();

  const reply = await ctx.llm.chat(systemPrompt(eff.persona), history);
  if (!reply) return { messages: [], source: 'offline', version: persona.meta.version, arm: eff.arm };
  const parts = reply
    .split(/\n?\|\|\n?/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const part of parts) {
    appendEvent(ctx, userId, 'message', personaId, { from: 'persona', text: part, via: 'llm', arm: eff.arm }, ctx.now());
    recordMessage(ctx, userId, personaId, 'persona', part, ctx.now());
  }
  return { messages: parts, source: 'llm', version: persona.meta.version, arm: eff.arm };
}
