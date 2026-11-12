/**
 * Per-persona telemetry: the full funnel from impression to premium, time
 * spent, retention, re-swipes and negative signals, plus the persona score the
 * lifecycle ranks by.
 *
 * Feed bias: a personalised feed shows each persona mostly to users already
 * inclined toward it, which inflates its like rate. Every impression logs its
 * selection propensity, so the like rate is reported three ways: raw, inverse
 * propensity weighted (weights clipped at cfg.telemetry.ipwClip), and from
 * random exploration slots alone. Fade decisions require the IPW and random
 * views to agree (Mansoury et al., CIKM 2020, on feedback-loop bias).
 */
import type { Ctx } from '../context.ts';
import { median, wilson } from '../stats/inference.ts';
import { dropProfile, type DropProfile } from './falloff.ts';

export interface Rate {
  x: number;
  n: number;
  rate: number;
}

const rate = (x: number, n: number): Rate => ({ x, n, rate: n > 0 ? x / n : 0 });

export interface PersonaStats {
  personaId: string;
  version: number;
  status: string;
  computedAt: number;
  impressions: number;
  likeRate: Rate;
  likeRateIpw: Rate;
  likeRateRandom: Rate;
  passes: number;
  matches: number;
  chatStartRate: Rate;        // conversations with >= 1 user message / matches
  conversations: number;      // conversations with >= 1 user message
  avgUserTurns: number;
  medianUserTurns: number;
  rmstUserTurns: number;      // mean of min(turns, cap)
  deepChatRate: Rate;         // conversations reaching deepChatTurns / conversations
  avgTimeMinPerConversation: number;
  avgPersonaMessagesPerConversation: number;
  d1Return: Rate;             // users active again 1-2 days after their first chat with this persona
  d7Return: Rate;             // ... 7-8 days after
  personaReturn: Rate;        // users who came back to THIS persona a day or more later
  premiumConversion: Rate;    // chatted users who went premium within 7 days
  premiumLastTouch: number;   // premium conversions whose last chat before converting was this persona
  premiumViews: number;
  reswipeRate: Rate;          // passes later reversed into likes / passes
  deckReturnRate: Rate;       // conversations where the user left to keep swiping / conversations
  negativeRate: Rate;         // matches ended by report, block or unmatch / matches
  farewellRate: Rate;         // conversations the user ended with a goodbye
  videoPlays: number;
  profileOpens: number;
  drop: DropProfile;
  score?: ScoreParts;
}

export interface ScoreParts {
  score: number;
  lower: number;
  upper: number;
  components: Record<string, number>;
}

export function computeStats(ctx: Ctx, personaId: string): PersonaStats {
  const { db, cfg } = ctx;
  const now = ctx.now();
  const day = cfg.dayMs;
  const p = ctx.personas.get(personaId);

  const imp = db
    .prepare('SELECT slot, p_shown, outcome FROM impressions WHERE persona_id = ?')
    .all(personaId) as { slot: string; p_shown: number; outcome: string | null }[];
  let likes = 0;
  let passes = 0;
  let wSum = 0;
  let wLike = 0;
  let rN = 0;
  let rLike = 0;
  for (const r of imp) {
    const like = r.outcome === 'like' ? 1 : 0;
    likes += like;
    if (r.outcome === 'pass') passes++;
    const w = Math.min(1 / Math.max(r.p_shown, 1e-6), cfg.telemetry.ipwClip);
    wSum += w;
    wLike += w * like;
    if (r.slot === 'random') {
      rN++;
      rLike += like;
    }
  }

  const matches = (db.prepare('SELECT COUNT(*) AS n FROM matches WHERE persona_id = ?').get(personaId) as { n: number }).n;
  const negatives = (
    db.prepare("SELECT COUNT(*) AS n FROM matches WHERE persona_id = ? AND end_reason IS NOT NULL").get(personaId) as { n: number }
  ).n;

  const convs = db
    .prepare('SELECT id, user_id, started_at, user_turns, persona_turns, time_ms, farewell_turn FROM conversations WHERE persona_id = ? AND user_turns > 0')
    .all(personaId) as {
    id: string;
    user_id: string;
    started_at: number;
    user_turns: number;
    persona_turns: number;
    time_ms: number;
    farewell_turn: number | null;
  }[];
  const turns = convs.map((c) => c.user_turns);
  const cap = cfg.telemetry.rmstCap;
  const deep = convs.filter((c) => c.user_turns >= cfg.telemetry.deepChatTurns).length;

  // Retention windows, counted only for users whose window has fully elapsed.
  let d1n = 0;
  let d1x = 0;
  let d7n = 0;
  let d7x = 0;
  let prn = 0;
  let prx = 0;
  let premN = 0;
  let premX = 0;
  const activeIn = db.prepare('SELECT 1 FROM events WHERE user_id = ? AND ts >= ? AND ts < ? LIMIT 1');
  const backToPersona = db.prepare("SELECT 1 FROM messages WHERE conv_id = ? AND role = 'user' AND ts >= ? LIMIT 1");
  const premiumAt = db.prepare('SELECT premium_at FROM users WHERE id = ?');
  for (const c of convs) {
    const t0 = c.started_at;
    if (now >= t0 + 2 * day) {
      d1n++;
      if (activeIn.get(c.user_id, t0 + day, t0 + 2 * day)) d1x++;
      prn++;
      if (backToPersona.get(c.id, t0 + day)) prx++;
    }
    if (now >= t0 + 8 * day) {
      d7n++;
      if (activeIn.get(c.user_id, t0 + 7 * day, t0 + 8 * day)) d7x++;
    }
    // Only threads whose 7-day window has closed count, converted or not: counting early
    // converters before the window closes inflates young personas.
    const pa = (premiumAt.get(c.user_id) as { premium_at: number | null } | undefined)?.premium_at ?? null;
    const alreadyPremium = pa !== null && pa < t0;
    if (!alreadyPremium && now >= t0 + 7 * day) {
      premN++;
      if (pa !== null && pa <= t0 + 7 * day) premX++;
    }
  }

  const premiumLastTouch = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM events e WHERE e.type = 'premium_convert' AND (
           SELECT c.persona_id FROM messages m JOIN conversations c ON c.id = m.conv_id
           WHERE c.user_id = e.user_id AND m.ts <= e.ts ORDER BY m.ts DESC LIMIT 1) = ?`,
      )
      .get(personaId) as { n: number }
  ).n;
  const count = (type: string) =>
    (db.prepare('SELECT COUNT(*) AS n FROM events WHERE persona_id = ? AND type = ?').get(personaId, type) as { n: number }).n;

  return {
    personaId,
    version: p?.meta.version ?? 0,
    status: p?.meta.status ?? 'unknown',
    computedAt: now,
    impressions: imp.length,
    likeRate: rate(likes, imp.length),
    likeRateIpw: { x: wLike, n: wSum, rate: wSum > 0 ? wLike / wSum : 0 },
    likeRateRandom: rate(rLike, rN),
    passes,
    matches,
    chatStartRate: rate(convs.length, matches),
    conversations: convs.length,
    avgUserTurns: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : 0,
    medianUserTurns: median(turns),
    rmstUserTurns: turns.length ? turns.reduce((a, b) => a + Math.min(b, cap), 0) / turns.length : 0,
    deepChatRate: rate(deep, convs.length),
    avgTimeMinPerConversation: convs.length ? convs.reduce((a, c) => a + c.time_ms, 0) / convs.length / 60_000 : 0,
    avgPersonaMessagesPerConversation: convs.length ? convs.reduce((a, c) => a + c.persona_turns, 0) / convs.length : 0,
    d1Return: rate(d1x, d1n),
    d7Return: rate(d7x, d7n),
    personaReturn: rate(prx, prn),
    premiumConversion: rate(premX, premN),
    premiumLastTouch,
    premiumViews: count('premium_view'),
    reswipeRate: rate(count('reswipe'), passes),
    deckReturnRate: rate(count('deck_return'), convs.length),
    negativeRate: rate(negatives, matches),
    farewellRate: rate(convs.filter((c) => c.farewell_turn !== null).length, convs.length),
    videoPlays: count('video_play'),
    profileOpens: count('profile_open'),
    drop: dropProfile(ctx, personaId),
  };
}

/**
 * Score every persona on one scale. Each component rate is shrunk toward the
 * population rate with cfg.score.shrink pseudo-observations (so a persona with
 * little data sits near the middle, not at an extreme), and weighted by
 * 1 / (population rate), so each term contributes about equally on average:
 * the rule Twitter's heavy ranker states for its weights. Negatives get
 * cfg.score.negativeMultiple times the mean positive weight. The interval comes
 * from the binomial variance of each shrunk part.
 */
export function scoreAll(ctx: Ctx, stats: PersonaStats[]): PersonaStats[] {
  const parts: [string, (s: PersonaStats) => Rate][] = [
    ['like', (s) => s.likeRateIpw],
    ['deepChat', (s) => s.deepChatRate],
    ['personaReturn', (s) => s.personaReturn],
    ['premium', (s) => s.premiumConversion],
  ];
  const neg = (s: PersonaStats) => s.negativeRate;
  const k = ctx.cfg.score.shrink;
  const pooled = (f: (s: PersonaStats) => Rate) => {
    const x = stats.reduce((a, s) => a + f(s).x, 0);
    const n = stats.reduce((a, s) => a + f(s).n, 0);
    return n > 0 ? x / n : 0;
  };
  // A signal enters the score only once some persona has an event for it. A signal nobody sends
  // (premium before a paywall exists, reports before the app has a report button) would otherwise
  // get weight 1/1e-3 and swamp every interval with variance, so nothing could ever fade.
  const live = parts.filter(([, f]) => stats.some((s) => f(s).x > 0));
  const means = Object.fromEntries(live.map(([key, f]) => [key, pooled(f)]));
  const w = Object.fromEntries(live.map(([key]) => [key, 1 / means[key]]));
  const negMean = pooled(neg);
  const wNeg =
    negMean > 0 && live.length ? ctx.cfg.score.negativeMultiple * (Object.values(w).reduce((a, b) => a + b, 0) / live.length) : 0;

  for (const s of stats) {
    let score = 0;
    let variance = 0;
    const components: Record<string, number> = {};
    for (const [key, f] of live) {
      const r = f(s);
      const value = (r.x + k * means[key]) / (r.n + k);
      components[key] = value;
      score += w[key] * value;
      variance += (w[key] ** 2 * Math.max(value * (1 - value), 1e-4)) / (r.n + k);
    }
    if (wNeg > 0) {
      const nr = neg(s);
      const negValue = (nr.x + k * negMean) / (nr.n + k);
      components.negative = negValue;
      score -= wNeg * negValue;
      variance += (wNeg ** 2 * Math.max(negValue * (1 - negValue), 1e-4)) / (nr.n + k);
    }
    const sd = Math.sqrt(variance);
    s.score = { score, lower: score - 1.96 * sd, upper: score + 1.96 * sd, components };
  }
  return stats;
}

/** Same score using random-slot like rates only (the unbiased cross-check for fading). */
export function randomSlotUpper(s: PersonaStats): number {
  const r = s.likeRateRandom;
  return r.n > 0 ? wilson(r.x, r.n).upper : 1;
}

export function computeAllStats(ctx: Ctx, persist = true): PersonaStats[] {
  const stats = scoreAll(
    ctx,
    ctx.personas.all().filter((p) => p.meta.status !== 'draft').map((p) => computeStats(ctx, p.meta.id)),
  );
  if (persist) {
    const stmt = ctx.db.prepare(
      'INSERT INTO persona_stats (persona_id, ts, stats) VALUES (?, ?, ?) ON CONFLICT(persona_id) DO UPDATE SET ts = excluded.ts, stats = excluded.stats',
    );
    for (const s of stats) stmt.run(s.personaId, s.computedAt, JSON.stringify(s));
  }
  return stats;
}
