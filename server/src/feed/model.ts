/**
 * The feed's global state, rebuilt from the tables at most every `ttlMs` (and
 * on every scheduler tick): per-persona Beta posteriors for like, deep chat and
 * negative outcomes; per-category like posteriors; the category co-like
 * matrix; per-category incumbents for the new-persona dynamic prior; each
 * persona's feature vector for the DPP kernel.
 */
import type { Ctx } from '../context.ts';
import { DESCRIPTOR_KEYS, feedTags, type Persona } from '../personas/schema.ts';
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

  const persona = new Map<string, PersonaPosterior>();
  for (const p of personas) {
    const s = imp.get(p.meta.id) ?? { n: 0, likes: 0 };
    const isNew = s.n < NEW_PERSONA_IMPRESSIONS;
    let prior: BetaParams = { a: 1, b: 2 };
    if (isNew) {
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

/** Multi-hot over categories plus one-hot descriptor values: the DPP similarity space. */
function featureVector(p: Persona, categories: string[]): number[] {
  const tags = feedTags(p);
  const v: number[] = categories.map((c) => (tags.includes(c) ? 1 : 0));
  for (const k of DESCRIPTOR_KEYS) {
    // Hash each descriptor value into 8 buckets per axis so the vector length is fixed.
    const val = p.meta.descriptors[k];
    let h = 0;
    for (let i = 0; i < val.length; i++) h = (h * 31 + val.charCodeAt(i)) >>> 0;
    for (let b = 0; b < 8; b++) v.push(h % 8 === b ? 0.5 : 0);
  }
  return v;
}
