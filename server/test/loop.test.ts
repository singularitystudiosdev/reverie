/**
 * The loop's moving parts against a scratch database and a scratch copy of
 * the persona files: ingest -> rollups, sticky assignment, promotion writing
 * the markdown, fading caps, gate, spawning and the feed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createContext } from '../src/app.ts';
import { SERVER_ROOT, type Config, type DeepPartial } from '../src/config.ts';
import type { Ctx } from '../src/context.ts';
import { assignArm, effectivePersona, promote, type ExperimentRow } from '../src/experiments/engine.ts';
import { startExperiments } from '../src/experiments/start.ts';
import { lordLevel } from '../src/stats/fdr.ts';
import { makeRng } from '../src/stats/random.ts';
import { buildFeed, combineScore } from '../src/feed/ranker.ts';
import { getFeedModel } from '../src/feed/model.ts';
import { planExplore, spawnGeneration } from '../src/lifecycle/evolve.ts';
import { descriptorSpace, growVocabulary, MIN_UNTRIED, occupiedOrTried, untried } from '../src/lifecycle/niches.ts';
import { computeGate } from '../src/lifecycle/gate.ts';
import { fadeTick } from '../src/lifecycle/fade.ts';
import { offlineLlm } from '../src/llm/claude.ts';
import { getSection, parsePersona } from '../src/personas/markdown.ts';
import { ingest } from '../src/telemetry/ingest.ts';
import { computeAllStats } from '../src/telemetry/rollups.ts';
import { chatTurn } from '../src/chat.ts';

function scratch(over: DeepPartial<Config> = {}): { ctx: Ctx; dir: string; clock: { t: number } } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reverie-test-'));
  const personasDir = path.join(dir, 'personas');
  fs.mkdirSync(personasDir);
  for (const f of fs.readdirSync(path.join(SERVER_ROOT, 'personas'))) if (f.endsWith('.md')) fs.copyFileSync(path.join(SERVER_ROOT, 'personas', f), path.join(personasDir, f));
  const clock = { t: Date.UTC(2026, 10, 12) };
  const ctx = createContext(
    // The test plays replies itself, so it opts out of the served-replies requirement for A/B tests.
    {
      dbPath: path.join(dir, 't.db'),
      personasDir,
      ...over,
      lifecycle: { requireArt: false, ...over.lifecycle },
      experiments: { requireServedReplies: false, ...over.experiments },
    },
    offlineLlm,
    () => clock.t,
  );
  return { ctx, dir, clock };
}

/** A card the ranker served to this user (so its impression and swipe count in shared stats), then shown. */
function served(ctx: Ctx, user: string, persona: string, ts: number, slot = 'exploit'): void {
  ctx.db
    .prepare('INSERT INTO feed_serves (request_id, position, ts, user_id, persona_id, slot, p_shown) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(`req-${user}-${persona}-${ts}`, 0, ts, user, persona, slot, 0.5);
  ingest(ctx, { type: 'impression', user_id: user, persona_id: persona, ts });
}

test('ingest folds swipes, matches, messages and premium into per-persona stats', () => {
  const { ctx, clock } = scratch();
  const e = (type: Parameters<typeof ingest>[1]['type'], user: string, persona?: string, props?: Record<string, unknown>) =>
    ingest(ctx, { type, user_id: user, persona_id: persona, props, ts: clock.t });
  for (let i = 0; i < 10; i++) {
    const u = `u${i}`;
    served(ctx, u, 'kiyo', clock.t);
    e('swipe', u, 'kiyo', { dir: i < 6 ? 'like' : 'pass' });
    if (i < 6) {
      e('match', u, 'kiyo');
      e('chat_open', u, 'kiyo');
      for (let t = 0; t < (i < 3 ? 12 : 2); t++) {
        e('message', u, 'kiyo', { from: 'user', text: 'tell me about your world' });
        e('message', u, 'kiyo', { from: 'persona', text: 'Foxfire and maples. What about you?' });
      }
      e('chat_close', u, 'kiyo', { duration_ms: 120_000 });
    }
  }
  e('premium_convert', 'u0');
  e('report', 'u5', 'kiyo');
  clock.t += 9 * 86_400_000;
  const s = computeAllStats(ctx, false).find((x) => x.personaId === 'kiyo')!;
  assert.equal(s.impressions, 10);
  assert.equal(s.likeRate.rate, 0.6);
  assert.equal(s.matches, 6);
  assert.equal(s.conversations, 6);
  assert.equal(s.deepChatRate.rate, 0.5);
  assert.equal(s.premiumConversion.x, 1);
  assert.equal(s.negativeRate.x, 1);
  assert.ok(Math.abs(s.avgTimeMinPerConversation - 2) < 1e-9);
  // Nine silent days later every thread has dropped: three at turn 2, three at turn 12.
  assert.equal(s.drop.dropped, 6);
  assert.equal(s.drop.hazard[1].hazard, 0.5); // turn 2: 3 of 6 at risk
  assert.equal(s.drop.hazard[11].hazard, 1); // turn 12: the remaining 3
  assert.ok(s.score && Number.isFinite(s.score.score));
});

test('a re-like after a pass is a re-swipe', () => {
  const { ctx, clock } = scratch();
  served(ctx, 'r', 'luna', clock.t);
  ingest(ctx, { type: 'swipe', user_id: 'r', persona_id: 'luna', props: { dir: 'pass' }, ts: clock.t });
  // The deck reset serves her again.
  served(ctx, 'r', 'luna', clock.t + 1);
  ingest(ctx, { type: 'swipe', user_id: 'r', persona_id: 'luna', props: { dir: 'like' }, ts: clock.t + 1 });
  const s = computeAllStats(ctx, false).find((x) => x.personaId === 'luna')!;
  assert.equal(s.reswipeRate.x, 1);
});

test('assignment is sticky, the treatment arm reads the variant, and promotion writes the markdown', () => {
  const { ctx } = scratch();
  const id = Number(
    ctx.db
      .prepare(
        `INSERT INTO experiments (persona_id, status, created_at, base_version, section, variant_body, rationale, pattern_sig, target_turn, source)
         VALUES ('nova', 'running', ?, 1, 'Conversation hooks', ?, 'test', 't3-5|question=none', 3, 'heuristic')`,
      )
      .run(ctx.now(), '- Always ask one easy question.').lastInsertRowid,
  );
  const arms = new Map<string, string>();
  for (let i = 0; i < 40; i++) {
    const a = assignArm(ctx, `user${i}`, 'nova')!;
    arms.set(`user${i}`, a.arm);
    assert.equal(assignArm(ctx, `user${i}`, 'nova')!.arm, a.arm);
  }
  const counts = [...arms.values()].reduce((m, a) => m.set(a, (m.get(a) ?? 0) + 1), new Map<string, number>());
  assert.ok((counts.get('treatment') ?? 0) > 5 && (counts.get('control') ?? 0) > 5);
  const treated = [...arms].find(([, a]) => a === 'treatment')![0];
  ingest(ctx, { type: 'chat_open', user_id: treated, persona_id: 'nova' });
  assert.equal(getSection(effectivePersona(ctx, treated, 'nova')!.persona, 'Conversation hooks')!.body, '- Always ask one easy question.');

  const exp = ctx.db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as unknown as ExperimentRow;
  const ev = { experimentId: id, nControl: 300, nTreatment: 300, nStar: 600, target: { estimate: 0.08, lower: 0.01, upper: 0.15, n: 600 }, deep: { estimate: 0, lower: -0.01, upper: 0.01, n: 600 }, rmst: { estimate: 0, lower: -0.1, upper: 0.1, n: 600 }, negative: { estimate: 0, lower: -0.001, upper: 0.001, n: 600 }, control: { pass: 0.7, deep: 0.2, rmst: 5 }, treatment: { pass: 0.78, deep: 0.2, rmst: 5 }, decision: 'promote' as const };
  const saved = promote(ctx, exp, ev)!;
  assert.equal(saved.meta.version, 2);
  const onDisk = parsePersona(fs.readFileSync(ctx.personas.file('nova'), 'utf8'));
  assert.equal(getSection(onDisk, 'Conversation hooks')!.body, '- Always ask one easy question.');
  assert.match(getSection(onDisk, 'Changelog')!.body, /experiment #\d+ promoted/);
  assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM edit_library').get() as { n: number }).n, 1);
});

test('the gate stays closed until every active persona has its sample, and spawning creates both branches', async () => {
  const { ctx } = scratch();
  const closed = computeGate(ctx, computeAllStats(ctx, false));
  assert.equal(closed.open, false);
  assert.equal(closed.blocking.length, ctx.personas.active().length);
  const stats = computeAllStats(ctx, false);
  const created = await spawnGeneration(ctx, stats, new Set(stats.map((s) => s.personaId)));
  assert.equal(created.length, 4);
  assert.deepEqual(created.map((p) => p.meta.branch).sort(), ['exploit', 'exploit', 'explore', 'explore']);
  for (const p of created) {
    assert.ok(fs.existsSync(ctx.personas.file(p.meta.id)), `${p.meta.id}.md written`);
    if (p.meta.branch === 'exploit') assert.ok(p.meta.parent && ctx.personas.get(p.meta.parent));
  }
  // New personas are active with no sample: the gate is closed for the next generation.
  const after = computeGate(ctx, computeAllStats(ctx, false));
  assert.ok(after.blocking.some((id) => created.some((p) => p.meta.id === id)));
});

test('the gate also opens once 10 better-than-median parents have both samples, at most one generation per cooldown', () => {
  const { ctx, clock } = scratch();
  const stats = computeAllStats(ctx, false);
  const g0 = computeGate(ctx, stats);
  // The 10 best by score lower bound have their impressions and chats; the rest of the roster is short of chats.
  stats.forEach((s, i) => {
    s.score = { score: 100 - i, lower: 100 - i, upper: 101 - i, components: {} };
    s.impressions = g0.nImpressions + 10;
    s.conversations = i < 10 ? g0.nConversations + 1 : 5;
  });
  assert.equal(computeGate(ctx, stats).open, true, 'parents resolved');
  assert.equal(computeGate(ctx, stats).blocking.length, stats.length - 10, 'the tail still counts as blocking');
  // One of the 10 short of chats: closed.
  stats[3].conversations = 5;
  assert.equal(computeGate(ctx, stats).open, false);
  // A rising persona on top by lower bound with few chats does not block once 10 others qualify.
  stats[10].conversations = g0.nConversations + 1;
  stats[3].score = { score: 200, lower: 150, upper: 250, components: {} };
  assert.equal(computeGate(ctx, stats).open, true, 'a rising persona at the top does not block');
  // A generation just spawned: closed until the cooldown passes.
  ctx.db.prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)').run(clock.t, 'spawn_explore', 'x', '{}');
  assert.equal(computeGate(ctx, stats).open, false, 'cooling down');
  clock.t += ctx.cfg.lifecycle.generationCooldownDays * ctx.cfg.dayMs;
  assert.equal(computeGate(ctx, stats).open, true, 'cooled');
});

test('the feed never re-serves liked personas, respects passes, and logs propensities', () => {
  const { ctx, clock } = scratch();
  ingest(ctx, { type: 'swipe', user_id: 'f', persona_id: 'raven', props: { dir: 'like' }, ts: clock.t });
  ingest(ctx, { type: 'swipe', user_id: 'f', persona_id: 'ada', props: { dir: 'pass' }, ts: clock.t });
  const { cards, requestId } = buildFeed(ctx, 'f', { limit: 10 });
  assert.equal(cards.length, 10);
  assert.ok(!cards.some((c) => c.personaId === 'raven' || c.personaId === 'ada'));
  assert.ok(cards.every((c) => c.pShown > 0 && c.pShown <= 1));
  assert.ok(cards.some((c) => c.slot !== 'exploit'), 'exploration slots present');
  assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM feed_serves WHERE request_id = ?').get(requestId) as { n: number }).n, 10);
  const others = ctx.personas.servable().map((p) => p.meta.id).filter((id) => id !== 'ada' && id !== 'kiyo');
  assert.ok(!buildFeed(ctx, 'f', { exclude: others }).cards.some((c) => c.personaId === 'ada'), 'a pass hides her');
  assert.ok(buildFeed(ctx, 'f', { exclude: others, includePassed: true }).cards.some((c) => c.personaId === 'ada'), 'a deck reset brings her back');
});

test('crisis language gets the fixed safety reply and a logged referral', async () => {
  const { ctx } = scratch();
  const r = await chatTurn(ctx, 'c', 'hanami', 'i want to kill myself');
  assert.equal(r.source, 'crisis');
  assert.match(r.messages[0], /988/);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM safety_events WHERE kind = 'crisis_referral'").get() as { n: number }).n, 1);
});

/** Sixty threads with Nova: replies without a question lose the user at turn 2, replies with one keep them. */
function seedDropPattern(ctx: Ctx, clock: { t: number }): void {
  for (let i = 0; i < 60; i++) {
    const u = `d${i}`;
    const at = () => (clock.t += 60_000);
    ingest(ctx, { type: 'chat_open', user_id: u, persona_id: 'nova', ts: at() });
    ingest(ctx, { type: 'message', user_id: u, persona_id: 'nova', props: { from: 'persona', text: 'Hey there.' }, ts: at() });
    ingest(ctx, { type: 'message', user_id: u, persona_id: 'nova', props: { from: 'user', text: 'hi' }, ts: at() });
    ingest(ctx, { type: 'message', user_id: u, persona_id: 'nova', props: { from: 'persona', text: i % 2 ? 'Nice. What about you?' : 'Nice.' }, ts: at() });
    if (i % 2) ingest(ctx, { type: 'message', user_id: u, persona_id: 'nova', props: { from: 'user', text: 'me too' }, ts: at() });
  }
  clock.t += 3 * 86_400_000;
}

test('A/B tests open only when the server writes the replies, each at its online-FDR level', async () => {
  const small = { experiments: { minConversationsForProposal: 10 }, telemetry: { patternMinSupport: 10 } };
  const off = scratch({ ...small, experiments: { ...small.experiments, requireServedReplies: true } });
  seedDropPattern(off.ctx, off.clock);
  assert.deepEqual(await startExperiments(off.ctx), [], 'no LLM, no test: both arms would get the same scripted replies');

  const on = scratch(small);
  seedDropPattern(on.ctx, on.clock);
  const opened = await startExperiments(on.ctx);
  assert.equal(opened.length, 1);
  const row = on.ctx.db.prepare('SELECT persona_id, alpha FROM experiments WHERE id = ?').get(opened[0]) as { persona_id: string; alpha: number };
  assert.equal(row.persona_id, 'nova');
  assert.ok(Math.abs(row.alpha - lordLevel(1, [], 0.05)) < 1e-12, `first test level ${row.alpha}`);
});

test("a card's logged propensity matches how often the whole deck policy actually shows it", () => {
  const { ctx, clock } = scratch();
  // Seeded: with 3 visible cards only a handful are shown often enough to measure, so an
  // unseeded run sat near the bound by chance.
  ctx.rng = makeRng(42);
  ingest(ctx, { type: 'swipe', user_id: 'p', persona_id: 'raven', props: { dir: 'like' }, ts: clock.t });
  const N = 300;
  const shown = new Map<string, number>();
  const logged = new Map<string, number>();
  // The app shows the first 3 cards of a page (cfg.feed.visible) before it re-ranks: a card in
  // that window logs its chance of landing in it.
  for (let i = 0; i < N; i++) {
    for (const c of buildFeed(ctx, 'p', { limit: 10, visible: 3, dryRun: true }).cards) {
      if (c.position >= 3) continue;
      shown.set(c.personaId, (shown.get(c.personaId) ?? 0) + 1);
      logged.set(c.personaId, (logged.get(c.personaId) ?? 0) + c.pShown);
    }
  }
  // Mean logged propensity over the requests that showed a card, weighted back to all requests:
  // E[shown] = P(shown); E[pShown | shown] * P(shown) should be close to P(shown)^2 for an exact estimate,
  // so compare P(shown) with E[pShown | shown] on the cards shown often enough to measure.
  const errs: number[] = [];
  for (const [id, n] of shown) {
    if (n < 30) continue;
    errs.push(Math.abs(n / N - logged.get(id)! / n));
  }
  assert.ok(errs.length >= 3, `${errs.length} frequently shown cards`);
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  // Sampling noise alone is about 0.02 at 150 decks; the old top-k estimate was off by the DPP's and the explore slots' share.
  assert.ok(mean < 0.05, `mean |empirical - logged| propensity ${mean.toFixed(3)} over ${errs.length} cards`);
});

test('a signal nobody sends (premium, reports) stays out of the score instead of swamping its interval', () => {
  const { ctx, clock } = scratch();
  for (let i = 0; i < 300; i++) {
    const pid = i % 3 === 0 ? 'raven' : 'nova';
    ingest(ctx, { type: 'impression', user_id: `s${i}`, persona_id: pid, ts: clock.t });
    ingest(ctx, { type: 'swipe', user_id: `s${i}`, persona_id: pid, props: { dir: i % 2 ? 'like' : 'pass' }, ts: clock.t });
  }
  const stats = computeAllStats(ctx, false);
  const nova = stats.find((s) => s.personaId === 'nova')!;
  assert.ok(!('premium' in nova.score!.components), 'no premium term without premium events');
  assert.ok(!('negative' in nova.score!.components), 'no negative term without reports or blocks');
  assert.ok(nova.score!.upper - nova.score!.lower < 3, `interval width ${(nova.score!.upper - nova.score!.lower).toFixed(2)}`);
});

test('the explore branch keeps finding untried niches at the full roster: the vocabulary grows when it runs low', async () => {
  const { ctx } = scratch();
  const stats = computeAllStats(ctx, false);
  // The 154-persona roster has used up nearly every fixed form and setting value.
  assert.ok(untried(ctx, 'form').length < MIN_UNTRIED, `untried forms before: ${untried(ctx, 'form').join(', ')}`);
  const added = await growVocabulary(ctx);
  assert.ok(added.some((a) => a.axis === 'form'), 'forms added');
  assert.ok(added.every((a) => a.source === 'reserve'), 'offline: from the reserve');
  assert.ok(untried(ctx, 'form').length >= MIN_UNTRIED);
  assert.deepEqual(await growVocabulary(ctx), [], 'no growth while enough values are untried');
  const plans = planExplore(ctx, stats, 4, occupiedOrTried(ctx));
  assert.equal(plans.length, 4, 'four explore plans');
  const space = descriptorSpace(ctx);
  for (const plan of plans) {
    for (const [axis, value] of Object.entries(plan.descriptors)) assert.ok(space[axis as keyof typeof space].includes(value), `${axis}=${value} in the space`);
  }
  // Spawning writes them as valid persona files.
  const created = await spawnGeneration(ctx, stats, new Set(stats.map((s) => s.personaId)));
  assert.ok(created.filter((p) => p.meta.branch === 'explore').length >= 1);
});

test('a dud with its like sample in fades even with almost no chats; a liked persona is not faded on thin random-slot data', () => {
  const { ctx } = scratch();
  const stats = computeAllStats(ctx, false);
  const gate = computeGate(ctx, stats);
  for (const st of stats) {
    st.impressions = gate.nImpressions + 100;
    st.conversations = 400;
    st.score = { score: 3 + (st.personaId.length % 5) * 0.1, lower: 2.6, upper: 3.4, components: {} };
    st.likeRateRandom = { x: 12, n: 40, rate: 0.3 };
  }
  const dud = stats.find((x) => x.personaId === 'raven')!;
  dud.conversations = 20; // nobody likes her, so hardly anyone chats: she never reaches the gate
  dud.score = { score: 0, lower: -1, upper: 1, components: {} };
  dud.likeRateRandom = { x: 2, n: 40, rate: 0.05 };
  const liked = stats.find((x) => x.personaId === 'nova')!;
  liked.score = { score: 1.5, lower: 0.5, upper: 2.5, components: {} }; // under the bar on score alone...
  liked.likeRateRandom = { x: 4, n: 11, rate: 0.36 }; // ...but too few random-slot impressions to confirm
  const faded: string[] = [];
  for (let i = 0; i < ctx.cfg.lifecycle.fadeStreak; i++) faded.push(...fadeTick(ctx, stats, gate).faded);
  assert.deepEqual(faded, ['raven']);
  assert.equal(ctx.personas.get('nova')!.meta.status, 'active');
});

test('someone who likes only young women stops getting men and seniors, explore slots included', () => {
  const { ctx, clock } = scratch();
  const all = ctx.personas.servable();
  const youngWomen = all.filter((p) => p.meta.gender === 'female' && ['young-adult', 'adult'].includes(p.meta.descriptors.age_group)).slice(0, 12);
  const men = all.filter((p) => p.meta.gender === 'male').slice(0, 5);
  const older = all.filter((p) => p.meta.gender === 'female' && p.meta.descriptors.age_group === 'mature-adult').slice(0, 3);
  for (const p of youngWomen) ingest(ctx, { type: 'swipe', user_id: 'w', persona_id: p.meta.id, props: { dir: 'like' }, ts: clock.t });
  for (const p of [...men, ...older]) ingest(ctx, { type: 'swipe', user_id: 'w', persona_id: p.meta.id, props: { dir: 'pass' }, ts: clock.t });
  let cards = 0;
  let male = 0;
  let senior = 0;
  for (let i = 0; i < 60; i++) {
    for (const c of buildFeed(ctx, 'w', { limit: 10, dryRun: true }).cards) {
      const p = ctx.personas.get(c.personaId)!;
      cards++;
      if (p.meta.gender === 'male') male++;
      if (p.meta.descriptors.age_group === 'senior-adult') senior++;
    }
  }
  assert.ok(male / cards < 0.05, `men ${(100 * male / cards).toFixed(1)}% of cards`);
  assert.ok(senior / cards < 0.03, `seniors ${(100 * senior / cards).toFixed(1)}% of cards`);
});

test('a persona with little data starts from what its features predict across the roster, not a flat prior', () => {
  const { ctx, clock } = scratch();
  const all = ctx.personas.servable();
  const women = all.filter((p) => p.meta.gender === 'female');
  const men = all.filter((p) => p.meta.gender === 'male');
  // 60 impressions on each of 20 women (40% liked) and 10 men (5% liked).
  let u = 0;
  for (const [group, rate] of [[women.slice(0, 20), 0.4], [men.slice(0, 10), 0.05]] as const) {
    for (const p of group) {
      for (let i = 0; i < 60; i++) {
        served(ctx, `fp${u}`, p.meta.id, clock.t);
        ingest(ctx, { type: 'swipe', user_id: `fp${u++}`, persona_id: p.meta.id, props: { dir: i < 60 * rate ? 'like' : 'pass' }, ts: clock.t });
      }
    }
  }
  const model = getFeedModel(ctx);
  const mean = (id: string) => {
    const l = model.persona.get(id)!.like;
    return l.a / (l.a + l.b);
  };
  // Unseen personas: an unseen woman is predicted well above an unseen man.
  const w = mean(women[25].meta.id);
  const m = mean(men[15].meta.id);
  assert.ok(w > 2 * m, `unseen woman ${w.toFixed(3)} vs unseen man ${m.toFixed(3)}`);
});

test('tempered draws: at scale 0 the deck is the posterior-mean order, at 1 it varies', () => {
  const { ctx } = scratch({ feed: { tsScale: 0, exploreEvery: 1000 } });
  const a = buildFeed(ctx, 't0', { limit: 10, dryRun: true }).cards.map((c) => c.personaId);
  const b = buildFeed(ctx, 't0', { limit: 10, dryRun: true }).cards.map((c) => c.personaId);
  assert.deepEqual(a, b, 'no randomness at scale 0');
  const hot = scratch({ feed: { tsScale: 1, exploreEvery: 1000 } }).ctx;
  const decks = new Set(Array.from({ length: 5 }, () => buildFeed(hot, 't1', { limit: 10, dryRun: true }).cards.map((c) => c.personaId).join(',')));
  assert.ok(decks.size > 1, 'plain Thompson sampling varies the deck');
});

test("with feed.dppOrder 'score' exploit cards come in score order, as X re-sorts its DPP picks", () => {
  const { ctx } = scratch({ feed: { dppOrder: 'score' } });
  for (let i = 0; i < 20; i++) {
    const exploit = buildFeed(ctx, `o${i}`, { limit: 10, dryRun: true }).cards.filter((c) => c.slot === 'exploit');
    for (let j = 1; j < exploit.length; j++) assert.ok(exploit[j - 1].score >= exploit[j].score, `deck ${i}: card ${j} out of order`);
  }
});

test('long-ago passes come back when the unseen roster runs out; recent ones do not', () => {
  const { ctx, clock } = scratch();
  const ids = ctx.personas.servable().map((p) => p.meta.id);
  const early = ids.slice(0, 20);
  for (const id of early) ingest(ctx, { type: 'swipe', user_id: 'r', persona_id: id, props: { dir: 'pass' }, ts: clock.t });
  clock.t += ctx.cfg.feed.recycleAfterMs + 60_000;
  for (const id of ids.slice(20)) ingest(ctx, { type: 'swipe', user_id: 'r', persona_id: id, props: { dir: 'pass' }, ts: clock.t });
  const cards = buildFeed(ctx, 'r', { limit: 10, dryRun: true }).cards;
  assert.equal(cards.length, 10, 'the deck is not empty');
  assert.ok(cards.every((c) => early.includes(c.personaId)), 'only passes older than the cooldown return');
});

test('an impression from an earlier page keeps the propensity its own request logged', () => {
  const { ctx, clock } = scratch();
  const first = buildFeed(ctx, 'q', { limit: 10 });
  clock.t += 1000;
  const second = buildFeed(ctx, 'q', { limit: 10, exclude: first.cards.map((c) => c.personaId) });
  const card = first.cards[0];
  ingest(ctx, { type: 'impression', user_id: 'q', persona_id: card.personaId, props: { request_id: second.requestId }, ts: clock.t });
  const row = ctx.db.prepare('SELECT slot, p_shown FROM impressions WHERE user_id = ? AND persona_id = ?').get('q', card.personaId) as { slot: string; p_shown: number };
  assert.equal(row.slot, card.slot);
  assert.ok(Math.abs(row.p_shown - card.pShown) < 1e-12, `logged ${row.p_shown} vs served ${card.pShown}`);
});

test("a brand-new user's first deck keeps its random slots but no undersampled ones", () => {
  const { ctx, clock } = scratch({ feed: { exploreEvery: 5 } });
  const slots = { random: 0, undersampled: 0 };
  for (let i = 0; i < 40; i++) for (const c of buildFeed(ctx, `n${i}`, { limit: 10, dryRun: true }).cards) if (c.slot !== 'exploit') slots[c.slot]++;
  assert.equal(slots.undersampled, 0, 'no undersampled card on a first deck');
  assert.ok(slots.random > 20, `random slots kept: ${slots.random} in 40 first decks`);
  const first = buildFeed(ctx, 'n', { limit: 10, dryRun: true }).cards;
  ingest(ctx, { type: 'swipe', user_id: 'n', persona_id: first[0].personaId, props: { dir: 'like' }, ts: clock.t });
  let later = 0;
  for (let i = 0; i < 20; i++) later += buildFeed(ctx, 'n', { limit: 10, dryRun: true }).cards.filter((c) => c.slot === 'undersampled').length;
  assert.ok(later > 5, `undersampled slots return once the user has swiped: ${later} in 20 decks`);
});

test('explore cards follow the user\'s card stream, so a deck re-ranked every 3 swipes still shows one in every 5 cards', () => {
  const { ctx, clock } = scratch({ feed: { exploreEvery: 5 } });
  const slots: string[] = [];
  for (let page = 0; page < 10; page++) {
    const { requestId, cards } = buildFeed(ctx, 'stream', { limit: 10, visible: 3 });
    for (const c of cards.slice(0, 3)) {
      clock.t += 4000;
      ingest(ctx, { type: 'impression', user_id: 'stream', persona_id: c.personaId, props: { request_id: requestId }, ts: clock.t });
      ingest(ctx, { type: 'swipe', user_id: 'stream', persona_id: c.personaId, props: { dir: slots.length % 4 === 0 ? 'like' : 'pass' }, ts: clock.t });
      slots.push(c.slot);
    }
  }
  // Cards 5, 10, 15... (index 4, 9, 14...) are the explore turns; a first deck gives its gate
  // slot back to an exploit card, so card 5 may be exploit, the later ones never are.
  const explore = slots.map((s, i) => (s !== 'exploit' ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(explore.filter((i) => i > 4), [9, 14, 19, 24, 29].filter((i) => i < slots.length), `explore at ${explore}`);
  // Under fixed page positions 4 and 9 none of these would have been on screen.
});

test('people who liked one persona and liked another more than the ranker predicted lift it for the next fan', () => {
  const { ctx, clock } = scratch({ feed: { cfWeight: 1, tsScale: 0 } });
  const insert = ctx.db.prepare('INSERT INTO impressions (ts, user_id, persona_id, slot, p_shown, outcome, p_pred) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // 40 users liked 'vesper'; 32 of them also liked 'luna', which the ranker expected 20% of them to.
  for (let i = 0; i < 40; i++) {
    insert.run(1, `c${i}`, 'vesper', 'exploit', 0.5, 'like', 0.3);
    insert.run(2, `c${i}`, 'luna', 'exploit', 0.5, i < 32 ? 'like' : 'pass', 0.2);
  }
  ingest(ctx, { type: 'swipe', user_id: 'fan', persona_id: 'vesper', props: { dir: 'like' }, ts: clock.t });
  const card = (u: string) => buildFeed(ctx, u, { limit: 50, dryRun: true }).cards.find((c) => c.personaId === 'luna');
  const fan = card('fan');
  assert.ok(fan && fan.why.cf > 2, `cf for a vesper fan: ${fan?.why.cf}`);
  assert.equal(card('stranger')?.why.cf ?? 1, 1, 'no likes, no collaborative term');
});

test('an explore slot only spends traffic on personas still short of their sample', () => {
  const { ctx, clock } = scratch({ feed: { randomTarget: 1, undersampledTarget: 1 } });
  // Every servable persona already has one random-slot swipe and one impression except 'ada'.
  const insert = ctx.db.prepare('INSERT INTO impressions (ts, user_id, persona_id, slot, p_shown, outcome) VALUES (?, ?, ?, ?, ?, ?)');
  for (const p of ctx.personas.servable()) if (p.meta.id !== 'ada') insert.run(1, 'seed', p.meta.id, 'random', 0.1, 'pass');
  for (let i = 0; i < 4; i++) ingest(ctx, { type: 'swipe', user_id: 'needy', persona_id: ['kiyo', 'luna', 'vesper', 'maya'][i], props: { dir: 'pass' }, ts: clock.t + i });
  const explored = new Set<string>();
  for (let i = 0; i < 40; i++)
    for (const c of buildFeed(ctx, 'needy', { limit: 10, dryRun: true }).cards) if (c.slot !== 'exploit') explored.add(c.personaId);
  assert.deepEqual([...explored], ['ada'], `explored ${[...explored]}`);
});

test('with enough swipes the P(like) factors get fitted weights, and a factor that predicts nothing is turned down', () => {
  const { ctx } = scratch({ feed: { calibrate: true } });
  const insert = ctx.db.prepare('INSERT INTO impressions (ts, user_id, persona_id, slot, p_shown, outcome, factors) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // Likes follow the affinity factor; the quality factor is noise.
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 3000; i++) {
    const la = Math.log(0.05 + 0.6 * rnd());
    const lq = Math.log(0.3 + 2 * rnd());
    const like = rnd() < 0.2 * Math.exp(la) / 0.35 ? 'like' : 'pass';
    insert.run(i, `u${i % 300}`, 'ada', 'exploit', 0.5, like, JSON.stringify([la, lq, 0, 0]));
  }
  const w = getFeedModel(ctx, 0).calib;
  assert.ok(w, 'fitted');
  assert.ok(w![1] > 0.6, `affinity weight ${w![1].toFixed(2)}`);
  assert.ok(Math.abs(w![2]) < 0.3, `quality weight ${w![2].toFixed(2)}`);
});

test("persona intercepts judge a persona against the audience the feed chose for it, not by its raw rate", () => {
  const { ctx } = scratch({ feed: { calibrate: true, personaEffects: true } });
  const insert = ctx.db.prepare('INSERT INTO impressions (ts, user_id, persona_id, slot, p_shown, outcome, factors) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // Two personas equally good for any given user; 'ada' is shown only to its fans (high affinity),
  // 'luna' to everyone. Likes follow the affinity factor alone.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const raw: Record<string, { x: number; n: number }> = { ada: { x: 0, n: 0 }, luna: { x: 0, n: 0 } };
  for (let i = 0; i < 4000; i++) {
    const id = i % 2 ? 'ada' : 'luna';
    const la = id === 'ada' ? Math.log(0.45 + 0.15 * rnd()) : Math.log(0.05 + 0.55 * rnd());
    const like = rnd() < 1 / (1 + Math.exp(-(-0.4 + 1.2 * la))) ? 'like' : 'pass';
    raw[id].x += like === 'like' ? 1 : 0;
    raw[id].n++;
    insert.run(i, `u${i}`, id, 'exploit', 0.5, like, JSON.stringify([la, 0, 0, 0]));
  }
  const logit = (p: number) => Math.log(p / (1 - p));
  const rawGap = logit(raw.ada.x / raw.ada.n) - logit(raw.luna.x / raw.luna.n);
  const m = getFeedModel(ctx, 0);
  const gap = m.effects!.get('ada')!.mean - m.effects!.get('luna')!.mean;
  assert.ok(rawGap > 0.4, `the raw rates differ: ${rawGap.toFixed(2)}`);
  assert.ok(Math.abs(gap) < 0.2, `the intercepts do not: ${gap.toFixed(2)}`);
  assert.equal(m.calib![2], 0, 'the raw quality factor is not in the fit');
  assert.ok(m.calib![1] > 0.8, `affinity carries the likes: ${m.calib![1].toFixed(2)}`);
});

test('with fitted weights the shared chat term keeps its say: its ratio between two personas is compressed by the exponent', () => {
  // Same P(like); one persona's chat term is 4x the other's.
  const plain = combineScore(0.2, 4, 1, false, 0.5) / combineScore(0.2, 1, 1, false, 0.5);
  const fitted = combineScore(0.2, 4, 1, true, 0.5) / combineScore(0.2, 1, 1, true, 0.5);
  assert.equal(plain, 4);
  assert.equal(fitted, 2);
  assert.equal(combineScore(0.2, -1, 1, true, 0.5), 0, 'a net-negative persona scores 0, not NaN');
});

test("the logged prediction caps persona quality the way the score does", () => {
  const { ctx, clock } = scratch();
  // A persona liked 30 of 30 times against a roster mostly passed: its rate over its tags' mean is
  // far above the 3x cap.
  let t = clock.t;
  for (const p of ctx.personas.servable().slice(0, 60)) {
    if (p.meta.id === 'kiyo') continue;
    for (let i = 0; i < 12; i++) {
      served(ctx, `bg${i}`, p.meta.id, ++t);
      ingest(ctx, { type: 'swipe', user_id: `bg${i}`, persona_id: p.meta.id, props: { dir: i < 1 ? 'like' : 'pass' }, ts: t });
    }
  }
  for (let i = 0; i < 30; i++) {
    served(ctx, `q${i}`, 'kiyo', clock.t + i);
    ingest(ctx, { type: 'swipe', user_id: `q${i}`, persona_id: 'kiyo', props: { dir: 'like' }, ts: clock.t + i });
  }
  const card = buildFeed(ctx, 'fresh', { limit: 50, dryRun: true }).cards.find((c) => c.personaId === 'kiyo');
  assert.ok(card, 'kiyo served');
  assert.ok(card!.why.pBase <= card!.why.affinity * 3 * card!.why.traits + 1e-9, `pBase ${card!.why.pBase} vs cap ${card!.why.affinity * 3 * card!.why.traits}`);
});

test('shared stats count only served cards, one vote per user and persona; a replayed swipe and a match without a like are dropped', () => {
  const { ctx, clock } = scratch();
  // A forged burst: 50 likes for 'raven' from one account with no serve behind them.
  for (let i = 0; i < 50; i++) ingest(ctx, { type: 'swipe', user_id: 'bot', persona_id: 'raven', props: { dir: 'like' }, ts: clock.t + i });
  // One real user, served once, liked once, then the same swipe event replayed 5 times.
  served(ctx, 'real', 'raven', clock.t);
  for (let i = 0; i < 6; i++) ingest(ctx, { type: 'swipe', user_id: 'real', persona_id: 'raven', props: { dir: 'like' }, ts: clock.t + 1 + i });
  const m = getFeedModel(ctx, 0);
  assert.equal(m.persona.get('raven')!.impressions, 1, 'only the served card counts');
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM impressions WHERE user_id = 'real'").get() as { n: number }).n, 1, 'replays add no rows');
  const s = computeAllStats(ctx, false).find((x) => x.personaId === 'raven')!;
  assert.equal(s.impressions, 1);
  // A match nobody liked is refused; one after a like lands.
  ingest(ctx, { type: 'match', user_id: 'stranger', persona_id: 'luna', ts: clock.t });
  ingest(ctx, { type: 'match', user_id: 'real', persona_id: 'raven', ts: clock.t });
  assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n, 1);
});

test('the events route caps each user per minute and admin routes are closed without a token', async () => {
  const { ctx } = scratch();
  const { createServer, EVENTS_PER_USER_MINUTE } = await import('../src/app.ts');
  delete process.env.REVERIE_ADMIN_TOKEN;
  delete process.env.REVERIE_ADMIN_OPEN;
  const server = createServer(ctx);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const events = Array.from({ length: 500 }, () => ({ type: 'session_start', user_id: 'flood' }));
    const r1 = (await (await fetch(`http://127.0.0.1:${port}/v1/events`, { method: 'POST', body: JSON.stringify({ events }) })).json()) as { accepted: number };
    assert.equal(r1.accepted, EVENTS_PER_USER_MINUTE);
    const admin = await fetch(`http://127.0.0.1:${port}/admin/stats`);
    assert.equal(admin.status, 401);
  } finally {
    server.close();
  }
});

test('early on, before 3 personas have their random-slot sample, a low score alone fades nobody', () => {
  const { ctx } = scratch();
  const stats = computeAllStats(ctx, false);
  const gate = computeGate(ctx, stats);
  for (const st of stats) {
    st.impressions = gate.nImpressions + 100;
    st.score = { score: 3 + (st.personaId.length % 5) * 0.1, lower: 2.6, upper: 3.4, components: {} };
    st.likeRateRandom = { x: 5, n: 20, rate: 0.25 }; // nobody has 30 random-slot swipes yet
  }
  // A strong persona whose score dipped (a noisy deep-chat or return rate) and the true dud, both
  // short of their random sample: neither may fade on the score alone.
  for (const id of ['sylvara', 'raven']) stats.find((x) => x.personaId === id)!.score = { score: 0, lower: -1, upper: 1, components: {} };
  const faded: string[] = [];
  for (let i = 0; i < ctx.cfg.lifecycle.fadeStreak + 1; i++) faded.push(...fadeTick(ctx, stats, gate).faded);
  assert.equal(faded.length, 0, `faded ${faded.join(', ')}`); // (deepEqual with [] would narrow faded to never[])
  // With its own 30 random-slot swipes confirming it (1 like in 30 against a pooled 25%), the dud fades.
  stats.find((x) => x.personaId === 'raven')!.likeRateRandom = { x: 1, n: 30, rate: 1 / 30 };
  for (let i = 0; i < ctx.cfg.lifecycle.fadeStreak; i++) faded.push(...fadeTick(ctx, stats, gate).faded);
  assert.deepEqual(faded, ['raven']);
});

test('a rarely shown dud fades on its served like rate, without waiting for the pool, unless its random slots or chats contradict it', () => {
  const { ctx } = scratch();
  const stats = computeAllStats(ctx, false);
  const gate = computeGate(ctx, stats);
  // Nobody has the pool's impression count; the roster's random slots like at 20%.
  for (const st of stats) {
    st.impressions = 60;
    st.likeRate = { x: 12, n: 60, rate: 0.2 };
    st.passes = 48;
    st.likeRateRandom = { x: 2, n: 10, rate: 0.2 };
  }
  const set = (id: string, likes: number, decided: number, random = { x: 2, n: 10 }) => {
    const st = stats.find((x) => x.personaId === id)!;
    st.likeRate = { x: likes, n: decided, rate: likes / decided };
    st.passes = decided - likes;
    st.likeRateRandom = { ...random, rate: random.x / random.n };
  };
  set('raven', 0, 50, { x: 0, n: 12 }); // a dud: 0 likes in 50 served cards
  set('isolde', 0, 30, { x: 0, n: 8 }); // as bad, but short of 40 cards
  set('nova', 0, 50, { x: 6, n: 12 }); // its random slots say otherwise
  set('luna', 4, 50); // 8%: the upper bound (0.19) is not under the 20% reference
  const faded: string[] = [];
  for (let i = 0; i < ctx.cfg.lifecycle.fadeStreak; i++) faded.push(...fadeTick(ctx, stats, gate).faded);
  assert.deepEqual(faded, ['raven']);
});

test('EASE as the persona-to-persona term lifts what the fans of a liked persona also liked', () => {
  const { ctx, clock } = scratch({ feed: { cfMethod: 'ease', cfWeight: 1, tsScale: 0 } });
  const insert = ctx.db.prepare('INSERT INTO impressions (ts, user_id, persona_id, slot, p_shown, outcome) VALUES (?, ?, ?, ?, ?, ?)');
  // 60 users liked both vesper and luna; 60 others liked vesper and maya... no: only luna co-occurs.
  for (let i = 0; i < 60; i++) {
    insert.run(1, `e${i}`, 'vesper', 'exploit', 0.5, 'like');
    insert.run(2, `e${i}`, 'luna', 'exploit', 0.5, 'like');
    insert.run(3, `e${i}`, 'maya', 'exploit', 0.5, 'pass');
  }
  for (let i = 0; i < 60; i++) insert.run(4, `m${i}`, 'maya', 'exploit', 0.5, 'like');
  served(ctx, 'fan', 'vesper', clock.t);
  ingest(ctx, { type: 'swipe', user_id: 'fan', persona_id: 'vesper', props: { dir: 'like' }, ts: clock.t });
  const cards = buildFeed(ctx, 'fan', { limit: 50, dryRun: true }).cards;
  const cf = (id: string) => cards.find((c) => c.personaId === id)?.why.cf ?? 1;
  assert.ok(cf('luna') > 1.5, `luna ${cf('luna')}`);
  assert.ok(cf('luna') > cf('maya'), `luna ${cf('luna')} vs maya ${cf('maya')}`);
});

test("with feed.dppOrder 'pick' the first visible cards are less alike than the top of the score order", () => {
  const { ctx } = scratch();
  const model = getFeedModel(ctx);
  const cos = (a: number[], b: number[]) => {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? d / Math.sqrt(na * nb) : 0;
  };
  const windowSim = (ids: string[]) => (cos(model.vectors.get(ids[0])!, model.vectors.get(ids[1])!) + cos(model.vectors.get(ids[0])!, model.vectors.get(ids[2])!) + cos(model.vectors.get(ids[1])!, model.vectors.get(ids[2])!)) / 3;
  const pickCtx = scratch({ feed: { tsScale: 0 } }).ctx;
  const scoreCtx = scratch({ feed: { tsScale: 0, dppOrder: 'score' } }).ctx;
  const pick = buildFeed(pickCtx, 'w', { limit: 10, dryRun: true }).cards.slice(0, 3).map((c) => c.personaId);
  const byScore = buildFeed(scoreCtx, 'w', { limit: 10, dryRun: true }).cards.slice(0, 3).map((c) => c.personaId);
  assert.ok(windowSim(pick) <= windowSim(byScore), `pick ${windowSim(pick).toFixed(3)} vs score ${windowSim(byScore).toFixed(3)}`);
});
