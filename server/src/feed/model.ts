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
import { twoProportionN } from '../stats/inference.ts';

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
  /** Persona-to-persona residuals: cf[i][j] = likes of j (o) and the likes the ranker expected (e)
   *  when it served j, among users who liked i. */
  cf: Map<string, Map<string, { o: number; e: number }>>;
  vectors: Map<string, number[]>;
  impressions: Map<string, number>;
  /** Fitted weights [intercept, affinity, quality, traits, cf] on the factors' logs, or null. */
  calib: number[] | null;
  /** Decided random-slot impressions per persona (the fade check's unbiased sample). */
  randomN: Map<string, number>;
  /** Impressions a persona needs before the undersampled slot stops spending traffic on it. */
  gateImpressions: number;
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
  calibCache.delete(ctx);
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
  // Shared statistics read only cards the ranker served (an 'unranked' row is a swipe no serve
  // backs: a lost impression, a replay or a forged event) and give each user one vote per persona
  // (liked at least once, else passed), so a burst of events from one account moves a persona's
  // rate by one swipe at most.
  const imp = new Map<string, { n: number; likes: number }>();
  for (const r of db
    .prepare(
      `SELECT persona_id, COUNT(*) AS n, SUM(liked) AS likes FROM (
         SELECT persona_id, MAX(CASE WHEN outcome = 'like' THEN 1 ELSE 0 END) AS liked
         FROM impressions WHERE outcome IS NOT NULL AND slot != 'unranked' GROUP BY user_id, persona_id
       ) GROUP BY persona_id`,
    )
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

  const cf = cfg.feed.cfWeight > 0 ? buildCf(ctx) : new Map<string, Map<string, { o: number; e: number }>>();

  const randomN = new Map<string, number>();
  for (const r of db
    .prepare("SELECT persona_id, COUNT(*) AS n FROM impressions WHERE slot = 'random' AND outcome IS NOT NULL GROUP BY persona_id")
    .all() as { persona_id: string; n: number }[])
    randomN.set(r.persona_id, r.n);
  // The gate's own impression target (lifecycle/gate.ts): a 2-proportion power calculation at the
  // active roster's mean like rate.
  const l = cfg.lifecycle;
  const rates = personas.filter((p) => p.meta.status === 'active' && (imp.get(p.meta.id)?.n ?? 0) > 0).map((p) => imp.get(p.meta.id)!.likes / imp.get(p.meta.id)!.n);
  const likeBase = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0.3;
  const gateImpressions = cfg.feed.undersampledTarget || Math.max(l.gateMinImpressions, twoProportionN(likeBase, l.gateMde, l.gateAlpha, l.gatePower));

  const categories = [...new Set(personas.flatMap((p) => feedTags(p)))].sort();
  // The kernel leaves out every art-style value (anime, realistic, cartoon...), which 142 of the 154
  // starters also carry as a theme tag: art style is a trait the user is scored on, not variety.
  const styles = new Set(personas.map((p) => p.meta.descriptors.aesthetic));
  const kernelCategories = categories.filter((c) => !styles.has(c));
  const vectors = new Map<string, number[]>();
  for (const p of personas) vectors.set(p.meta.id, featureVector(p, kernelCategories));

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
    cf,
    vectors,
    impressions: new Map([...imp].map(([k, v]) => [k, v.n])),
    randomN,
    gateImpressions,
    calib: cfg.feed.calibrate ? calibration(ctx) : null,
    conversations,
    categories,
  };
}

/**
 * Multi-hot over theme categories (the caller passes them without art-style values): the DPP
 * similarity space. Gender, age and art style are left out on purpose: the trait factor scores
 * those per user, and a diversity kernel over them pushed a user's ruled-out genders and ages back
 * into the deck as "variety". Form (human, dragon, ghost...) stays: it is a theme. X's vm-ranker
 * runs its DPP over learned post embeddings, not hand tags.
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

/**
 * The persona-to-persona residual table behind the ranker's collaborative term: for every user,
 * every persona i they liked and every other card j they decided on, the like (o) and the ranker's
 * prediction for j when it served it (e, the logged p_pred, which leaves this term out). O/E over
 * those pairs is how much more i's fans like j than tags, traits and j's base rate explain.
 * Cards the ranker did not serve (no p_pred) are left out.
 */
function buildCf(ctx: Ctx): Map<string, Map<string, { o: number; e: number }>> {
  const cf = new Map<string, Map<string, { o: number; e: number }>>();
  const flush = (liked: string[], decided: { id: string; like: number; p: number }[]) => {
    for (const i of liked) {
      let row = cf.get(i);
      if (!row) cf.set(i, (row = new Map()));
      for (const d of decided) {
        if (d.id === i) continue;
        const c = row.get(d.id) ?? { o: 0, e: 0 };
        c.o += d.like;
        c.e += d.p;
        row.set(d.id, c);
      }
    }
  };
  let user: string | null = null;
  let liked: string[] = [];
  let decided: { id: string; like: number; p: number }[] = [];
  for (const r of ctx.db
    .prepare("SELECT user_id, persona_id, outcome, p_pred FROM impressions WHERE outcome IS NOT NULL AND slot != 'unranked' ORDER BY user_id")
    .all() as { user_id: string; persona_id: string; outcome: string; p_pred: number | null }[]) {
    if (r.user_id !== user) {
      flush(liked, decided);
      user = r.user_id;
      liked = [];
      decided = [];
    }
    const like = r.outcome === 'like' ? 1 : 0;
    if (like) liked.push(r.persona_id);
    if (r.p_pred !== null) decided.push({ id: r.persona_id, like, p: r.p_pred });
  }
  flush(liked, decided);
  return cf;
}

const CALIB_ROWS = 20_000;
const CALIB_TTL_MS = 10 * 60_000;
const calibCache = new WeakMap<Ctx, { at: number; w: number[] | null }>();

/** The fitted factor weights, refitted at most every 10 minutes (the model itself rebuilds every minute). */
function calibration(ctx: Ctx): number[] | null {
  const c = calibCache.get(ctx);
  if (c && ctx.now() - c.at < CALIB_TTL_MS) return c.w;
  const w = fitCalibration(ctx);
  calibCache.set(ctx, { at: ctx.now(), w });
  return w;
}

/**
 * Weights for the P(like) factors: a logistic regression of the latest decided cards (at most
 * 20,000: bounded cost, and it follows drift) on the logs of the factors the ranker logged when
 * it served each (posterior means), ridge 1 on each weight around 1 (the plain product) and a
 * vague prior on the intercept. Null below 500 such cards.
 */
function fitCalibration(ctx: Ctx): number[] | null {
  const rows = (
    ctx.db
      .prepare('SELECT outcome, factors FROM impressions WHERE outcome IS NOT NULL AND factors IS NOT NULL ORDER BY id DESC LIMIT ?')
      .all(CALIB_ROWS) as { outcome: string; factors: string }[]
  )
    .map((r) => ({ y: r.outcome === 'like' ? 1 : 0, x: [1, ...(JSON.parse(r.factors) as number[])] }))
    .filter((r) => r.x.length === 5 && r.x.every(Number.isFinite));
  if (rows.length < 500) return null;
  const d = 5;
  const w = [Math.log(0.2 / 0.8), 1, 1, 1, 1];
  const mu = [Math.log(0.2 / 0.8), 1, 1, 1, 1];
  const prec = [0.01, 1, 1, 1, 1];
  for (let iter = 0; iter < 25; iter++) {
    const g = new Float64Array(d);
    const h = new Float64Array(d * d);
    for (let j = 0; j < d; j++) {
      g[j] = -prec[j] * (w[j] - mu[j]);
      h[j * d + j] = prec[j];
    }
    for (const r of rows) {
      let z = 0;
      for (let j = 0; j < d; j++) z += w[j] * r.x[j];
      const p = 1 / (1 + Math.exp(-z));
      for (let a = 0; a < d; a++) {
        g[a] += (r.y - p) * r.x[a];
        for (let b = 0; b < d; b++) h[a * d + b] += p * (1 - p) * r.x[a] * r.x[b];
      }
    }
    const step = solveSpd(h, d, g);
    if (!step) break;
    let max = 0;
    for (let j = 0; j < d; j++) max = Math.max(max, Math.abs(step[j]));
    const damp = max > 2 ? 2 / max : 1;
    for (let j = 0; j < d; j++) w[j] += damp * step[j];
    if (max * damp < 1e-6) break;
  }
  return w;
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
