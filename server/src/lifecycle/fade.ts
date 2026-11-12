/**
 * Fading the lowest performers.
 *
 * A persona is judged once its LIKE sample is in: as many impressions as the gate asks of
 * every persona. Not the gate's conversation count: a persona nobody likes gets few chats, so
 * waiting for those would shield exactly the worst personas forever. It is "below" on a tick
 * when the UPPER end of its score interval is under the bottom-quartile score of every persona
 * judged so far (confidently among the worst, not merely under the median, which half of any
 * roster always is; and not the bottom of only the popular personas that reached the gate) and
 * its own random-slot like rate (unbiased by the feed, 30+ impressions required, always) agrees:
 * its upper bound under the judged personas' median random-slot rate (the pooled random-slot
 * rate while fewer than 3 have their sample). After `fadeStreak`
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

/** z of the like-rate fade path's bound (one-sided 99%). */
const LIKE_PATH_Z = 2.326;

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
  // With fewer than 3 personas at their sample there is no score bar (the like-rate path below
  // still runs: it compares against the random-slot reference, not against other personas).
  if (pool.length < 3 && !l.fadeMinCards) return res;
  const scores = pool.map((s) => s.score!.score);
  const med = pool.length >= 3 ? median(scores) : Infinity;
  const bar = pool.length >= 3 ? quantile(scores, l.fadeQuantile) : -Infinity;
  res.medianScore = Number.isFinite(med) ? med : 0;
  const randomPool = pool.filter((s) => s.likeRateRandom.n >= 30);
  // The unbiased reference the random-slot check compares against: the median random-slot rate of
  // the judged personas, or while fewer than 3 have their sample, the pooled random-slot rate.
  const pooledX = stats.reduce((a, s) => a + s.likeRateRandom.x, 0);
  const pooledN = stats.reduce((a, s) => a + s.likeRateRandom.n, 0);
  const randomRef = randomPool.length >= 3 ? median(randomPool.map((s) => s.likeRateRandom.rate)) : pooledN > 0 ? pooledX / pooledN : null;

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
    // Restored when its score's lower bound clears the median, or (the like-rate path) when its
    // served like rate's lower bound clears the random-slot reference.
    const likesRecovered =
      !!s && l.fadeMinCards > 0 && randomRef !== null && s.likeRate.x + s.passes >= l.fadeMinCards && wilson(s.likeRate.x, s.likeRate.x + s.passes, LIKE_PATH_Z).lower > randomRef;
    if (s && ((s.score && s.score.lower > med) || likesRecovered)) {
      setState.run(0, 1, p.meta.id);
      ctx.personas.setStatus(p.meta.id, 'active', likesRecovered ? `recovered: like rate lower bound over the random-slot reference ${randomRef!.toFixed(3)}` : `recovered: score lower bound ${s.score!.lower.toFixed(2)} > median ${med.toFixed(2)}`, ctx.now());
      log.run(ctx.now(), 'restore', p.meta.id, JSON.stringify({ score: s.score }));
      res.restored.push(p.meta.id);
      activeCount++;
      continue;
    }
    if (mult < l.fadeRetireBelow && actions < l.maxRetiresPerTick) {
      setState.run(row?.below_streak ?? 0, 0, p.meta.id);
      ctx.personas.setStatus(p.meta.id, 'retired', `faded out: score ${s?.score?.score.toFixed(2) ?? '?'}${Number.isFinite(med) ? ` vs median ${med.toFixed(2)}` : ''}, like rate ${s ? `${s.likeRate.x}/${s.likeRate.x + s.passes}` : '?'}`, ctx.now());
      log.run(ctx.now(), 'retire', p.meta.id, JSON.stringify({ score: s?.score, median: med }));
      res.retired.push(p.meta.id);
      actions++;
    } else setState.run(row?.below_streak ?? 0, Math.max(mult, l.fadeRetireBelow / 2), p.meta.id);
  }

  // The like-rate path (cfg.lifecycle.fadeMinCards > 0): a persona the feed rarely shows never
  // reaches the pool above (in the paired closed loop at 220 users a day the true duds got 0.7 to
  // 3.6 cards a day against the pool's 300, so nothing faded in 25 days, and a dud's score would
  // need over 1,600 impressions to clear the bar). It is judged instead on every card it was served
  // and decided on: the upper bound of that like rate under the unbiased random-slot reference.
  // Conservative by construction: the feed shows a persona mostly to the users likeliest to like
  // it, so its served like rate overstates its population rate, and an upper bound that is still
  // below the average persona's random-slot rate is confidently bad. Its own random-slot swipes
  // only have to not contradict it (point rate at or under the reference once it has 10); waiting
  // for 30 deadlocked, since random slots stop at feed.randomTarget (40) and a dud with 1 like in
  // 40 has a Wilson upper bound of 0.129 against a reference of about 0.115. Chats must not
  // contradict it either: with 30+ conversations, a deep-chat rate whose lower bound beats the
  // roster's keeps it.
  const minCards = l.fadeMinCards;
  // A one-sided 99% bound (z 2.326), not 95%: every persona is re-tested every tick as its cards
  // arrive. Paired closed loop, 3 seeds x 25 days at 220 users a day (SIMULATION.md): z 1.96 faded
  // 18, 15 of them in the true bottom quartile but 3 mid-table (ranks 41, 58, 69 of 154); z 2.326
  // faded 9, 8 in the bottom quartile and one just past it (rank 41); z 2.576 faded 4, all in it,
  // and nothing at 2 of 3 seeds. Like rate per impression unchanged at z 2.326.
  const deepRef = (() => {
    const x = stats.reduce((a, s) => a + s.deepChatRate.x, 0);
    const n = stats.reduce((a, s) => a + s.deepChatRate.n, 0);
    return n > 0 ? x / n : null;
  })();
  const likePathBelow = (s: PersonaStats): boolean => {
    if (!minCards || randomRef === null) return false;
    const decided = s.likeRate.x + s.passes;
    if (decided < minCards || wilson(s.likeRate.x, decided, LIKE_PATH_Z).upper >= randomRef) return false;
    if (s.likeRateRandom.n >= 10 && s.likeRateRandom.rate > randomRef) return false;
    if (deepRef !== null && s.deepChatRate.n >= 30 && wilson(s.deepChatRate.x, s.deepChatRate.n).lower > deepRef) return false;
    return true;
  };

  // Active personas with their like sample in, or with enough served cards for the like-rate path:
  // count below-bar streaks, start fading the worst.
  const inPool = new Set(pool.map((s) => s.personaId));
  const candidates = stats
    .filter((s) => ctx.personas.get(s.personaId)?.meta.status === 'active' && (inPool.has(s.personaId) || (minCards > 0 && s.likeRate.x + s.passes >= minCards)))
    .sort((a, b) => wilson(a.likeRate.x, Math.max(a.likeRate.x + a.passes, 1)).upper - wilson(b.likeRate.x, Math.max(b.likeRate.x + b.passes, 1)).upper);
  for (const s of candidates) {
    const row = getState.get(s.personaId) as { below_streak: number; fade_multiplier: number } | undefined;
    // Fails closed: no persona fades on its score alone. It needs its own 30 random-slot swipes,
    // and their upper bound under the reference. (Open while the pool had fewer than 3 such
    // personas, this let noisy scores fade two of the most-liked personas in the paired loop; a
    // 5-point margin on top of the reference let a mid-table persona's unlucky 2 likes in 30 through.)
    const randomAgrees =
      randomRef !== null && s.likeRateRandom.n >= 30 && wilson(s.likeRateRandom.x, s.likeRateRandom.n).upper < randomRef;
    const below = (inPool.has(s.personaId) && s.score!.upper < bar && randomAgrees) || likePathBelow(s);
    const streak = below ? (row?.below_streak ?? 0) + 1 : 0;
    if (below && streak >= l.fadeStreak && actions < l.maxRetiresPerTick && activeCount - 1 >= l.minActive) {
      setState.run(streak, 1, s.personaId);
      const why = inPool.has(s.personaId) && s.score!.upper < bar && randomAgrees
        ? `score upper bound ${s.score!.upper.toFixed(2)} < bottom-quartile score ${bar.toFixed(2)} for ${streak} ticks`
        : `like rate ${s.likeRate.x}/${s.likeRate.x + s.passes} served cards, upper bound under the random-slot reference ${randomRef!.toFixed(3)} for ${streak} ticks`;
      ctx.personas.setStatus(s.personaId, 'fading', why, ctx.now());
      log.run(ctx.now(), 'fade', s.personaId, JSON.stringify({ score: s.score, bar, median: med, streak, likes: s.likeRate.x, decided: s.likeRate.x + s.passes, randomRef }));
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
