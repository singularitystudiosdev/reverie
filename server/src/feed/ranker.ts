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
 *             its category. New personas draw from a dynamic prior.
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
  why: { pLike: number; pDeep: number; pNeg: number; affinity: number; quality: number; isNew: boolean; fade: number };
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
  return { affinity, liked, passed, likedCategories };
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
  const pLike = Math.min(affinity * quality, 0.99);
  const pDeep = rng.beta(post.deep.a, post.deep.b);
  const pNeg = rng.beta(post.negative.a, post.negative.b);
  const w = weights(model);
  const score = pLike * (w.like + w.deep * pDeep - w.neg * pNeg) * fade;
  return { score, pLike, pDeep, pNeg, affinity, quality, isNew: post.isNew, fade };
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
  const select = (scores: number[]): { idx: number; slot: FeedCard['slot'] }[] => {
    const order = dppSelect(scores, vectors, k, cfg.dppTheta, sim);
    const picked: { idx: number; slot: FeedCard['slot'] }[] = order.map((idx) => ({ idx, slot: 'exploit' as const }));
    const used = new Set(order);
    for (let pos = cfg.exploreEvery - 1; pos < picked.length; pos += cfg.exploreEvery) {
      const pool = candidates.map((_, i) => i).filter((i) => !used.has(i));
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
    return { personaId: p.meta.id, position, slot, pShown, score: d.score, why: { pLike: d.pLike, pDeep: d.pDeep, pNeg: d.pNeg, affinity: d.affinity, quality: d.quality, isNew: d.isNew, fade: d.fade } };
  });

  if (!req.dryRun) {
    const ins = ctx.db.prepare('INSERT INTO feed_serves (request_id, position, ts, user_id, persona_id, slot, p_shown, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const now = ctx.now();
    for (const c of cards) ins.run(requestId, c.position, now, userId, c.personaId, c.slot, c.pShown, c.score);
  }
  return { requestId, cards };
}
