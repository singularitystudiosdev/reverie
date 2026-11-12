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
 *   score     one Thompson draw per candidate. Score = P(like) x (w_like +
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
 *   diversity DPP rerank over category/descriptor vectors (X vm-ranker).
 *   explore   every k-th card is an exploration slot: half go to the persona
 *             furthest from the significance gate, half uniformly at random
 *             (the unbiased sample the fade check reads).
 *   log       every card's slot and selection propensity (Monte Carlo replays
 *             the Thompson draws), for inverse-propensity-weighted metrics.
 *
 * In the proxy simulation (600 users, correlated tastes) a 10-card deck got
 * 3.19 likes per user from a static order, 3.36 from per-user Thompson
 * category affinity alone, and 3.56 with the co-like boost (oracle 5.19).
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
  why: { pLike: number; pDeep: number; pNeg: number; affinity: number; quality: number; traits: number; isNew: boolean; fade: number };
}

export interface FeedRequest {
  limit?: number;
  exclude?: string[];
  includePassed?: boolean;
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
  likedCategories: string[];
  traits: TraitModel;
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
  for (const r of ctx.db
    .prepare('SELECT persona_id, outcome FROM impressions WHERE user_id = ? AND outcome IS NOT NULL ORDER BY ts')
    .all(userId) as { persona_id: string; outcome: string }[]) {
    if (r.outcome === 'like') liked.add(r.persona_id);
    else passed.add(r.persona_id);
  }
  for (const r of ctx.db.prepare('SELECT persona_id FROM matches WHERE user_id = ?').all(userId) as { persona_id: string }[]) liked.add(r.persona_id);
  for (const id of liked) passed.delete(id);
  const likedCategories = [...liked].flatMap((id) => {
    const p = ctx.personas.get(id);
    return p ? feedTags(p) : [];
  });
  return { affinity, liked, passed, likedCategories, traits: buildTraits(ctx, liked, passed) };
}

/** One Thompson draw of a candidate's score for this user. */
function drawScore(model: FeedModel, p: Persona, u: UserState, rng: Rng, shrink: number, fade: number): FeedCard['why'] & { score: number } {
  const post = model.persona.get(p.meta.id)!;
  // Co-like boost: how much more often this persona's categories are liked by people who liked what this user liked.
  const nCats = Math.max(model.categories.length, 1);
  let affSum = 0;
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
    affSum += rng.beta(ua.a + shrink * m + 1e-3, ua.b + shrink * (1 - m) + 1e-3);
    catMeanSum += g.a / (g.a + g.b);
  }
  const k = Math.max(tags.length, 1);
  const affinity = affSum / k;
  const catMean = Math.max(catMeanSum / k, 1e-3);
  const qualityDraw = rng.beta(post.like.a, post.like.b);
  const quality = Math.min(qualityDraw / catMean, 3);
  const traits = traitFactor(u.traits, p);
  const pLike = Math.min(affinity * quality * traits, 0.99);
  const pDeep = rng.beta(post.deep.a, post.deep.b);
  const pNeg = rng.beta(post.negative.a, post.negative.b);
  const w = weights(model);
  const score = pLike * (w.like + w.deep * pDeep - w.neg * pNeg) * fade;
  return { score, pLike, pDeep, pNeg, affinity, quality, traits, isNew: post.isNew, fade };
}

export function buildFeed(ctx: Ctx, userId: string, req: FeedRequest = {}): { requestId: string; cards: FeedCard[] } {
  const cfg = ctx.cfg.feed;
  const limit = Math.max(1, Math.min(req.limit ?? cfg.deckSize, 50));
  const model = getFeedModel(ctx);
  const u = hydrate(ctx, userId);
  const exclude = new Set(req.exclude ?? []);
  const candidates = ctx.personas
    .servable()
    .filter((p) => model.persona.has(p.meta.id))
    .filter((p) => !u.liked.has(p.meta.id) && !exclude.has(p.meta.id) && (req.includePassed || !u.passed.has(p.meta.id)));
  const requestId = makeId('feed');
  if (!candidates.length) return { requestId, cards: [] };

  const fades = new Map(candidates.map((p) => [p.meta.id, fadeMultiplier(ctx, p.meta.id)]));
  const draws = candidates.map((p) => drawScore(model, p, u, ctx.rng, cfg.userShrink, fades.get(p.meta.id)!));

  // Selection: DPP over the scored pool, then every k-th card becomes an exploration slot.
  const vectors = candidates.map((p) => model.vectors.get(p.meta.id) ?? [1]);
  const sim = cosineCache(vectors);
  const k = Math.min(limit, candidates.length);
  // Exploration stays inside what the user has not clearly ruled out: after 8 swipes, a card whose
  // expected trait factor is under 0.5 (a gender, age or art style they keep passing on) is not
  // spent on an explore slot. The slots still sample everything else uniformly.
  const explorable = candidates.map((p) => u.traits.swipes < 8 || traitFactor(u.traits, p) >= 0.5);
  const select = (scores: number[]): { idx: number; slot: FeedCard['slot'] }[] => {
    const order = dppSelect(scores, vectors, k, cfg.dppTheta, sim);
    const picked: { idx: number; slot: FeedCard['slot'] }[] = order.map((idx) => ({ idx, slot: 'exploit' as const }));
    const used = new Set(order);
    for (let pos = cfg.exploreEvery - 1; pos < picked.length; pos += cfg.exploreEvery) {
      const open = candidates.map((_, i) => i).filter((i) => !used.has(i));
      const preferred = open.filter((i) => explorable[i]);
      const pool = preferred.length ? preferred : open;
      if (!pool.length) break;
      let idx: number;
      let slot: FeedCard['slot'];
      if (ctx.rng() < 0.5) {
        // Furthest from the gate: fewest impressions relative to the roster.
        idx = pool.reduce((best, i) =>
          (model.impressions.get(candidates[i].meta.id) ?? 0) < (model.impressions.get(candidates[best].meta.id) ?? 0) ? i : best,
        );
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
  // the explore slots) that put each candidate in the deck. Estimating it from the scores' top-k
  // alone would mis-weight the DPP's diversity picks and every explore slot.
  const M = cfg.propensityDraws;
  const freq = new Array(candidates.length).fill(0);
  for (let m = 0; m < M; m++) {
    const scores = candidates.map((p) => drawScore(model, p, u, ctx.rng, cfg.userShrink, fades.get(p.meta.id)!).score);
    for (const { idx } of select(scores)) freq[idx]++;
  }

  const cards: FeedCard[] = picked.map(({ idx, slot }, position) => {
    const p = candidates[idx];
    const d = draws[idx];
    const pShown = Math.min(1, Math.max(freq[idx] / M, 1 / (2 * M)));
    return { personaId: p.meta.id, position, slot, pShown, score: d.score, why: { pLike: d.pLike, pDeep: d.pDeep, pNeg: d.pNeg, affinity: d.affinity, quality: d.quality, traits: d.traits, isNew: d.isNew, fade: d.fade } };
  });

  if (!req.dryRun) {
    const ins = ctx.db.prepare('INSERT INTO feed_serves (request_id, position, ts, user_id, persona_id, slot, p_shown, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const now = ctx.now();
    for (const c of cards) ins.run(requestId, c.position, now, userId, c.personaId, c.slot, c.pShown, c.score);
  }
  return { requestId, cards };
}
