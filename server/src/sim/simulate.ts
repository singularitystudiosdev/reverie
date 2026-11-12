/**
 * Closed-loop simulation: synthetic users with HIDDEN tastes drive the real
 * server code (ingest, feed, experiments, fade, gate, evolution) on a virtual
 * clock, against a scratch copy of the persona files. It prints the four
 * acceptance checks:
 *   (a) promoted persona edits are ones that truly help (the hidden user model
 *       rewards them), with the false-promotion count
 *   (b) the hidden-worst personas are the ones faded and retired
 *   (c) new personas spawn only after every active persona reached the gate
 *   (d) the personalised feed beats a static deck (a 10% static holdout)
 *
 *   node src/sim/simulate.ts [--days 40] [--users-per-day 220] [--seed 7] [--quiet] [--no-premium] [--no-reports] [--shipped] [--launch-only] [--cfg '{"feed":{...}}']
 *
 * The hidden world: users belong to 1-2 taste clusters over feed categories;
 * one cluster wants categories the seed roster does not have (animal-anthro,
 * mature, curvy, dance), which only the explore branch can find. A persona's
 * reply features come from its markdown (the sim reads the effective persona
 * text, variant included): lines the offline proposer can add change how
 * often replies end with a question, run long, or repeat, and the hidden
 * continue model punishes no-question, long and repeated replies.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext } from '../app.ts';
import { SERVER_ROOT } from '../config.ts';
import type { Ctx } from '../context.ts';
import { effectivePersona } from '../experiments/engine.ts';
import { buildFeed } from '../feed/ranker.ts';
import { offlineLlm } from '../llm/claude.ts';
import { serializePersona } from '../personas/markdown.ts';
import { makeRng, type Rng } from '../stats/random.ts';
import { tick, renderReport, type TickReport } from '../jobs/scheduler.ts';
import { ingest, type IncomingEvent } from '../telemetry/ingest.ts';
import { computeAllStats } from '../telemetry/rollups.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: number) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const DAYS = arg('days', 40);
const USERS_PER_DAY = arg('users-per-day', 220);
const SEED = arg('seed', 7);
// Drop events the app does not send yet, to check the loop still works on what it does send.
// The random draws are unchanged, so a seed simulates the same users either way.
const NO_PREMIUM = args.includes('--no-premium');
const NO_REPORTS = args.includes('--no-reports');
// --shipped: the server's default thresholds (gate, fade, experiments) instead of the relaxed ones
// below; only art (no generator in a simulation) and the served-replies rule (the simulator plays
// the replies) are switched off.
const SHIPPED = args.includes('--shipped');
// --launch-only: the 14 launch personas alone (the roster the first acceptance runs used).
const LAUNCH_ONLY = args.includes('--launch-only');
const QUIET = args.includes('--quiet');
// --cfg: feed settings to compare in the closed loop (only `feed` is read; the rest stays the run's own).
const CFG_FEED = (() => {
  const i = args.indexOf('--cfg');
  return i >= 0 ? (JSON.parse(args[i + 1]) as { feed?: Record<string, unknown> }).feed : undefined;
})();
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 12);

const CLUSTERS: Record<string, string[]> = {
  anime: ['anime', 'japanese-folklore', 'cozy', 'sweet', 'playful'],
  dark: ['goth', 'dark-romance', 'supernatural', 'mysterious', 'regal'],
  fae: ['fantasy-art', 'fantasy-creature', 'nature', 'ocean', 'magic'],
  city: ['realistic', 'city-life', 'artsy', 'teasing', 'music'],
  homey: ['cartoon', 'food', 'cozy', 'nurturing', 'adventure'],
  // Hidden demand the seed roster does not serve.
  novel: ['animal-anthro', 'mature', 'curvy', 'dance', 'chaotic', 'wholesome'],
};
const CLUSTER_NAMES = Object.keys(CLUSTERS);

/** Hidden per-persona quality for the seed roster: two deliberate duds. */
const SEED_QUALITY: Record<string, number> = {
  sylvara: 0.3, vesper: 0.35, hanami: 0.2, nerissa: 0.1, cinder: 0.25, isolde: -1.1, nova: 0.15,
  luna: 0.05, clementine: 0.2, maya: 0.1, kiyo: 0.4, zahra: 0.0, raven: -0.9, ada: 0.05,
};
/** Hidden reply habits per seed persona (how often replies end in a question, run long). */
const SEED_HABITS: Record<string, { q: number; long: number }> = {
  sylvara: { q: 0.55, long: 0.2 }, vesper: { q: 0.45, long: 0.35 }, hanami: { q: 0.6, long: 0.15 }, nerissa: { q: 0.3, long: 0.45 },
  cinder: { q: 0.5, long: 0.2 }, isolde: { q: 0.25, long: 0.5 }, nova: { q: 0.5, long: 0.25 }, luna: { q: 0.35, long: 0.4 },
  clementine: { q: 0.6, long: 0.2 }, maya: { q: 0.4, long: 0.3 }, kiyo: { q: 0.55, long: 0.2 }, zahra: { q: 0.3, long: 0.45 },
  raven: { q: 0.2, long: 0.1 }, ada: { q: 0.45, long: 0.3 },
};

interface SimUser {
  id: string;
  taste: Map<string, number>;
  chattiness: number;
  flirtPref: number;
  returnBase: number;
  holdout: boolean;
  active: boolean;
  premium: boolean;
  matches: string[];
  resetPending: boolean;
  /** Hard-ish preferences real users have and the loop is not told: who, how old, which art style. */
  genderPref: 'female' | 'male' | 'any';
  maxAgeBand: number; // 0 young adult .. 3 senior; 3 = no age preference
  stylePref: 'anime' | 'realistic' | null;
}

const sig = (x: number) => 1 / (1 + Math.exp(-x));

function makeUser(rng: Rng, i: number, day: number): SimUser {
  const taste = new Map<string, number>();
  const k = rng() < 0.6 ? 1 : 2;
  const picks = new Set<string>();
  while (picks.size < k) picks.add(rng() < 0.18 ? 'novel' : rng.pick(CLUSTER_NAMES.filter((c) => c !== 'novel')));
  for (const c of picks) for (const cat of CLUSTERS[c]) taste.set(cat, (taste.get(cat) ?? 0) + 2.2 + rng.normal() * 0.4);
  return {
    id: `sim_${day}_${i}`,
    taste,
    chattiness: rng.normal() * 0.4,
    flirtPref: 3 + rng() * 5,
    returnBase: -0.6 + rng.normal() * 0.5,
    holdout: rng() < 0.1,
    active: true,
    premium: false,
    matches: [],
    resetPending: false,
    // Drawn last so the earlier draws (taste, chattiness...) are what they always were for a seed.
    genderPref: (() => {
      const r = rng();
      return r < 0.78 ? 'female' : r < 0.9 ? 'male' : 'any';
    })(),
    maxAgeBand: rng() < 0.65 ? 1 : 3,
    stylePref: (() => {
      const r = rng();
      return r < 0.45 ? 'anime' : r < 0.75 ? 'realistic' : null;
    })(),
  };
}

const AGE_BAND: Record<string, number> = { 'young-adult': 0, adult: 1, 'ageless-adult': 1, 'mature-adult': 2, 'senior-adult': 3 };

/** Log-odds penalty for a persona outside the user's gender, age and style preferences. */
function traitPenalty(u: SimUser, p: { meta: { gender: string; descriptors: { age_group: string; aesthetic: string } } }): number {
  let x = 0;
  const g = p.meta.gender;
  if (u.genderPref !== 'any' && g !== u.genderPref) x -= g === 'group' ? 0.8 : 2.5;
  const band = AGE_BAND[p.meta.descriptors.age_group] ?? 1;
  if (band > u.maxAgeBand) x -= band - u.maxAgeBand === 1 ? 1.0 : 2.0;
  const style = p.meta.descriptors.aesthetic;
  if (u.stylePref && style !== u.stylePref) x -= style === 'anime' || style === 'realistic' ? 1.2 : 0.5;
  return x;
}

interface Truth {
  quality: number;
  q: number;
  long: number;
}

const baseTruth = new Map<string, { quality: number; habits: { q: number; long: number } }>();

/** The hidden truth for a persona, read from its effective markdown (variant included). */
function truthFor(ctx: Ctx, rng: Rng, cache: Map<string, Truth>, userId: string, personaId: string): Truth {
  const eff = effectivePersona(ctx, userId, personaId);
  const p = eff?.persona ?? ctx.personas.get(personaId)!;
  const md = serializePersona(p);
  const key = `${personaId}@${p.meta.version}#${eff?.arm ?? ''}${eff?.experimentId ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let quality = SEED_QUALITY[personaId];
  let habits = SEED_HABITS[personaId];
  if (quality === undefined) {
    // A persona without a planted truth (a starter or a spawned one): its hidden quality is what the
    // hidden demand makes of its categories. Drawn ONCE per persona, so both arms of a test share it
    // and only the edit itself can differ between them.
    let base = baseTruth.get(personaId);
    if (!base) {
      const novelHits = p.meta.categories.filter((c) => CLUSTERS.novel.includes(c)).length;
      const parent = p.meta.parent ? SEED_QUALITY[p.meta.parent] ?? 0 : null;
      base = {
        quality: (parent !== null ? parent * 0.8 : -0.2) + 0.35 * novelHits + rng.normal() * 0.25,
        habits: { q: 0.3 + rng() * 0.4, long: 0.15 + rng() * 0.35 },
      };
      baseTruth.set(personaId, base);
    }
    quality = base.quality;
    habits = base.habits;
  }
  let { q, long } = habits;
  // Lines the offline proposer can add, and what they really do to reply habits.
  if (/end most replies with one easy, specific question/.test(md)) q = Math.max(q, 0.85);
  if (/keep any question at the very end of the reply/.test(md)) q = Math.min(1, q + 0.15);
  if (/keep replies to one or two short sentences/.test(md)) long = Math.min(long, 0.08);
  if (/share something of your own before asking anything/.test(md)) q = Math.max(0.3, q - 0.2); // a plausible edit that hurts here
  const t = { quality, q, long };
  cache.set(key, t);
  return t;
}

function likeProb(u: SimUser, ctx: Ctx, personaId: string, quality: number): number {
  const p = ctx.personas.get(personaId);
  const cats = p?.meta.categories ?? [];
  const aff = cats.reduce((a, c) => a + (u.taste.get(c) ?? 0), 0) / Math.max(cats.length, 1);
  return sig(-1.6 + 1.3 * aff + quality + (p ? traitPenalty(u, p) : 0));
}

const FILLER = 'The light here moves slowly, like it has all evening. I keep thinking about what you said.';

function personaText(rng: Rng, t: Truth, flirtLevel: number, last: string | null, turn: number): string {
  if (last && rng() < 0.06) return last; // a repeated line
  let s = rng() < t.long ? `${FILLER} ${FILLER} ${FILLER}` : 'Mm, I like that.';
  if (rng() < flirtLevel / 14) s += ' Come a little closer, darling.';
  if (rng() < t.q) s += turn % 2 ? ' What about you?' : ' Tell me more?';
  return s;
}

const USER_LINES = ['hey', 'how are you?', 'what are you doing right now?', 'tell me about your world', 'you are cute', 'haha', 'ok', 'lol that is wild', 'I had a long day', 'what do you like to do?', 'take me somewhere'];

async function run() {
  const rng = makeRng(SEED);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reverie-sim-'));
  const personasDir = path.join(dir, 'personas');
  fs.mkdirSync(personasDir);
  for (const f of fs.readdirSync(path.join(SERVER_ROOT, 'personas'))) {
    if (!f.endsWith('.md') || (LAUNCH_ONLY && !(f.replace(/\.md$/, '') in SEED_QUALITY))) continue;
    fs.copyFileSync(path.join(SERVER_ROOT, 'personas', f), path.join(personasDir, f));
  }
  let now = T0;
  const ctx = createContext(
    {
      dbPath: path.join(dir, 'sim.db'),
      personasDir,
      ...(CFG_FEED ? { feed: CFG_FEED } : {}),
      ...(SHIPPED
        ? { lifecycle: { requireArt: false }, experiments: { requireServedReplies: false } }
        : {
            lifecycle: { requireArt: false, gateMde: 0.1, gateMinImpressions: 300, gateMinConversations: 120, minActive: 10, fadeStreak: 2 },
            // The simulator plays every reply from the persona text (variant included), so tests are real here.
            experiments: { minPerArm: 120, maxPerArm: 900, minConversationsForProposal: 80, requireServedReplies: false },
            telemetry: { patternMinSupport: 25 },
          }),
    },
    offlineLlm,
    () => now,
  );
  ctx.rng = makeRng(SEED + 1);
  ctx.db.exec('PRAGMA synchronous = OFF');
  const emit = (e: IncomingEvent) => ingest(ctx, { ...e, ts: now });
  const truthCache = new Map<string, Truth>();
  const users: SimUser[] = [];
  const seedOrder = ['sylvara', 'kiyo', 'nerissa', 'cinder', 'isolde', 'clementine', 'zahra', 'raven', 'ada', 'vesper', 'nova', 'maya', 'luna', 'hanami'];
  const metrics = { feed: { imp: 0, likes: 0, deep: 0, users: new Set<string>() }, static: { imp: 0, likes: 0, deep: 0, users: new Set<string>() } };
  let gateOpenedDay: number | null = null;
  let firstSpawnDay: number | null = null;
  const spawnBeforeGate: string[] = [];
  let lastReport: TickReport | null = null;

  for (let day = 0; day < DAYS; day++) {
    now = T0 + day * DAY + 9 * 3_600_000;
    for (let i = 0; i < USERS_PER_DAY; i++) users.push(makeUser(rng, i, day));
    const today = users.filter((u) => u.active);
    for (const u of today) {
      const arm = u.holdout ? metrics.static : metrics.feed;
      arm.users.add(u.id);
      emit({ type: 'session_start', user_id: u.id });
      // 1) Swipe a deck.
      let deck: string[];
      if (u.holdout) {
        const seen = new Set((ctx.db.prepare('SELECT persona_id FROM impressions WHERE user_id = ?').all(u.id) as { persona_id: string }[]).map((r) => r.persona_id));
        deck = [...seedOrder, ...ctx.personas.servable().map((p) => p.meta.id).filter((id) => !seedOrder.includes(id))]
          .filter((id) => ctx.personas.get(id) && ctx.personas.get(id)!.meta.status !== 'retired' && ctx.personas.get(id)!.meta.status !== 'draft' && !seen.has(id))
          .slice(0, 6);
      } else deck = buildFeed(ctx, u.id, { limit: 6, includePassed: u.resetPending }).cards.map((c) => c.personaId);
      u.resetPending = false;
      for (const pid of deck) {
        now += 4_000;
        emit({ type: 'impression', user_id: u.id, persona_id: pid });
        arm.imp++;
        const t = truthFor(ctx, rng, truthCache, u.id, pid);
        const like = rng() < likeProb(u, ctx, pid, t.quality);
        emit({ type: 'swipe', user_id: u.id, persona_id: pid, props: { dir: like ? 'like' : 'pass' } });
        if (like) {
          arm.likes++;
          emit({ type: 'match', user_id: u.id, persona_id: pid });
          u.matches.push(pid);
        }
      }
      // 2) Chat with up to two matches (the newest first).
      for (const pid of [...u.matches].reverse().slice(0, 2)) {
        const conv = ctx.db.prepare('SELECT user_turns, farewell_turn FROM conversations WHERE id = ?').get(`${u.id}:${pid}`) as { user_turns: number; farewell_turn: number | null } | undefined;
        if (conv?.farewell_turn) continue;
        const p = ctx.personas.get(pid);
        if (!p) continue;
        emit({ type: 'chat_open', user_id: u.id, persona_id: pid });
        const t = truthFor(ctx, rng, truthCache, u.id, pid);
        let turn = conv?.user_turns ?? 0;
        let last: string | null = null;
        let continued = true;
        const start = now;
        for (let k = 0; k < 14 && continued; k++) {
          turn++;
          now += 25_000;
          const bye = turn > 2 && rng() < 0.035;
          emit({ type: 'message', user_id: u.id, persona_id: pid, props: { from: 'user', text: bye ? 'ok I gotta go, bye!' : rng.pick(USER_LINES) } });
          if (bye) break;
          now += 8_000;
          const text = personaText(rng, t, p.meta.flirt_level, last, turn);
          const repeated = text === last;
          last = text;
          emit({ type: 'message', user_id: u.id, persona_id: pid, props: { from: 'persona', text } });
          const ends = /\?$/.test(text);
          const isLong = text.length > 180;
          const early = turn <= 5;
          const x = 2.0 + u.chattiness + 0.6 * t.quality + (ends ? 0.5 : early ? -0.9 : -0.4) + (isLong ? -0.8 : 0) + (repeated ? -1.2 : 0) - 0.06 * turn - 0.08 * Math.abs(p.meta.flirt_level - u.flirtPref);
          continued = rng() < sig(x);
        }
        emit({ type: 'chat_close', user_id: u.id, persona_id: pid, props: { duration_ms: now - start } });
        if (turn >= ctx.cfg.telemetry.deepChatTurns) (u.holdout ? metrics.static : metrics.feed).deep++;
        if (rng() < 0.004 + (t.quality < -0.5 ? 0.02 : 0)) {
          const type = rng() < 0.5 ? 'report' : 'block';
          if (!NO_REPORTS) emit({ type, user_id: u.id, persona_id: pid });
        }
        if (rng() < 0.15) emit({ type: 'deck_return', user_id: u.id, persona_id: pid });
        if (!u.premium && rng() < 0.004 + (turn >= 10 ? 0.02 : 0)) {
          u.premium = true;
          if (!NO_PREMIUM) {
            emit({ type: 'premium_view', user_id: u.id, persona_id: pid });
            emit({ type: 'premium_convert', user_id: u.id, props: { plan: 'monthly' } });
          }
        }
      }
      if (rng() < 0.05) {
        emit({ type: 'deck_reset', user_id: u.id });
        u.resetPending = true;
      }
      emit({ type: 'session_end', user_id: u.id });
      // 3) Do they come back tomorrow?
      const deepToday = u.matches.length > 0 ? 0.6 : -0.4;
      u.active = rng() < sig(u.returnBase + deepToday);
    }
    // Two ticks per day.
    for (const h of [13, 21]) {
      now = T0 + day * DAY + h * 3_600_000;
      const r = await tick(ctx, { writeReport: false });
      lastReport = r;
      if (r.gate.open && gateOpenedDay === null) gateOpenedDay = day;
      if (r.spawned.length) {
        if (firstSpawnDay === null) firstSpawnDay = day;
        const blockedBefore = r.gate.personas.filter((g) => !g.reached && !g.flagged && !r.spawned.includes(g.id));
        if (!r.gate.open && blockedBefore.length) spawnBeforeGate.push(...r.spawned);
      }
    }
    if (!QUIET) {
      const g = lastReport!.gate;
      console.log(
        `day ${String(day + 1).padStart(2)}: users ${users.length}, active ${today.length}, personas ${ctx.personas.servable().length}, chats ${(ctx.db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE user_turns > 0').get() as { n: number }).n}, gate ${g.open ? 'open' : `${g.personas.filter((x) => x.reached).length}/${g.personas.length} reached, ${g.personas.filter((x) => x.flagged).length} timed out (needs ${g.nImpressions} impressions, ${g.nConversations} chats each)`}, experiments running ${(ctx.db.prepare("SELECT COUNT(*) AS n FROM experiments WHERE status='running'").get() as { n: number }).n}`,
      );
    }
  }

  // ------------------------------------------------------------ acceptance
  const exps = ctx.db.prepare('SELECT * FROM experiments').all() as { id: number; persona_id: string; status: string; section: string; variant_body: string; pattern_sig: string; source: string }[];
  const helps = (body: string) => /end most replies with one easy, specific question|keep replies to one or two short sentences|keep any question at the very end/.test(body);
  const hurts = (body: string) => /share something of your own before asking anything/.test(body);
  const promoted = exps.filter((e) => e.status === 'promoted');
  const discarded = exps.filter((e) => e.status === 'discarded');
  const truePromotions = promoted.filter((e) => helps(e.variant_body) && !hurts(e.variant_body)).length;
  const harmfulPromoted = promoted.filter((e) => hurts(e.variant_body)).length;
  const harmfulTried = exps.filter((e) => hurts(e.variant_body)).length;
  const log = ctx.db.prepare('SELECT ts, kind, persona_id FROM lifecycle_log ORDER BY id').all() as { ts: number; kind: string; persona_id: string | null }[];
  const faded = log.filter((l) => l.kind === 'fade').map((l) => l.persona_id);
  const retired = log.filter((l) => l.kind === 'retire').map((l) => l.persona_id);
  const spawns = log.filter((l) => l.kind.startsWith('spawn_') && l.kind !== 'spawn_rejected');
  const worstSeeds = Object.entries(SEED_QUALITY).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([id]) => id);
  const rate = (a: number, b: number) => (b ? a / b : 0);
  const feedLike = rate(metrics.feed.likes, metrics.feed.imp);
  const staticLike = rate(metrics.static.likes, metrics.static.imp);
  const feedDeep = rate(metrics.feed.deep, metrics.feed.users.size);
  const staticDeep = rate(metrics.static.deep, metrics.static.users.size);

  console.log(`\n=== Reverie closed-loop simulation: ${DAYS} days, ${users.length} users, seed ${SEED} ===`);
  console.log(`(a) experiments: ${exps.length} opened, ${promoted.length} promoted, ${discarded.length} discarded, ${exps.filter((e) => e.status === 'running').length} running`);
  console.log(`    promoted edits that truly help: ${truePromotions}/${promoted.length}; harmful edit promoted: ${harmfulPromoted}/${harmfulTried} tried`);
  for (const e of promoted) console.log(`      #${e.id} ${e.persona_id} [${e.section}] ${e.pattern_sig} (${e.source})`);
  console.log(`(b) hidden-worst seeds: ${worstSeeds.join(', ')}; faded: ${faded.join(', ') || 'none'}; retired: ${retired.join(', ') || 'none'}`);
  console.log(`(c) gate first open on day ${gateOpenedDay === null ? '-' : gateOpenedDay + 1}; first spawn on day ${firstSpawnDay === null ? '-' : firstSpawnDay + 1}; spawns while gate closed: ${spawnBeforeGate.length}`);
  for (const s of spawns) {
    const p = ctx.personas.get(s.persona_id!);
    console.log(`      day ${Math.floor((s.ts - T0) / DAY) + 1} ${s.kind}: ${s.persona_id} (${p?.meta.kind}; ${p?.meta.categories.join(', ')}${p?.meta.parent ? `; parent ${p.meta.parent}` : ''}) status ${p?.meta.status}`);
  }
  console.log(`(d) like rate per impression: feed ${(feedLike * 100).toFixed(1)}% vs static ${(staticLike * 100).toFixed(1)}% (n=${metrics.feed.imp} / ${metrics.static.imp}); deep chats per user: feed ${feedDeep.toFixed(2)} vs static ${staticDeep.toFixed(2)}`);
  // (e) Does the IPW like rate remove the feed's bias? Each persona's hidden population like rate
  // (the true like probability averaged over every simulated user) against three estimates.
  const ipwRows: { truth: number; naive: number; ipw: number; random: number | null }[] = [];
  for (const st of computeAllStats(ctx, false)) {
    if (st.impressions < 200) continue;
    const t = truthFor(ctx, rng, truthCache, '__probe__', st.personaId);
    const truth = users.reduce((a, u) => a + likeProb(u, ctx, st.personaId, t.quality), 0) / users.length;
    const raw = ctx.db
      .prepare("SELECT COUNT(*) AS n, SUM(outcome = 'like') AS x FROM impressions WHERE persona_id = ? AND outcome IS NOT NULL")
      .get(st.personaId) as { n: number; x: number | null };
    ipwRows.push({
      truth,
      naive: raw.n ? (raw.x ?? 0) / raw.n : 0,
      ipw: st.likeRateIpw.rate,
      random: st.likeRateRandom.n >= 30 ? st.likeRateRandom.rate : null,
    });
  }
  const mae = (f: (r: (typeof ipwRows)[number]) => number | null) => {
    const v = ipwRows.filter((r) => f(r) !== null);
    return v.length ? `${((v.reduce((a, r) => a + Math.abs(f(r)! - r.truth), 0) / v.length) * 100).toFixed(1)}pp (n=${v.length})` : '-';
  };
  const bias = (f: (r: (typeof ipwRows)[number]) => number | null) => {
    const v = ipwRows.filter((r) => f(r) !== null);
    return v.length ? `${((v.reduce((a, r) => a + (f(r)! - r.truth), 0) / v.length) * 100).toFixed(1)}pp` : '-';
  };
  console.log(`(e) like-rate estimates vs the hidden population rate, personas with 200+ impressions: mean abs error naive ${mae((r) => r.naive)}, IPW ${mae((r) => r.ipw)}, random-slot ${mae((r) => r.random)}; mean bias naive ${bias((r) => r.naive)}, IPW ${bias((r) => r.ipw)}, random-slot ${bias((r) => r.random)}`);
  if (lastReport && !QUIET) console.log(`\n${renderReport(ctx, lastReport)}`);
  console.log(`scratch dir (personas as rewritten by the loop, sim.db): ${dir}`);
  return { truePromotions, promoted: promoted.length, harmfulPromoted, faded, retired, worstSeeds, gateOpenedDay, firstSpawnDay, spawnBeforeGate, feedLike, staticLike, feedDeep, staticDeep };
}

const result = await run();
if (process.env.SIM_JSON) console.log(JSON.stringify(result));
