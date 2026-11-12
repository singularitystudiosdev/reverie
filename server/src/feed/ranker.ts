/**
 * The swipe deck, built per request in the shape of X's home-mixer pipeline
 * (xai-org/x-algorithm): query hydration -> candidate sources -> filters ->
 * scoring -> diversity -> selection -> side effects.
 *
 *   hydrate   the user's per-category Beta posteriors (likes and deep chats
 *             raise a category, passes and reports lower it), what they have
 *             already liked, passed and matched.
 *   candidates every servable persona (active, or fading at its multiplier).
 *   filters   already liked or matched; passed (unless the user reset the
 *             deck); explicitly excluded ids.
 *   score     one tempered Thompson draw per candidate: every Beta draw is pulled
 *             toward its mean by cfg.feed.tsScale (Chapelle & Li, NeurIPS 2011: a
 *             shrunk posterior beat plain Thompson sampling on ad data; Bastani et
 *             al., arXiv 1704.09011: with varied users, little exploration is
 *             needed). Score = P(like) x (w_like +
 *             w_deep P(deep chat) - w_neg P(report/block)), the chained form of
 *             X's sum of weighted predicted actions, weights self-calibrated
 *             so a deep chat weighs as much as a like on average. P(like) combines the
 *             user's category affinity (zoom in on what they like), shrunk
 *             toward the global category rate and boosted by categories
 *             co-liked with their likes (TinVec's co-swipe idea reduced to a
 *             catalog this size), with the persona's own quality relative to
 *             its category, times the user's TRAIT factor: their own like rate
 *             for the persona's gender, age band and art style (every swipe
 *             counts in full, nearby age bands share evidence) relative to
 *             their overall like rate. New personas draw from a dynamic prior.
 *   diversity DPP as X's vm-ranker runs it (vm-ranker/dpp.rs, params.rs): over
 *             the top cfg.feed.dppPool x k candidates by score only, theta
 *             cfg.feed.dppTheta (X ships 0.65), the chosen cards then shown in
 *             score order; the kernel is theme categories only (model.ts).
 *             The factors are combined with weights a logistic regression fits
 *             to the logged swipes (cfg.feed.calibrate; the plain product was
 *             about 3x too spread in logit space).
 *             A persona-to-persona term multiplies P(like): how much more the
 *             users who liked what this user liked liked the candidate than the
 *             ranker predicted (O/E on its logged predictions; item-based CF on
 *             the model's residuals, Koren KDD 2008; TinVec at persona level).
 *   explore   every k-th card the user decides on is an exploration slot (placed
 *             on their card stream: the app shows 3 cards a page): half go to
 *             the user's best-scoring persona among the least-shown quarter
 *             (traffic for the significance gate, spent where this user is
 *             likeliest to like it), half uniformly at random (the unbiased
 *             sample the fade check reads); each only among personas whose
 *             sample is still short, so the deck stops paying for it.
 *   recycle   when the unseen roster cannot fill the deck, personas passed more
 *             than cfg.feed.recycleAfterMs ago compete again (Tinder's "dynamic
 *             recycling"); their passes already lower their score.
 *   log       every card's slot, its propensity of landing in the window the app
 *             shows (Monte Carlo replays of the whole policy), for inverse-
 *             propensity-weighted metrics, and its mean prediction (p_pred) for
 *             the persona-to-persona term.
 *
 * In the proxy simulation (600 users, correlated tastes) a 10-card deck got
 * 3.19 likes per user from a static order, 3.36 from per-user Thompson
 * category affinity alone, and 3.56 with the co-like boost (oracle 5.19).
 * The feed bench and the closed-loop runs behind the tempered draws, the
 * X-faithful DPP and the full-weight evidence are in SIMULATION.md.
 */
import type { Ctx } from '../context.ts';
import { makeId } from '../util.ts';
import { fadeMultiplier } from '../lifecycle/fade.ts';
import { feedTags, type Persona } from '../personas/schema.ts';
import type { Rng } from '../stats/random.ts';
import { cosineCache, dppSelect } from './dpp.ts';
import { getFeedModel, type FeedModel } from './model.ts';

export interface FeedCard {
  personaId: string;
  position: number;
  slot: 'exploit' | 'random' | 'undersampled';
  pShown: number;
  score: number;
  why: { pLike: number; pDeep: number; pNeg: number; affinity: number; quality: number; traits: number; cf: number; pBase: number; factors: number[]; isNew: boolean; fade: number };
}

export interface FeedRequest {
  limit?: number;
  exclude?: string[];
  includePassed?: boolean;
  /** Cards the client will show from this page before it asks again (default cfg.feed.visible). */
  visible?: number;
  /** For the simulation: skip writing feed_serves rows. */
  dryRun?: boolean;
}

/**
 * Action weights, self-calibrated the way the heavy ranker set its weights: so
 * each term contributes about equally on average. A like counts 1; a deep chat
 * counts 1 / (mean deep-chat rate), so the conversation a card leads to
 * weighs as much as the swipe; a report or block counts 3x a deep chat.
 */
function weights(model: FeedModel): { like: number; deep: number; neg: number } {
  const deep = Math.min(10, Math.max(2, 1 / Math.max(model.meanDeep, 0.05)));
  return { like: 1, deep, neg: 3 * deep };
}

interface UserState {
  affinity: Map<string, { a: number; b: number }>;
  liked: Set<string>;
  passed: Set<string>;
  /** When each passed persona was last passed (recycling). */
  passedAt: Map<string, number>;
  likedCategories: string[];
  traits: TraitModel;
  /** Cards this user has decided on so far: where the next page starts in their card stream. */
  decided: number;
}

/**
 * Hard-ish traits: who the persona is (gender), how old (age band) and how they are drawn (art
 * style). People swipe on these far more decisively than on themes, so they are not diluted into
 * the category average: each swipe counts in full toward the user's like rate for the persona's
 * value on each axis, and that rate, relative to the user's overall like rate, multiplies P(like).
 * Neighbouring age bands share evidence (passing on 40-somethings says something about 60-somethings).
 */
type TraitAxis = 'gender' | 'age' | 'style';
const AGE_BANDS: Record<string, number> = { 'young-adult': 0, adult: 1, 'ageless-adult': 1, 'mature-adult': 2, 'senior-adult': 3 };
const AGE_SHARE = [1, 0.5, 0.2, 0.05];
const TRAIT_PRIOR = 3; // pseudo-swipes at the user's overall like rate

export interface TraitModel {
  swipes: number;
  rate: number;
  counts: Record<TraitAxis, Map<string, { x: number; n: number }>>;
}

function traitValues(p: Persona): Record<TraitAxis, string> {
  return { gender: p.meta.gender, age: p.meta.descriptors.age_group, style: p.meta.descriptors.aesthetic };
}

function buildTraits(ctx: Ctx, liked: Set<string>, passed: Set<string>): TraitModel {
  const counts: TraitModel['counts'] = { gender: new Map(), age: new Map(), style: new Map() };
  let likes = 0;
  let swipes = 0;
  for (const [ids, x] of [[liked, 1], [passed, 0]] as const) {
    for (const id of ids) {
      const p = ctx.personas.get(id);
      if (!p) continue;
      swipes++;
      likes += x;
      for (const [axis, value] of Object.entries(traitValues(p)) as [TraitAxis, string][]) {
        const c = counts[axis].get(value) ?? { x: 0, n: 0 };
        c.x += x;
        c.n += 1;
        counts[axis].set(value, c);
      }
    }
  }
  return { swipes, rate: (likes + 1) / (swipes + 3), counts };
}

/** The user's evidence for one axis value: exact for gender and style, shared across nearby age bands. */
function traitEvidence(t: TraitModel, axis: TraitAxis, value: string): { x: number; n: number } {
  if (axis !== 'age') return t.counts[axis].get(value) ?? { x: 0, n: 0 };
  const band = AGE_BANDS[value] ?? 1;
  let x = 0;
  let n = 0;
  for (const [v, c] of t.counts.age) {
    const w = AGE_SHARE[Math.abs((AGE_BANDS[v] ?? 1) - band)] ?? 0;
    x += w * c.x;
    n += w * c.n;
  }
  return { x, n };
}

/**
 * Multiplier on P(like) from the three trait axes: the posterior mean of the user's like rate for
 * each value over their overall rate. Deliberately not a Thompson draw: three skewed Beta draws at
 * a low base rate multiply into noise that scrambles the deck (it lost to the plain tag average in
 * simulation); the category affinity's draw already supplies the exploration.
 */
export function traitFactor(t: TraitModel, p: Persona): number {
  if (!t.swipes) return 1;
  let f = 1;
  for (const [axis, value] of Object.entries(traitValues(p)) as [TraitAxis, string][]) {
    const { x, n } = traitEvidence(t, axis, value);
    f *= (x + TRAIT_PRIOR * t.rate) / (n + TRAIT_PRIOR) / t.rate;
  }
  return Math.min(Math.max(f, 0.05), 3);
}

function hydrate(ctx: Ctx, userId: string): UserState {
  const affinity = new Map<string, { a: number; b: number }>();
  for (const r of ctx.db.prepare('SELECT category, a, b FROM user_affinity WHERE user_id = ?').all(userId) as { category: string; a: number; b: number }[])
    affinity.set(r.category, { a: r.a, b: r.b });
  const liked = new Set<string>();
  const passed = new Set<string>();
  const passedAt = new Map<string, number>();
  let decided = 0;
  for (const r of ctx.db
    .prepare('SELECT persona_id, outcome, ts FROM impressions WHERE user_id = ? AND outcome IS NOT NULL ORDER BY ts')
    .all(userId) as { persona_id: string; outcome: string; ts: number }[]) {
    decided++;
    if (r.outcome === 'like') liked.add(r.persona_id);
    else {
      passed.add(r.persona_id);
      passedAt.set(r.persona_id, r.ts);
    }
  }
  for (const r of ctx.db.prepare('SELECT persona_id FROM matches WHERE user_id = ?').all(userId) as { persona_id: string }[]) liked.add(r.persona_id);
  for (const id of liked) passed.delete(id);
  const likedCategories = [...liked].flatMap((id) => {
    const p = ctx.personas.get(id);
    return p ? feedTags(p) : [];
  });
  return { affinity, liked, passed, passedAt, likedCategories, traits: buildTraits(ctx, liked, passed), decided };
}

/**
 * A Beta draw pulled toward its mean by `scale` (1: plain Thompson sampling, 0: the posterior
 * mean). Only what the user's own swipes inform is drawn: their affinity for a tag they have
 * evidence on, and the persona's like rate. A tag the user has never swiped on, and a persona's
 * P(deep chat) and P(report), are persona- or population-level and take their means: drawn,
 * they were pure prior noise (P(deep) from Beta(1, 4) at weight about 5) and cost a new user's
 * first deck 0.024 of its 0.055 gap to a true-popularity deck in the feed bench.
 */
function tempered(rng: Rng, a: number, b: number, scale: number): number {
  const mean = a / (a + b);
  return scale > 0 ? mean + scale * (rng.beta(a, b) - mean) : mean;
}

/**
 * Persona-to-persona collaborative term: among users who liked what this user liked, how much more
 * often this candidate was liked than the ranker (without this term) predicted when it served it
 * (an O/E ratio per liked persona, shrunk toward 1 by cfShrink pseudo-likes, geometric mean over the
 * user's likes). Item-based CF (Sarwar et al., WWW 2001; Tinder's TinVec learns the same co-swipe
 * signal as embeddings) fitted to the model's residuals, so it adds the taste no tag or trait
 * carries (a face, a drawing style) instead of counting the tags a second time.
 */
function cfFactor(model: FeedModel, u: UserState, id: string, weight: number, shrink: number): number {
  if (!weight || !u.liked.size) return 1;
  let s = 0;
  for (const i of u.liked) {
    const c = model.cf.get(i)?.get(id);
    if (c) s += Math.log((c.o + shrink) / (c.e + shrink));
  }
  return Math.min(Math.max(Math.exp((weight * s) / u.liked.size), 0.2), 5);
}

/** One tempered Thompson draw of a candidate's score for this user (`cf`: its cfFactor, which takes no draw). */
function drawScore(model: FeedModel, p: Persona, u: UserState, rng: Rng, shrink: number, fade: number, scale: number, cf = 1): FeedCard['why'] & { score: number } {
  const post = model.persona.get(p.meta.id)!;
  // Co-like boost: how much more often this persona's categories are liked by people who liked what this user liked.
  const nCats = Math.max(model.categories.length, 1);
  let affSum = 0;
  let affMeanSum = 0; // the same affinity at its posterior mean, for the logged prediction
  let catMeanSum = 0;
  const tags = feedTags(p);
  for (const c of tags) {
    const g = model.category.get(c) ?? { a: 1, b: 2 };
    let m = g.a / (g.a + g.b);
    if (u.likedCategories.length) {
      let rel = 0;
      for (const l of u.likedCategories) rel += (model.colike.get(l)?.get(c) ?? 0) / Math.max(model.colikeRow.get(l) ?? 0, 1);
      rel /= u.likedCategories.length;
      const lift = rel * nCats;
      m = Math.min(0.95, m * (0.6 + 0.4 * Math.min(lift, 4)));
    }
    const ua = u.affinity.get(c) ?? { a: 0, b: 0 };
    const a0 = ua.a + shrink * m + 1e-3;
    const b0 = ua.b + shrink * (1 - m) + 1e-3;
    affSum += tempered(rng, a0, b0, ua.a + ua.b > 0 ? scale : 0);
    affMeanSum += a0 / (a0 + b0);
    catMeanSum += g.a / (g.a + g.b);
  }
  const k = Math.max(tags.length, 1);
  const affinity = affSum / k;
  const catMean = Math.max(catMeanSum / k, 1e-3);
  const qualityDraw = tempered(rng, post.like.a, post.like.b, scale);
  const quality = Math.min(qualityDraw / catMean, 3);
  const traits = traitFactor(u.traits, p);
  // The factors at their posterior means, logged with the serve (the calibration fits on them).
  const qualityMean = Math.min(post.like.a / (post.like.a + post.like.b) / catMean, 3);
  const factors = [Math.log(Math.max(affMeanSum / k, 1e-4)), Math.log(Math.max(qualityMean, 1e-4)), Math.log(traits), Math.log(cf)];
  const cw = model.calib;
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const pLike = cw
    ? sig(cw[0] + cw[1] * Math.log(Math.max(affinity, 1e-4)) + cw[2] * Math.log(Math.max(quality, 1e-4)) + cw[3] * factors[2] + cw[4] * factors[3])
    : Math.min(affinity * quality * traits * cf, 0.99);
  // The mean prediction without the collaborative term (no draw), logged with the serve: the
  // expected side of the persona-to-persona O/E ratios, so that term learns only what the rest of
  // the model misses.
  const pBase = cw
    ? sig(cw[0] + cw[1] * factors[0] + cw[2] * factors[1] + cw[3] * factors[2])
    : Math.min(((affMeanSum / k) / catMean) * traits * (post.like.a / (post.like.a + post.like.b)), 0.99);
  const pDeep = post.deep.a / (post.deep.a + post.deep.b);
  const pNeg = post.negative.a / (post.negative.a + post.negative.b);
  const w = weights(model);
  const score = pLike * (w.like + w.deep * pDeep - w.neg * pNeg) * fade;
  return { score, pLike, pDeep, pNeg, affinity, quality, traits, cf, pBase, factors, isNew: post.isNew, fade };
}

export function buildFeed(ctx: Ctx, userId: string, req: FeedRequest = {}): { requestId: string; cards: FeedCard[] } {
  const cfg = ctx.cfg.feed;
  const limit = Math.max(1, Math.min(req.limit ?? cfg.deckSize, 50));
  const model = getFeedModel(ctx);
  const u = hydrate(ctx, userId);
  const exclude = new Set(req.exclude ?? []);
  const eligible = ctx.personas
    .servable()
    .filter((p) => model.persona.has(p.meta.id))
    .filter((p) => !u.liked.has(p.meta.id) && !exclude.has(p.meta.id));
  let candidates = eligible.filter((p) => req.includePassed || !u.passed.has(p.meta.id));
  // Recycling (Tinder, "Solving how to keep recommendations fresh": recent passes stay out, older
  // ones return and the ranker decides): when the unseen roster cannot fill the deck, personas
  // passed more than cfg.feed.recycleAfterMs ago come back as candidates. Their passes are in the
  // user's affinity and trait model, so they compete on what the model now predicts instead of
  // all returning at once on a deck reset.
  if (!req.includePassed && candidates.length < limit) {
    const before = ctx.now() - cfg.recycleAfterMs;
    candidates = [...candidates, ...eligible.filter((p) => u.passed.has(p.meta.id) && (u.passedAt.get(p.meta.id) ?? 0) < before)];
  }
  const requestId = makeId('feed');
  if (!candidates.length) return { requestId, cards: [] };

  const fades = new Map(candidates.map((p) => [p.meta.id, fadeMultiplier(ctx, p.meta.id)]));
  const cfs = new Map(candidates.map((p) => [p.meta.id, cfFactor(model, u, p.meta.id, cfg.cfWeight, cfg.cfShrink)]));
  const score = (p: Persona) => drawScore(model, p, u, ctx.rng, cfg.userShrink, fades.get(p.meta.id)!, cfg.tsScale, cfs.get(p.meta.id));
  const draws = candidates.map(score);

  // Selection: DPP over the scored pool, then every k-th card becomes an exploration slot.
  const vectors = candidates.map((p) => model.vectors.get(p.meta.id) ?? [1]);
  const sim = cosineCache(vectors);
  const k = Math.min(limit, candidates.length);
  // Exploration stays inside what the user has not clearly ruled out: after 8 swipes, a card whose
  // expected trait factor is under 0.5 (a gender, age or art style they keep passing on) is not
  // spent on an explore slot. The slots still sample everything else uniformly.
  const explorable = candidates.map((p) => u.traits.swipes < 8 || traitFactor(u.traits, p) >= 0.5);
  const shown = candidates.map((p) => model.impressions.get(p.meta.id) ?? 0);
  const randomN = candidates.map((p) => model.randomN.get(p.meta.id) ?? 0);
  const select = (scores: number[]): { idx: number; slot: FeedCard['slot'] }[] => {
    // X vm-ranker: the DPP chooses among the top of the scored list only (DppMaxSelectedRank), and
    // the cards it keeps are shown in score order, not in the order it picked them.
    const byScore = candidates.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const pool = byScore.slice(0, Math.max(k, Math.ceil(cfg.dppPool * k)));
    const order = dppSelect(
      pool.map((i) => scores[i]),
      pool.map((i) => vectors[i]),
      k,
      cfg.dppTheta,
      (a, b) => sim(pool[a], pool[b]),
    ).map((j) => pool[j]);
    order.sort((a, b) => scores[b] - scores[a]);
    const picked: { idx: number; slot: FeedCard['slot'] }[] = order.map((idx) => ({ idx, slot: 'exploit' as const }));
    const used = new Set(order);
    // A brand-new user's first deck keeps its uniformly random slots (the unbiased sample the fade
    // check needs, and first decks are a large share of all decks) but gives its undersampled
    // slots back to exploit cards: an explore card is worth about 0.13 against about 0.23 for an
    // exploit card (feed bench), and the first deck decides whether they stay. X shields new
    // accounts too (home-mixer NewUserMinEngagementFilter). Dropping both slots cost the closed
    // loop every persona's 30 random-slot impressions, and with them the fade's cross-check.
    //
    // The slots sit on the user's CARD STREAM, not at fixed page positions: the app shows the first
    // `visible` cards of a page and then asks again (it re-ranks every 3 swipes), so fixed positions
    // 4 and 9 were almost never on screen and the explore traffic the gate and the fade check count
    // on never arrived. Every exploreEvery-th card the user decides on is an explore card; this page
    // places the next one where that card falls.
    const first = (cfg.exploreEvery - 1 - (u.decided % cfg.exploreEvery)) % cfg.exploreEvery;
    //
    // Each slot explores only where a sample is still missing (cfg.feed.randomTarget,
    // undersampledTarget): a persona with its fade sample in takes no more random slots, one with
    // the gate's impressions no more undersampled ones. A slot with nobody left to explore for its
    // purpose takes the other purpose, and with nobody left for either stays an exploit card.
    for (let pos = first; pos < picked.length; pos += cfg.exploreEvery) {
      const open = candidates.map((_, i) => i).filter((i) => !used.has(i));
      const preferred = open.filter((i) => explorable[i]);
      const all = preferred.length ? preferred : open;
      if (!all.length) break;
      const forRandom = all.filter((i) => randomN[i] < cfg.randomTarget);
      const forGate = all.filter((i) => shown[i] < model.gateImpressions);
      let idx: number;
      let slot: FeedCard['slot'];
      let toGate = ctx.rng() < 0.5;
      if (toGate && u.traits.swipes === 0) continue;
      if (toGate && !forGate.length) toGate = false;
      else if (!toGate && !forRandom.length) toGate = forGate.length > 0 && u.traits.swipes > 0;
      const pool = toGate ? forGate : forRandom;
      if (!pool.length) continue;
      if (toGate) {
        // Toward the gate: the least-shown quarter of what is left, and of those the persona this
        // user is likeliest to like (not the one global argmin every user got until the model's
        // next rebuild, which is also the persona the ranker has learned nobody wants).
        const cut = pool.map((i) => shown[i]).sort((a, b) => a - b)[Math.floor((pool.length - 1) / 4)];
        const low = pool.filter((i) => shown[i] <= cut);
        idx = low.reduce((best, i) => (scores[i] > scores[best] ? i : best), low[0]);
        slot = 'undersampled';
      } else {
        idx = pool[ctx.rng.int(pool.length)];
        slot = 'random';
      }
      used.delete(picked[pos].idx);
      used.add(idx);
      picked[pos] = { idx, slot };
    }
    return picked;
  };
  const picked = select(draws.map((d) => d.score));

  // Propensity: the share of fresh replays of the WHOLE policy (Thompson draws, DPP rerank and
  // the explore slots) that put each candidate where the user will see it: in the first `visible`
  // cards for a card in that window (what the app shows before it re-ranks), anywhere in the page
  // for a card past it. Estimating it from the scores' top-k alone would mis-weight the DPP's
  // diversity picks and every explore slot; from the whole page, every card in the window.
  const W = Math.max(1, Math.min(Math.round(req.visible ?? cfg.visible), k));
  const M = cfg.propensityDraws;
  const freq = new Array(candidates.length).fill(0);
  const freqTop = new Array(candidates.length).fill(0);
  for (let m = 0; m < M; m++) {
    const replay = select(candidates.map((p) => score(p).score));
    replay.forEach(({ idx }, pos) => {
      freq[idx]++;
      if (pos < W) freqTop[idx]++;
    });
  }

  const cards: FeedCard[] = picked.map(({ idx, slot }, position) => {
    const p = candidates[idx];
    const d = draws[idx];
    const f = position < W ? freqTop[idx] : freq[idx];
    const pShown = Math.min(1, Math.max(f / M, 1 / (2 * M)));
    const { score: s, ...why } = d;
    return { personaId: p.meta.id, position, slot, pShown, score: s, why };
  });

  if (!req.dryRun) {
    const ins = ctx.db.prepare(
      'INSERT INTO feed_serves (request_id, position, ts, user_id, persona_id, slot, p_shown, score, p_pred, factors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const now = ctx.now();
    for (const c of cards) ins.run(requestId, c.position, now, userId, c.personaId, c.slot, c.pShown, c.score, c.why.pBase, JSON.stringify(c.why.factors.map((x) => +x.toFixed(4))));
  }
  return { requestId, cards };
}
