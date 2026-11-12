/**
 * Fading the lowest performers.
 *
 * A persona is judged once its LIKE sample is in: as many impressions as the gate asks of
 * every persona. Not the gate's conversation count: a persona nobody likes gets few chats, so
 * waiting for those would shield exactly the worst personas forever. It is "below" on a tick
 * when the UPPER end of its score interval is under the bottom-quartile score of every persona
 * judged so far (confidently among the worst, not merely under the median, which half of any
 * roster always is; and not the bottom of only the popular personas that reached the gate) and,
 * once enough personas have 30+ random-slot impressions to compare, its own random-slot like
 * rate (unbiased by the feed, 30+ impressions required) agrees. After `fadeStreak`
 * consecutive below ticks it starts FADING: still served, with its feed
 * weight multiplied by `fadeDecay` each tick (traffic decays first, as a
 * bandit would), and RETIRED once the weight falls under `fadeRetireBelow`.
 * Caps: at most `maxRetiresPerTick` fades and retirements per tick, and never
 * below `minActive` active personas. A fading persona whose LOWER bound climbs
 * back over the median is restored. Users already matched keep their chat.
 */
import type { Ctx } from '../context.ts';
import { median, wilson } from '../stats/inference.ts';

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
import type { PersonaStats } from '../telemetry/rollups.ts';
import type { GateStatus } from './gate.ts';

export interface FadeResult {
  faded: string[];
  retired: string[];
  restored: string[];
  medianScore: number;
}

export function fadeTick(ctx: Ctx, stats: PersonaStats[], gate: GateStatus): FadeResult {
  const l = ctx.cfg.lifecycle;
  const byId = new Map(stats.map((s) => [s.personaId, s]));
  const pool = stats.filter((s) => s.impressions >= gate.nImpressions && s.score);
  const res: FadeResult = { faded: [], retired: [], restored: [], medianScore: 0 };
  if (pool.length < 3) return res;
  const scores = pool.map((s) => s.score!.score);
  const med = median(scores);
  const bar = quantile(scores, l.fadeQuantile);
  res.medianScore = med;
  const randomPool = pool.filter((s) => s.likeRateRandom.n >= 30);
  const randomMed = randomPool.length >= 3 ? median(randomPool.map((s) => s.likeRateRandom.rate)) : null;

  const getState = ctx.db.prepare('SELECT below_streak, fade_multiplier FROM persona_state WHERE persona_id = ?');
  const setState = ctx.db.prepare('UPDATE persona_state SET below_streak = ?, fade_multiplier = ? WHERE persona_id = ?');
  const log = ctx.db.prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)');
  let actions = 0;
  let activeCount = ctx.personas.active().length;

  // Fading personas: decay, retire, or restore.
  for (const p of ctx.personas.all().filter((x) => x.meta.status === 'fading')) {
    const s = byId.get(p.meta.id);
    const row = getState.get(p.meta.id) as { below_streak: number; fade_multiplier: number } | undefined;
    const mult = (row?.fade_multiplier ?? 1) * l.fadeDecay;
    if (s?.score && s.score.lower > med) {
      setState.run(0, 1, p.meta.id);
      ctx.personas.setStatus(p.meta.id, 'active', `recovered: score lower bound ${s.score.lower.toFixed(2)} > median ${med.toFixed(2)}`, ctx.now());
      log.run(ctx.now(), 'restore', p.meta.id, JSON.stringify({ score: s.score }));
      res.restored.push(p.meta.id);
      activeCount++;
      continue;
    }
    if (mult < l.fadeRetireBelow && actions < l.maxRetiresPerTick) {
      setState.run(row?.below_streak ?? 0, 0, p.meta.id);
      ctx.personas.setStatus(p.meta.id, 'retired', `faded out: score ${s?.score?.score.toFixed(2) ?? '?'} vs median ${med.toFixed(2)}`, ctx.now());
      log.run(ctx.now(), 'retire', p.meta.id, JSON.stringify({ score: s?.score, median: med }));
      res.retired.push(p.meta.id);
      actions++;
    } else setState.run(row?.below_streak ?? 0, Math.max(mult, l.fadeRetireBelow / 2), p.meta.id);
  }

  // Active personas with their like sample in: count below-bar streaks, start fading the worst.
  const candidates = pool
    .filter((s) => ctx.personas.get(s.personaId)?.meta.status === 'active')
    .sort((a, b) => a.score!.upper - b.score!.upper);
  for (const s of candidates) {
    const row = getState.get(s.personaId) as { below_streak: number; fade_multiplier: number } | undefined;
    const randomAgrees =
      randomMed === null || (s.likeRateRandom.n >= 30 && wilson(s.likeRateRandom.x, s.likeRateRandom.n).upper < randomMed + 0.05);
    const below = s.score!.upper < bar && randomAgrees;
    const streak = below ? (row?.below_streak ?? 0) + 1 : 0;
    if (below && streak >= l.fadeStreak && actions < l.maxRetiresPerTick && activeCount - 1 >= l.minActive) {
      setState.run(streak, 1, s.personaId);
      ctx.personas.setStatus(s.personaId, 'fading', `score upper bound ${s.score!.upper.toFixed(2)} < bottom-quartile score ${bar.toFixed(2)} for ${streak} ticks`, ctx.now());
      log.run(ctx.now(), 'fade', s.personaId, JSON.stringify({ score: s.score, bar, median: med, streak }));
      res.faded.push(s.personaId);
      actions++;
      activeCount--;
    } else setState.run(streak, row?.fade_multiplier ?? 1, s.personaId);
  }
  return res;
}

/** The feed multiplier for a persona (1 unless fading). */
export function fadeMultiplier(ctx: Ctx, personaId: string): number {
  const row = ctx.db.prepare('SELECT fade_multiplier FROM persona_state WHERE persona_id = ?').get(personaId) as { fade_multiplier: number } | undefined;
  const p = ctx.personas.get(personaId);
  if (!p) return 0;
  if (p.meta.status === 'retired' || p.meta.status === 'draft') return 0;
  return p.meta.status === 'fading' ? (row?.fade_multiplier ?? 1) : 1;
}
