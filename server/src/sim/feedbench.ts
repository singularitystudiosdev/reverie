/**
 * Feed bench: the ranker alone against users with hidden tastes, fast and without Bernoulli
 * noise in the metric. Same hidden user model as the closed-loop simulation (taste clusters over
 * categories, persona quality, gender / age / style preferences), plus an optional latent "look"
 * factor no tag carries (--latent 1). Warm-up users swipe two decks each under the feed's own
 * policy, so the global stats are what that policy would collect; then fresh test users swipe
 * --sessions decks each, and every card served is scored by its TRUE like probability.
 * Yardsticks: each user's oracle (their own best personas, in order) and a static deck in the
 * order of the population's true mean like rate. No lifecycle, no chats.
 *
 *   node src/sim/feedbench.ts [--seed 7] [--rseed 8] [--latent 0] [--warm 1000] [--test 300] [--sessions 5] [--deck 6] [--page 0] [--cfg '{"feed":{"tsScale":0}}']
 *
 * --page 3 plays the app's own paging (src/state/store.tsx): ask for 10 cards, swipe the first 3,
 * ask again, until the session's --deck cards are swiped. --page 0 swipes one page of --deck.
 *
 * Prints one JSON line: meanP (mean true like probability per card) and its SE, per-session
 * means, the yardsticks, the share of cards outside the user's preferred gender, and how well
 * the model's persona like rates track the true population rates (corrModel) next to the raw and
 * IPW rates from the rollups.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext } from '../app.ts';
import { SERVER_ROOT } from '../config.ts';
import { getFeedModel } from '../feed/model.ts';
import { buildFeed } from '../feed/ranker.ts';
import { offlineLlm } from '../llm/claude.ts';
import { feedTags, type Persona } from '../personas/schema.ts';
import { makeRng } from '../stats/random.ts';
import { ingest } from '../telemetry/ingest.ts';
import { computeAllStats } from '../telemetry/rollups.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: number) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const sarg = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const SEED = arg('seed', 7);
const LATENT = arg('latent', 0);
const WARM = arg('warm', 1500);
const TEST = arg('test', 800);
const SESSIONS = arg('sessions', 5);
const DECK = arg('deck', 6);
const PAGE = arg('page', 0);
const CFG = JSON.parse(sarg('cfg') ?? '{}');

const CLUSTERS: Record<string, string[]> = {
  anime: ['anime', 'japanese-folklore', 'cozy', 'sweet', 'playful'],
  dark: ['goth', 'dark-romance', 'supernatural', 'mysterious', 'regal'],
  fae: ['fantasy-art', 'fantasy-creature', 'nature', 'ocean', 'magic'],
  city: ['realistic', 'city-life', 'artsy', 'teasing', 'music'],
  homey: ['cartoon', 'food', 'cozy', 'nurturing', 'adventure'],
  novel: ['animal-anthro', 'mature', 'curvy', 'dance', 'chaotic', 'wholesome'],
};
const NAMES = Object.keys(CLUSTERS);
const SEED_QUALITY: Record<string, number> = {
  sylvara: 0.3, vesper: 0.35, hanami: 0.2, nerissa: 0.1, cinder: 0.25, isolde: -1.1, nova: 0.15,
  luna: 0.05, clementine: 0.2, maya: 0.1, kiyo: 0.4, zahra: 0.0, raven: -0.9, ada: 0.05,
};
const AGE_BAND: Record<string, number> = { 'young-adult': 0, adult: 1, 'ageless-adult': 1, 'mature-adult': 2, 'senior-adult': 3 };
const sig = (x: number) => 1 / (1 + Math.exp(-x));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedbench-'));
const personasDir = path.join(dir, 'personas');
fs.mkdirSync(personasDir);
for (const f of fs.readdirSync(path.join(SERVER_ROOT, 'personas'))) if (f.endsWith('.md')) fs.copyFileSync(path.join(SERVER_ROOT, 'personas', f), path.join(personasDir, f));
let now = Date.UTC(2026, 10, 12);
const ctx = createContext(
  { dbPath: path.join(dir, 'b.db'), personasDir, ...CFG, lifecycle: { requireArt: false, ...(CFG.lifecycle ?? {}) } },
  offlineLlm,
  () => now,
);
// --rseed: the ranker's own random stream, apart from the world's: repeat a setting under a few
// of them to see how far a run moves on the ranker's draws alone.
ctx.rng = makeRng(arg('rseed', SEED + 1));
ctx.db.exec('PRAGMA synchronous = OFF');

// The hidden world, drawn from its own stream so every ranker variant sees the same world and users.
const world = makeRng(SEED * 7919 + 3);
const outcome = makeRng(SEED * 104729 + 11);
const personas: Persona[] = ctx.personas.servable().sort((a, b) => (a.meta.id < b.meta.id ? -1 : 1));
const truth = new Map<string, { quality: number; v: number[] }>();
for (const p of personas) {
  const novelHits = p.meta.categories.filter((c: string) => CLUSTERS.novel.includes(c)).length;
  const q = SEED_QUALITY[p.meta.id] ?? -0.2 + 0.35 * novelHits + world.normal() * 0.25;
  truth.set(p.meta.id, { quality: q, v: [world.normal(), world.normal(), world.normal(), world.normal()] });
}

interface U { id: string; taste: Map<string, number>; g: string; maxAge: number; style: string | null; v: number[] }
function makeUser(id: string): U {
  const taste = new Map<string, number>();
  const k = world() < 0.6 ? 1 : 2;
  const picks = new Set<string>();
  while (picks.size < k) picks.add(world() < 0.18 ? 'novel' : world.pick(NAMES.filter((c) => c !== 'novel')));
  for (const c of picks) for (const cat of CLUSTERS[c]) taste.set(cat, (taste.get(cat) ?? 0) + 2.2 + world.normal() * 0.4);
  const r = world();
  const s = world();
  return {
    id,
    taste,
    g: r < 0.78 ? 'female' : r < 0.9 ? 'male' : 'any',
    maxAge: world() < 0.65 ? 1 : 3,
    style: s < 0.45 ? 'anime' : s < 0.75 ? 'realistic' : null,
    v: [world.normal(), world.normal(), world.normal(), world.normal()],
  };
}
function likeP(u: U, pid: string): number {
  const p = ctx.personas.get(pid)!;
  const cats: string[] = p.meta.categories;
  const aff = cats.reduce((a, c) => a + (u.taste.get(c) ?? 0), 0) / Math.max(cats.length, 1);
  let x = -1.6 + 1.3 * aff + truth.get(pid)!.quality;
  const g = p.meta.gender;
  if (u.g !== 'any' && g !== u.g) x -= g === 'group' ? 0.8 : 2.5;
  const band = AGE_BAND[p.meta.descriptors.age_group] ?? 1;
  if (band > u.maxAge) x -= band - u.maxAge === 1 ? 1.0 : 2.0;
  const st = p.meta.descriptors.aesthetic;
  if (u.style && st !== u.style) x -= st === 'anime' || st === 'realistic' ? 1.2 : 0.5;
  if (LATENT) {
    const v = truth.get(pid)!.v;
    x += (LATENT * (u.v[0] * v[0] + u.v[1] * v[1] + u.v[2] * v[2] + u.v[3] * v[3])) / 2;
  }
  return sig(x);
}

const ms: number[] = [];
const slots: Record<string, number> = {};
// Diversity of what the user actually sees: mean pairwise cosine of the DPP's theme vectors over
// the cards shown from each page (lower = more varied).
const windowSims: number[] = [];
function windowSim(ids: string[]): void {
  if (ids.length < 2) return;
  const vs = getFeedModel(ctx).vectors;
  const cos = (a: number[], b: number[]) => {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? d / Math.sqrt(na * nb) : 0;
  };
  let s = 0, n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { s += cos(vs.get(ids[i]) ?? [], vs.get(ids[j]) ?? []); n++; }
  windowSims.push(s / n);
}
const randomByPersona = new Map<string, number>();
function page(u: U, n: number) {
  const t0 = performance.now();
  const cards = PAGE ? buildFeed(ctx, u.id, { limit: 10, visible: PAGE }).cards.slice(0, Math.min(PAGE, n)) : buildFeed(ctx, u.id, { limit: n }).cards;
  ms.push(performance.now() - t0);
  windowSim(cards.slice(0, PAGE || 3).map((c) => c.personaId));
  return cards;
}
function session(u: U, rec?: { p: number[][]; s: number; wrongGender: number[]; bad: number[] }) {
  const cards = [];
  while (cards.length < DECK) {
    const got = page(u, DECK - cards.length);
    if (!got.length) break;
    cards.push(...got);
    if (PAGE) swipe(u, got, rec);
    if (!PAGE) break;
  }
  if (!PAGE) swipe(u, cards, rec);
  now += 60_000;
}
function swipe(u: U, cards: { personaId: string; slot: string }[], rec?: { p: number[][]; s: number; wrongGender: number[]; bad: number[] }) {
  for (const c of cards) {
    slots[c.slot] = (slots[c.slot] ?? 0) + 1;
    if (c.slot === 'random') randomByPersona.set(c.personaId, (randomByPersona.get(c.personaId) ?? 0) + 1);
    now += 4000;
    ingest(ctx, { type: 'impression', user_id: u.id, persona_id: c.personaId, ts: now });
    const p = likeP(u, c.personaId);
    if (rec) {
      rec.p[rec.s].push(p);
      const g = ctx.personas.get(c.personaId)!.meta.gender;
      rec.wrongGender[rec.s] += u.g !== 'any' && g !== u.g ? 1 : 0;
      rec.bad[rec.s] += p < 0.1 ? 1 : 0;
    }
    const like = outcome() < p;
    ingest(ctx, { type: 'swipe', user_id: u.id, persona_id: c.personaId, props: { dir: like ? 'like' : 'pass' }, ts: now });
    if (like) ingest(ctx, { type: 'match', user_id: u.id, persona_id: c.personaId, ts: now });
  }
}

for (let i = 0; i < WARM; i++) {
  const u = makeUser(`w${i}`);
  session(u);
  session(u);
}
const rec = { p: Array.from({ length: SESSIONS }, () => [] as number[]), s: 0, wrongGender: new Array(SESSIONS).fill(0), bad: new Array(SESSIONS).fill(0) };
// Yardsticks per session: the oracle (each user's own best personas, in order) and a popularity
// deck (one global order by the population's mean true like rate), both without repeats.
const popUsers = Array.from({ length: 2000 }, (_, i) => makeUser(`pop${i}`));
const popMean = new Map<string, number>(personas.map((p) => [p.meta.id, popUsers.reduce((a, u) => a + likeP(u, p.meta.id), 0) / popUsers.length]));
const popOrder = [...popMean].sort((a, b) => b[1] - a[1]).map(([id]) => id);
// After the warm-up: how well does each estimate of a persona's population like rate track the truth?
const pearson = (a: number[], b: number[]) => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db);
};
const est: Record<string, unknown> = {};
{
  const stats = computeAllStats(ctx, false).filter((s) => popMean.has(s.personaId) && s.impressions > 0);
  const truthV = stats.map((s) => popMean.get(s.personaId)!);
  est.corrRaw = +pearson(stats.map((s) => s.likeRate.rate), truthV).toFixed(3);
  est.corrIpw = +pearson(stats.map((s) => s.likeRateIpw.rate), truthV).toFixed(3);
  const model = getFeedModel(ctx);
  const ids = personas.map((p) => p.meta.id).filter((id: string) => model.persona.has(id));
  est.corrModel = +pearson(ids.map((id: string) => { const l = model.persona.get(id)!.like; return l.a / (l.a + l.b); }), ids.map((id: string) => popMean.get(id)!)).toFixed(3);
  // The persona's own term in the model against its hidden quality (the intercept in likeP, which
  // the audience does not move): the raw like rate's logit, and with fitted weights the persona's
  // whole log-odds contribution (weight x log quality factor + its fitted intercept).
  const logit = (x: number) => Math.log(x / (1 - x));
  const hidden = ids.map((id: string) => truth.get(id)!.quality);
  est.corrQualityRaw = +pearson(ids.map((id: string) => { const l = model.persona.get(id)!.like; return logit(l.a / (l.a + l.b)); }), hidden).toFixed(3);
  if (model.calib) {
    const cw = model.calib;
    const term = ids.map((id: string) => {
      const p = ctx.personas.get(id)!;
      const tags = feedTags(p);
      const cat = tags.reduce((a: number, c: string) => { const g = model.category.get(c) ?? { a: 1, b: 2 }; return a + g.a / (g.a + g.b); }, 0) / Math.max(tags.length, 1);
      const l = model.persona.get(id)!.like;
      return cw[2] * Math.log(Math.min(l.a / (l.a + l.b) / Math.max(cat, 1e-3), 3)) + (model.effects?.get(id)?.mean ?? 0);
    });
    est.corrQualityModel = +pearson(term, hidden).toFixed(3);
    est.calib = cw.map((x) => +x.toFixed(3));
  }
  const imps = ids.map((id: string) => model.persona.get(id)!.impressions);
  est.impressionsMedian = imps.sort((a: number, b: number) => a - b)[Math.floor(imps.length / 2)];
}
let oracle = 0;
const oracleBy = new Array(SESSIONS).fill(0);
const popBy = new Array(SESSIONS).fill(0);
for (let i = 0; i < TEST; i++) {
  const u = makeUser(`t${i}`);
  const ps = personas.map((p) => likeP(u, p.meta.id)).sort((a: number, b: number) => b - a);
  oracle += ps.slice(0, DECK * SESSIONS).reduce((a: number, b: number) => a + b, 0) / (DECK * SESSIONS);
  for (let s = 0; s < SESSIONS; s++) {
    oracleBy[s] += ps.slice(s * DECK, (s + 1) * DECK).reduce((a: number, b: number) => a + b, 0) / DECK / TEST;
    popBy[s] += popOrder.slice(s * DECK, (s + 1) * DECK).reduce((a: number, id: string) => a + likeP(u, id), 0) / DECK / TEST;
  }
  for (let s = 0; s < SESSIONS; s++) {
    rec.s = s;
    session(u, rec);
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(xs.length - 1, 1));
};
const all = rec.p.flat();
const out = {
  seed: SEED,
  latent: LATENT,
  cfg: CFG,
  meanP: +mean(all).toFixed(4),
  se: +(sd(all) / Math.sqrt(all.length)).toFixed(4),
  bySession: rec.p.map((xs) => +mean(xs).toFixed(4)),
  wrongGenderShare: +(rec.wrongGender.reduce((a, b) => a + b, 0) / all.length).toFixed(4),
  wrongGenderS1: +(rec.wrongGender[0] / rec.p[0].length).toFixed(4),
  badShare: +(rec.bad.reduce((a, b) => a + b, 0) / all.length).toFixed(4),
  oracle: +(oracle / TEST).toFixed(4),
  oracleBySession: oracleBy.map((x) => +x.toFixed(4)),
  popularity: +(popBy.reduce((a, b) => a + b, 0) / SESSIONS).toFixed(4),
  popularityBySession: popBy.map((x) => +x.toFixed(4)),
  msPerDeck: +mean(ms).toFixed(2),
  page: PAGE,
  windowSim: +mean(windowSims).toFixed(4),
  slotShare: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, +(v / Object.values(slots).reduce((a, b) => a + b, 0)).toFixed(4)])),
  personasWith30Random: [...randomByPersona.values()].filter((v) => v >= 30).length,
  ...est,
};
console.log(JSON.stringify(out));
fs.rmSync(dir, { recursive: true, force: true });
