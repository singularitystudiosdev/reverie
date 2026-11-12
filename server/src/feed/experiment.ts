/**
 * Live ranker experiments: users (or single pages) are split by a stable hash into the arms of
 * cfg.feed.experiment, and the feed serves each with that arm's feed settings merged over the
 * defaults. Every serve and the impression it leads to carry `<experiment>:<arm>`, so the arms
 * can be compared on real swipes and chats (GET /admin/feed-experiment) instead of only in the
 * simulator.
 *
 * Why: the ranker's settings were chosen in a simulator whose users the code's authors wrote, and
 * several wait on "a live A/B" (dwell, the persona intercepts). Leaders ship ranking changes
 * through traffic splits: X runs its experiments on a small share of For You traffic and keeps the
 * production defaults in code (xai-org/x-algorithm README, "Experiments and Configuration";
 * home-mixer/params/param.rs); Hinge reports its conversation model as an A/B result (SIGIR '26,
 * doi 10.1145/3805712.3808464).
 *
 * Design, and what it cannot do:
 * - Unit. 'user' (default): a user keeps their arm (a feed_arms row written at their first serve,
 *   so editing the weights later never moves anyone). 'page': every request draws its own arm, for
 *   serve-time knobs only: about 20x fewer users for the same lift at launch traffic, because each
 *   user is their own control (a proxy: a 5% relative lift on likes per card needs about 0.7k
 *   users per arm page-level against about 14.6k for per-user likes); read it as a mixture-policy
 *   effect, since a user's own state carries over between pages.
 * - One model. Shared statistics (persona rates, co-likes, randomN, the fitted weights) pool every
 *   arm. A treatment is therefore partly trained on control's data and vice versa ("symbiosis
 *   bias", Brennan et al., WWW '25, arXiv 2309.07107): run treatments small and read the estimate
 *   at two allocations; if its sign or size moves, the shared data is steering it (Li, Wang and
 *   Wang, arXiv 2507.11891). An arm that changes exploration (exploreEvery, randomTarget,
 *   undersampledTarget) free-rides on the other arms' exploration, so its cost is understated: the
 *   report flags it. The factor fit is the one exception: each distinct fit setting (calibrate,
 *   personaEffects) is fitted separately on the pooled rows (model.ts), so those can be arms.
 * - Metrics. Primary: likes per card, a ratio estimate clustered by user (delta method), its
 *   difference from the first arm as an always-valid confidence sequence (stats/inference.ts), so
 *   the report can be read at any time. Guardrails, per liked card and attributed to the arm that
 *   served it: deep chats and reports or blocks. With unit 'user', next-day return over users
 *   enrolled at least two days ago, and a sample-ratio-mismatch test on enrolment.
 */
import { deepMerge, type Config, type DeepPartial } from '../config.ts';
import type { Ctx } from '../context.ts';
import { csHalfWidth, normCdf, twoProportionN, wilson } from '../stats/inference.ts';
import { hash32 } from '../stats/random.ts';

export interface FeedArm {
  name: string;
  /** Relative share (default 1). */
  weight?: number;
  /** Feed settings this arm overrides. */
  feed?: DeepPartial<Config['feed']>;
}

export interface FeedExperiment {
  /** Part of every logged arm and of the hash salt: a new name is a new experiment and reshuffles. */
  name: string;
  /** 'user' (default): sticky per user. 'page': drawn per request (serve-time settings only). */
  unit?: 'user' | 'page';
  arms: FeedArm[];
}

/** murmur3's 32-bit finaliser over FNV-1a: FNV alone splits sequential ids unevenly (a proxy saw
 *  10,264 / 9,736 at 50/50 over 20k ids "u0".."u19999", chi-square 13.9) and correlates across salts. */
function bucketHash(s: string): number {
  let h = hash32(s);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function pickArm(exp: FeedExperiment, key: string): FeedArm {
  const total = exp.arms.reduce((a, x) => a + Math.max(x.weight ?? 1, 0), 0);
  let r = (bucketHash(`${exp.name}:${key}`) / 2 ** 32) * total;
  for (const a of exp.arms) {
    r -= Math.max(a.weight ?? 1, 0);
    if (r < 0) return a;
  }
  return exp.arms[exp.arms.length - 1];
}

/**
 * The arm this request is served under (`<experiment>:<arm>`, null with no experiment) and the feed
 * settings it serves with. With unit 'user' the first serve enrols the user (unless `persist` is
 * false, as for dry runs); with unit 'page' the request id decides.
 */
export function feedArm(ctx: Ctx, userId: string, opts: { requestId?: string; persist?: boolean } = {}): { arm: string | null; feed: Config['feed'] } {
  const exp = ctx.cfg.feed.experiment;
  if (!exp || !exp.arms.length) return { arm: null, feed: ctx.cfg.feed };
  let arm: FeedArm;
  if (exp.unit === 'page') arm = pickArm(exp, `${userId}:${opts.requestId ?? ''}`);
  else {
    const row = ctx.db.prepare('SELECT arm FROM feed_arms WHERE user_id = ? AND experiment = ?').get(userId, exp.name) as { arm: string } | undefined;
    const kept = row ? exp.arms.find((a) => a.name === row.arm) : undefined;
    arm = kept ?? pickArm(exp, userId);
    if (!row && opts.persist !== false)
      ctx.db.prepare('INSERT OR IGNORE INTO feed_arms (user_id, experiment, arm, enrolled_at) VALUES (?, ?, ?, ?)').run(userId, exp.name, arm.name, ctx.now());
  }
  return { arm: `${exp.name}:${arm.name}`, feed: arm.feed ? deepMerge(ctx.cfg.feed, arm.feed) : ctx.cfg.feed };
}

/** The settings that change the factor fit: one fit per distinct value (model.ts). */
export function fitKey(feed: Config['feed']): string {
  return feed.calibrate ? (feed.personaEffects ? 'effects' : 'weights') : 'off';
}

/** Every fit setting the default or an arm serves with. */
export function fitSettings(cfg: Config['feed']): Config['feed'][] {
  const all = [cfg, ...(cfg.experiment?.arms ?? []).map((a) => (a.feed ? deepMerge(cfg, a.feed) : cfg))];
  const seen = new Map<string, Config['feed']>();
  for (const f of all) if (!seen.has(fitKey(f))) seen.set(fitKey(f), f);
  return [...seen.values()];
}

/** Knobs whose cost an arm cannot measure: the exploration every arm shares. */
const SHARED_KNOBS = ['exploreEvery', 'randomTarget', 'undersampledTarget'] as const;

interface Ratio {
  estimate: number;
  se: number;
}
interface Diff {
  estimate: number;
  lower: number;
  upper: number;
}

interface ArmReport {
  arm: string;
  users: number;
  cards: number;
  likes: number;
  /** Primary: likes per card, clustered by user. */
  likeRate: Ratio;
  /** Guardrails, per liked card served by this arm. */
  deepChatsPerLike: Ratio;
  negativesPerLike: Ratio;
  /** Unit 'user': came back 1 to 2 days after enrolling, over users enrolled at least 2 days ago. */
  nextDayReturn: { estimate: number; lower: number; upper: number; n: number } | null;
  /** This arm minus the first arm (always-valid; null for the first arm). */
  vsFirst: { likeRate: Diff; deepChatsPerLike: Diff; negativesPerLike: Diff } | null;
}

/** sum(y) / sum(x) over users with its delta-method standard error (cards of one user are not independent). */
function ratio(users: { y: number; x: number }[]): Ratio {
  const n = users.length;
  const sx = users.reduce((a, u) => a + u.x, 0);
  const sy = users.reduce((a, u) => a + u.y, 0);
  if (!n || !sx) return { estimate: 0, se: Infinity };
  const r = sy / sx;
  const xbar = sx / n;
  const v = users.reduce((a, u) => a + (u.y - r * u.x) ** 2, 0) / Math.max(n - 1, 1);
  return { estimate: r, se: Math.sqrt(v / n) / xbar };
}

/** Users (all arms) at which the confidence sequences are tightest: about two weeks of launch traffic. */
const NSTAR = 4000;

export function feedExperimentReport(ctx: Ctx): {
  experiment: FeedExperiment | null;
  arms: ArmReport[];
  sampleRatio: { chiSquare: number; p: number } | null;
  /** Per-arm cards needed for a 5% relative lift in likes per card at the first arm's rate, inflated by the observed clustering. */
  cardsPerArmFor5PctLift: number | null;
  warnings: string[];
} {
  const exp = ctx.cfg.feed.experiment ?? null;
  if (!exp) return { experiment: null, arms: [], sampleRatio: null, cardsPerArmFor5PctLift: null, warnings: [] };
  const { db, cfg } = ctx;
  const deepTurns = cfg.telemetry.deepChatTurns;
  // Every decided card served under this experiment, with whether its like led to a deep chat or a report/block.
  const rows = db
    .prepare(
      `SELECT i.arm, i.user_id, i.outcome,
         CASE WHEN i.outcome = 'like' AND c.user_turns >= ? THEN 1 ELSE 0 END AS deep,
         CASE WHEN i.outcome = 'like' AND m.end_reason IN ('report', 'block') THEN 1 ELSE 0 END AS neg
       FROM impressions i
       LEFT JOIN conversations c ON c.user_id = i.user_id AND c.persona_id = i.persona_id AND c.started_at >= i.ts
       LEFT JOIN matches m ON m.user_id = i.user_id AND m.persona_id = i.persona_id AND m.ended_at >= i.ts
       WHERE i.outcome IS NOT NULL AND i.arm LIKE ?`,
    )
    .all(deepTurns, `${exp.name}:%`) as { arm: string; user_id: string; outcome: string; deep: number; neg: number }[];
  const per = new Map<string, Map<string, { cards: number; likes: number; deep: number; neg: number }>>();
  for (const r of rows) {
    const byUser = per.get(r.arm) ?? new Map();
    const u = byUser.get(r.user_id) ?? { cards: 0, likes: 0, deep: 0, neg: 0 };
    u.cards++;
    if (r.outcome === 'like') u.likes++;
    u.deep += r.deep;
    u.neg += r.neg;
    byUser.set(r.user_id, u);
    per.set(r.arm, byUser);
  }
  const userUnit = exp.unit !== 'page';
  const enrolled = userUnit
    ? (db.prepare('SELECT user_id, arm, enrolled_at FROM feed_arms WHERE experiment = ?').all(exp.name) as { user_id: string; arm: string; enrolled_at: number }[])
    : [];
  const cameBack = db.prepare('SELECT 1 FROM events WHERE user_id = ? AND ts >= ? AND ts < ? LIMIT 1');
  const now = ctx.now();
  const arms: ArmReport[] = [];
  let first: ArmReport | null = null;
  const totalUsers = [...per.values()].reduce((a, m) => a + m.size, 0);
  const diff = (a: Ratio, b: Ratio): Diff => {
    const se = Math.sqrt(a.se ** 2 + b.se ** 2);
    const h = Number.isFinite(se) ? csHalfWidth(se, totalUsers, NSTAR) : Infinity;
    return { estimate: a.estimate - b.estimate, lower: a.estimate - b.estimate - h, upper: a.estimate - b.estimate + h };
  };
  for (const a of exp.arms) {
    const key = `${exp.name}:${a.name}`;
    const users = [...(per.get(key)?.values() ?? [])];
    const likeRate = ratio(users.map((u) => ({ y: u.likes, x: u.cards })));
    const liked = users.filter((u) => u.likes > 0);
    const deepChatsPerLike = ratio(liked.map((u) => ({ y: u.deep, x: u.likes })));
    const negativesPerLike = ratio(liked.map((u) => ({ y: u.neg, x: u.likes })));
    let nextDayReturn: ArmReport['nextDayReturn'] = null;
    if (userUnit) {
      const old = enrolled.filter((e) => e.arm === a.name && now - e.enrolled_at >= 2 * cfg.dayMs);
      const back = old.filter((e) => cameBack.get(e.user_id, e.enrolled_at + cfg.dayMs, e.enrolled_at + 2 * cfg.dayMs)).length;
      const w = wilson(back, old.length);
      nextDayReturn = { estimate: w.estimate, lower: w.lower, upper: w.upper, n: old.length };
    }
    const rep: ArmReport = {
      arm: key,
      users: userUnit ? enrolled.filter((e) => e.arm === a.name).length : users.length,
      cards: users.reduce((s, u) => s + u.cards, 0),
      likes: users.reduce((s, u) => s + u.likes, 0),
      likeRate,
      deepChatsPerLike,
      negativesPerLike,
      nextDayReturn,
      vsFirst: first
        ? { likeRate: diff(likeRate, first.likeRate), deepChatsPerLike: diff(deepChatsPerLike, first.deepChatsPerLike), negativesPerLike: diff(negativesPerLike, first.negativesPerLike) }
        : null,
    };
    if (!first) first = rep;
    arms.push(rep);
  }
  // Sample-ratio mismatch: enrolment against the configured weights (a broken split shows here first).
  let sampleRatio: { chiSquare: number; p: number } | null = null;
  if (userUnit && enrolled.length) {
    const total = exp.arms.reduce((s, a) => s + Math.max(a.weight ?? 1, 0), 0);
    let chi = 0;
    for (const a of exp.arms) {
      const expd = (enrolled.length * Math.max(a.weight ?? 1, 0)) / total;
      const obs = enrolled.filter((e) => e.arm === a.name).length;
      if (expd > 0) chi += (obs - expd) ** 2 / expd;
    }
    const df = Math.max(exp.arms.length - 1, 1);
    // Wilson-Hilferty: chi-square(df) to a standard normal.
    const z = (Math.cbrt(chi / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
    sampleRatio = { chiSquare: +chi.toFixed(3), p: +(1 - normCdf(z)).toFixed(4) };
  }
  // Power: per-arm cards for a 5% relative lift at the first arm's like rate, times the design effect.
  let cardsPerArmFor5PctLift: number | null = null;
  if (first && first.cards > 0 && Number.isFinite(first.likeRate.se)) {
    const p = first.likeRate.estimate;
    const binomialSe = Math.sqrt((p * (1 - p)) / first.cards);
    const deff = binomialSe > 0 ? (first.likeRate.se / binomialSe) ** 2 : 1;
    cardsPerArmFor5PctLift = Math.ceil(twoProportionN(p, 0.05 * p) * Math.max(deff, 1));
  }
  const warnings = [
    'Arms share one model and its statistics (symbiosis bias): run a treatment small and read it again at a larger share before trusting a small effect.',
    ...exp.arms
      .filter((a) => SHARED_KNOBS.some((k) => a.feed && k in a.feed))
      .map((a) => `Arm ${a.name} changes exploration (${SHARED_KNOBS.filter((k) => a.feed && k in a.feed).join(', ')}): it rides on the other arms' exploration, so its cost is understated.`),
    ...(sampleRatio && sampleRatio.p < 0.001 ? [`Sample ratio mismatch (p = ${sampleRatio.p}): enrolment does not match the weights; fix the split before reading results.`] : []),
  ];
  return { experiment: exp, arms, sampleRatio, cardsPerArmFor5PctLift, warnings };
}
