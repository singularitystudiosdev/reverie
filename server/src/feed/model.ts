/**
 * The feed's global state, rebuilt from the tables at most every `ttlMs` (and
 * on every scheduler tick): per-persona Beta posteriors for like, deep chat and
 * negative outcomes (each like posterior starts from what the persona's features
 * predict across the roster); per-category like posteriors; the category
 * co-like matrix; per-category incumbents for the new-persona dynamic prior;
 * each persona's theme vector for the DPP kernel.
 */
import type { Ctx } from '../context.ts';
import { feedTags, type Persona } from '../personas/schema.ts';
import { dynamicPrior, type BetaParams } from '../stats/dynamicPrior.ts';

export interface PersonaPosterior {
  like: BetaParams;
  deep: BetaParams;
  negative: BetaParams;
  impressions: number;
  isNew: boolean;
}

export interface FeedModel {
  builtAt: number;
  persona: Map<string, PersonaPosterior>;
  category: Map<string, BetaParams>;
  colike: Map<string, Map<string, number>>;
  colikeRow: Map<string, number>;
  vectors: Map<string, number[]>;
  impressions: Map<string, number>;
  conversations: Map<string, number>;
  categories: string[];
  /** Mean deep-chat and negative rates across the roster (the feed's self-calibrated weights read these). */
  meanDeep: number;
  meanNeg: number;
}

const NEW_PERSONA_IMPRESSIONS = 100;
const cache = new WeakMap<Ctx, FeedModel>();

export function invalidateFeedModel(ctx: Ctx): void {
  cache.delete(ctx);
}

export function getFeedModel(ctx: Ctx, ttlMs = 60_000): FeedModel {
  const m = cache.get(ctx);
  if (m && ctx.now() - m.builtAt < ttlMs) return m;
  const built = buildFeedModel(ctx);
  cache.set(ctx, built);
  return built;
}

export function buildFeedModel(ctx: Ctx): FeedModel {
  const { db, cfg } = ctx;
  const personas = ctx.personas.all().filter((p) => p.meta.status !== 'draft');
  const imp = new Map<string, { n: number; likes: number }>();
  for (const r of db
    .prepare("SELECT persona_id, COUNT(*) AS n, SUM(CASE WHEN outcome = 'like' THEN 1 ELSE 0 END) AS likes FROM impressions WHERE outcome IS NOT NULL GROUP BY persona_id")
    .all() as { persona_id: string; n: number; likes: number }[])
    imp.set(r.persona_id, { n: r.n, likes: r.likes });

  const dropBefore = ctx.now() - cfg.telemetry.dropGapMs;
  const deep = new Map<string, { deep: number; shallow: number; convs: number }>();
  for (const r of db
    .prepare(
      `SELECT persona_id,
         SUM(CASE WHEN user_turns >= ? THEN 1 ELSE 0 END) AS deep,
         SUM(CASE WHEN user_turns < ? AND (last_user_at < ? OR farewell_turn IS NOT NULL) THEN 1 ELSE 0 END) AS shallow,
         COUNT(*) AS convs
       FROM conversations WHERE user_turns > 0 GROUP BY persona_id`,
    )
    .all(cfg.telemetry.deepChatTurns, cfg.telemetry.deepChatTurns, dropBefore) as { persona_id: string; deep: number; shallow: number; convs: number }[])
    deep.set(r.persona_id, r);

  const neg = new Map<string, { n: number; bad: number }>();
  for (const r of db
    .prepare("SELECT persona_id, COUNT(*) AS n, SUM(CASE WHEN end_reason IN ('report','block') THEN 1 ELSE 0 END) AS bad FROM matches GROUP BY persona_id")
    .all() as { persona_id: string; n: number; bad: number }[])
    neg.set(r.persona_id, r);

  // Category like posteriors (each impression credits every category of its persona).
  const category = new Map<string, BetaParams>();
  for (const p of personas) {
    const s = imp.get(p.meta.id) ?? { n: 0, likes: 0 };
    for (const c of feedTags(p)) {
      const cur = category.get(c) ?? { a: 1, b: 2 };
      cur.a += s.likes;
      cur.b += s.n - s.likes;
      category.set(c, cur);
    }
  }

  // Incumbent per category: the persona with the most like-evidence-weighted mean.
  const incumbent = new Map<string, BetaParams>();
  for (const p of personas) {
    const s = imp.get(p.meta.id);
    if (!s || s.n < NEW_PERSONA_IMPRESSIONS) continue;
    const post = { a: 1 + s.likes, b: 1 + s.n - s.likes };
    for (const c of feedTags(p)) {
      const cur = incumbent.get(c);
      if (!cur || post.a / (post.a + post.b) > cur.a / (cur.a + cur.b)) incumbent.set(c, post);
    }
  }
  const globalIncumbent = [...incumbent.values()].sort((x, y) => y.a / (y.a + y.b) - x.a / (x.a + x.b))[0] ?? { a: 30, b: 70 };

  // Each persona's like rate is shrunk toward what its features predict across the roster
  // (empirical Bayes), not toward one flat Beta(1, 2): a persona with a few dozen impressions
  // starts where personas like it stand, so a new user's first deck is ordered by the best
  // estimate of each persona's appeal rather than by the noise in a handful of swipes.
  const featurePrior = personaFeaturePrior(personas, imp);
  const persona = new Map<string, PersonaPosterior>();
  for (const p of personas) {
    const s = imp.get(p.meta.id) ?? { n: 0, likes: 0 };
    const isNew = s.n < NEW_PERSONA_IMPRESSIONS;
    const fp = featurePrior.get(p.meta.id)!;
    let prior: BetaParams = { a: fp.mean * fp.strength, b: (1 - fp.mean) * fp.strength };
    // A persona the loop adds to an established roster starts pessimistic (dynamic-prior Thompson
    // sampling) so newcomers cannot flood decks before data arrives; the launch roster (branch
    // seed) are all newcomers together and need no such brake.
    if (isNew && p.meta.branch !== 'seed') {
      const inc = incumbent.get(p.meta.categories[1] ?? p.meta.categories[0]) ?? globalIncumbent;
      prior = dynamicPrior(inc, cfg.feed.newEps, Math.min(cfg.feed.newPriorStrength, (inc.a + inc.b) * 0.1 + 2));
    }
    const d = deep.get(p.meta.id) ?? { deep: 0, shallow: 0, convs: 0 };
    const ng = neg.get(p.meta.id) ?? { n: 0, bad: 0 };
    persona.set(p.meta.id, {
      like: { a: prior.a + s.likes, b: prior.b + s.n - s.likes },
      deep: { a: 1 + d.deep, b: 4 + d.shallow },
      negative: { a: 0.2 + ng.bad, b: 10 + ng.n - ng.bad },
      impressions: s.n,
      isNew,
    });
  }

  const colike = new Map<string, Map<string, number>>();
  const colikeRow = new Map<string, number>();
  for (const r of db.prepare('SELECT cat_a, cat_b, n FROM colike').all() as { cat_a: string; cat_b: string; n: number }[]) {
    const row = colike.get(r.cat_a) ?? new Map<string, number>();
    row.set(r.cat_b, r.n);
    colike.set(r.cat_a, row);
    colikeRow.set(r.cat_a, (colikeRow.get(r.cat_a) ?? 0) + r.n);
  }

  const categories = [...new Set(personas.flatMap((p) => feedTags(p)))].sort();
  const vectors = new Map<string, number[]>();
  for (const p of personas) vectors.set(p.meta.id, featureVector(p, categories));

  const conversations = new Map<string, number>();
  for (const [id, d] of deep) conversations.set(id, d.convs);
  const posts = [...persona.values()];
  const meanOf = (f: (p: PersonaPosterior) => BetaParams) =>
    posts.length ? posts.reduce((a, p) => a + f(p).a / (f(p).a + f(p).b), 0) / posts.length : 0.2;
  return {
    meanDeep: meanOf((p) => p.deep),
    meanNeg: meanOf((p) => p.negative),
    builtAt: ctx.now(),
    persona,
    category,
    colike,
    colikeRow,
    vectors,
    impressions: new Map([...imp].map(([k, v]) => [k, v.n])),
    conversations,
    categories,
  };
}

/**
 * Multi-hot over theme categories: the DPP similarity space. Gender, age and art style are left
 * out on purpose (and the descriptor hashes with them): the trait factor scores those per user,
 * and a diversity kernel over them pushed a user's ruled-out genders and ages back into the deck
 * as "variety". X's vm-ranker runs its DPP over learned post embeddings, not hand tags.
 */
function featureVector(p: Persona, categories: string[]): number[] {
  const tags = new Set(p.meta.categories);
  return categories.map((c) => (tags.has(c) ? 1 : 0));
}

/**
 * The roster-level prior for every persona's like rate: a ridge logistic regression of each
 * persona's likes on its features (theme tags, gender, age band, art style; binomial counts,
 * Newton's method), with a prior strength from the method of moments (how far true rates
 * scatter around the regression beyond binomial noise). The cold-start move content-based
 * recommenders make for new items, at roster scale. Before there is data: 20% at strength 20.
 */
function personaFeaturePrior(personas: Persona[], imp: Map<string, { n: number; likes: number }>): Map<string, { mean: number; strength: number }> {
  const index = new Map<string, number>();
  const rowsOf = new Map<string, number[]>();
  for (const p of personas) {
    const keys = [...new Set(p.meta.categories)].map((c) => `tag:${c}`);
    keys.push(`gender:${p.meta.gender}`, `age:${p.meta.descriptors.age_group}`, `style:${p.meta.descriptors.aesthetic}`);
    rowsOf.set(
      p.meta.id,
      keys.map((k) => {
        if (!index.has(k)) index.set(k, index.size + 1);
        return index.get(k)!;
      }),
    );
  }
  const d = index.size + 1; // 0 is the intercept
  const base = Math.log(0.2 / 0.8);
  const w = new Float64Array(d);
  w[0] = base;
  const data = personas
    .map((p) => ({ x: rowsOf.get(p.meta.id)!, s: imp.get(p.meta.id) }))
    .filter((r): r is { x: number[]; s: { n: number; likes: number } } => !!r.s && r.s.n > 0);
  // Ridge: N(0, 1) on every feature weight, a vague N(logit 0.2, 10^2) on the intercept.
  const prec = (j: number) => (j === 0 ? 0.01 : 1);
  const mu = (j: number) => (j === 0 ? base : 0);
  for (let iter = 0; iter < 25 && data.length; iter++) {
    const g = new Float64Array(d);
    const h = new Float64Array(d * d);
    for (let j = 0; j < d; j++) {
      g[j] = -prec(j) * (w[j] - mu(j));
      h[j * d + j] = prec(j);
    }
    for (const r of data) {
      const idx = [0, ...r.x];
      let z = 0;
      for (const j of idx) z += w[j];
      const p = 1 / (1 + Math.exp(-z));
      const resid = r.s.likes - r.s.n * p;
      const curv = r.s.n * p * (1 - p);
      for (const a of idx) {
        g[a] += resid;
        for (const b of idx) h[a * d + b] += curv;
      }
    }
    const step = solveSpd(h, d, g);
    if (!step) break;
    let max = 0;
    for (let j = 0; j < d; j++) max = Math.max(max, Math.abs(step[j]));
    const damp = max > 4 ? 4 / max : 1;
    for (let j = 0; j < d; j++) w[j] += damp * step[j];
    if (max * damp < 1e-6) break;
  }
  const means = new Map<string, number>();
  for (const p of personas) {
    let z = w[0];
    for (const j of rowsOf.get(p.meta.id)!) z += w[j];
    means.set(p.meta.id, 1 / (1 + Math.exp(-z)));
  }
  // Method of moments over personas with a real sample: excess scatter of their rates around the regression.
  let excess = 0;
  let spread = 0;
  let k = 0;
  for (const p of personas) {
    const s = imp.get(p.meta.id);
    if (!s || s.n < 30) continue;
    const m = means.get(p.meta.id)!;
    excess += (s.likes / s.n - m) ** 2 - (m * (1 - m)) / s.n;
    spread += m * (1 - m);
    k++;
  }
  const strength = k >= 10 ? Math.min(Math.max(spread / Math.max(excess, 1e-6) - 1, 5), 300) : 20;
  return new Map([...means].map(([id, mean]) => [id, { mean, strength }]));
}

/** Solve A x = b for a symmetric positive-definite A (row-major), or null. */
function solveSpd(a: Float64Array, n: number, b: Float64Array): Float64Array | null {
  const l = Float64Array.from(a);
  for (let j = 0; j < n; j++) {
    let s = l[j * n + j];
    for (let k = 0; k < j; k++) s -= l[j * n + k] * l[j * n + k];
    if (s <= 1e-12) return null;
    const dj = Math.sqrt(s);
    l[j * n + j] = dj;
    for (let i = j + 1; i < n; i++) {
      let t = l[i * n + j];
      for (let k = 0; k < j; k++) t -= l[i * n + k] * l[j * n + k];
      l[i * n + j] = t / dj;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * n + k] * y[k];
    y[i] = s / l[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= l[k * n + i] * x[k];
    x[i] = s / l[i * n + i];
  }
  return x;
}
