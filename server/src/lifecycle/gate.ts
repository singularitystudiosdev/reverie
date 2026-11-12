/**
 * The significance gate: new personas are created (globally, for everyone)
 * only once EVERY active persona has a statistically significant sample.
 *
 * "Significant" is a power calculation, not a feeling: the per-persona sample
 * at which a `gateMde` absolute difference in like rate (impressions) and in
 * deep-chat rate (conversations) is detectable at `gateAlpha` with `gatePower`.
 * Hard floors keep the gate from opening on a handful of users.
 *
 * Two guards keep the gate reachable (sharpen pass): the feed's exploration
 * slots go to the persona furthest from the gate, and a persona still short
 * after `gateTimeoutMultiple` x the median time the others took is flagged and
 * stops blocking.
 */
import type { Ctx } from '../context.ts';
import { median, twoProportionN } from '../stats/inference.ts';
import type { PersonaStats } from '../telemetry/rollups.ts';

export interface GatePersona {
  id: string;
  impressions: number;
  conversations: number;
  progress: number; // min(impressions / nImp, conversations / nConv), capped at 1
  reached: boolean;
  flagged: boolean;
}

export interface GateStatus {
  open: boolean;
  nImpressions: number;
  nConversations: number;
  personas: GatePersona[];
  blocking: string[];
}

export function computeGate(ctx: Ctx, stats: PersonaStats[]): GateStatus {
  const l = ctx.cfg.lifecycle;
  const active = new Set(ctx.personas.active().map((p) => p.meta.id));
  const rows = stats.filter((s) => active.has(s.personaId));
  const mean = (xs: number[], d: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : d);
  const likeBase = mean(rows.filter((s) => s.impressions > 0).map((s) => s.likeRate.rate), 0.3);
  const deepBase = mean(rows.filter((s) => s.conversations > 0).map((s) => s.deepChatRate.rate), 0.2);
  const nImpressions = Math.max(l.gateMinImpressions, twoProportionN(likeBase, l.gateMde, l.gateAlpha, l.gatePower));
  const nConversations = Math.max(l.gateMinConversations, twoProportionN(deepBase, l.gateMde, l.gateAlpha, l.gatePower));

  const now = ctx.now();
  const state = ctx.db.prepare('SELECT persona_id, first_seen_at, gate_reached_at, gate_flagged FROM persona_state').all() as {
    persona_id: string;
    first_seen_at: number | null;
    gate_reached_at: number | null;
    gate_flagged: number;
  }[];
  const st = new Map(state.map((r) => [r.persona_id, r]));
  const markReached = ctx.db.prepare('UPDATE persona_state SET gate_reached_at = ? WHERE persona_id = ? AND gate_reached_at IS NULL');

  const personas: GatePersona[] = rows.map((s) => {
    const progress = Math.min(1, s.impressions / nImpressions, s.conversations / nConversations);
    const reached = progress >= 1;
    if (reached) markReached.run(now, s.personaId);
    return { id: s.personaId, impressions: s.impressions, conversations: s.conversations, progress, reached, flagged: Boolean(st.get(s.personaId)?.gate_flagged) };
  });

  // Gate timeout: median time-to-gate among those that made it.
  const times = state
    .filter((r) => r.gate_reached_at && r.first_seen_at && active.has(r.persona_id))
    .map((r) => (r.gate_reached_at as number) - (r.first_seen_at as number));
  if (times.length >= 3) {
    const limit = median(times) * l.gateTimeoutMultiple;
    for (const g of personas) {
      const first = st.get(g.id)?.first_seen_at;
      if (!g.reached && !g.flagged && first && now - first > limit) {
        g.flagged = true;
        ctx.db.prepare('UPDATE persona_state SET gate_flagged = 1 WHERE persona_id = ?').run(g.id);
        ctx.db.prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)').run(now, 'gate_flag', g.id, JSON.stringify({ progress: g.progress }));
      }
    }
  }
  const blocking = personas.filter((g) => !g.reached && !g.flagged).map((g) => g.id);
  // The parents route (cfg.lifecycle.gateTopK > 0). Waiting for EVERY persona's chat sample never
  // ends at launch traffic: chats follow likes (about 0.9 per like), so the 120-200 chat floor needs
  // 800 to 4,000 impressions of a persona, while the feed serves about 15 a day per persona and
  // starves the bottom half (7% of impressions); in the paired closed loop no seed opened in 25
  // days, and the 3x-median timeout would only fire around day 30 to 100, freeing 120+ personas at
  // once. What a generation needs is resolved parents: the exploit branch varies the top personas
  // by score lower bound and only reached personas are eligible (scheduler.ts), so the gate also
  // opens once K personas have reached (both samples, so their scores are powered) with a score at
  // or above the roster's median: K resolved, better-than-typical parents. (Requiring the top K by
  // lower bound opened at 1 of 3 closed-loop seeds: rising personas with high scores and half
  // their chats sit in that top K; requiring each parent's lower bound over the median, also 1 of
  // 3: with 50 pseudo-observations of shrinkage the bounds stay about 0.6 wide.) At most one generation per
  // cfg.lifecycle.generationCooldownDays; each new persona still has to earn its place (the fade's
  // like-rate path retires it on its served cards), and the roster stays under maxActive (evolve.ts).
  let parentsOpen = false;
  const k = l.gateTopK;
  if (k > 0 && blocking.length) {
    const scored = rows.filter((s) => s.score);
    const medianScore = median(scored.map((s) => s.score!.score));
    const reachedIds = new Set(personas.filter((g) => g.reached).map((g) => g.id));
    const parents = scored.filter((s) => reachedIds.has(s.personaId) && s.score!.score >= medianScore);
    const last = ctx.db.prepare("SELECT MAX(ts) AS ts FROM lifecycle_log WHERE kind IN ('spawn_explore', 'spawn_exploit')").get() as { ts: number | null };
    const cooled = last.ts === null || now - last.ts >= l.generationCooldownDays * ctx.cfg.dayMs;
    parentsOpen = scored.length > k && parents.length >= k && cooled;
  }
  return { open: personas.length > 0 && (blocking.length === 0 || parentsOpen), nImpressions, nConversations, personas, blocking };
}
