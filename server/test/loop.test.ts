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
import { buildFeed } from '../src/feed/ranker.ts';
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

test('ingest folds swipes, matches, messages and premium into per-persona stats', () => {
  const { ctx, clock } = scratch();
  const e = (type: Parameters<typeof ingest>[1]['type'], user: string, persona?: string, props?: Record<string, unknown>) =>
    ingest(ctx, { type, user_id: user, persona_id: persona, props, ts: clock.t });
  for (let i = 0; i < 10; i++) {
    const u = `u${i}`;
    e('impression', u, 'kiyo');
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
  ingest(ctx, { type: 'swipe', user_id: 'r', persona_id: 'luna', props: { dir: 'pass' }, ts: clock.t });
  ingest(ctx, { type: 'swipe', user_id: 'r', persona_id: 'luna', props: { dir: 'like' }, ts: clock.t });
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
  ingest(ctx, { type: 'swipe', user_id: 'p', persona_id: 'raven', props: { dir: 'like' }, ts: clock.t });
  const N = 150;
  const shown = new Map<string, number>();
  const logged = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    for (const c of buildFeed(ctx, 'p', { limit: 10, dryRun: true }).cards) {
      shown.set(c.personaId, (shown.get(c.personaId) ?? 0) + 1);
      logged.set(c.personaId, (logged.get(c.personaId) ?? 0) + c.pShown);
    }
  }
  // Mean logged propensity over the requests that showed a card, weighted back to all requests:
  // E[shown] = P(shown); E[pShown | shown] * P(shown) should be close to P(shown)^2 for an exact estimate,
  // so compare P(shown) with E[pShown | shown] on the cards shown often enough to measure.
  const errs: number[] = [];
  for (const [id, n] of shown) {
    if (n < 15) continue;
    errs.push(Math.abs(n / N - logged.get(id)! / n));
  }
  assert.ok(errs.length >= 5, `${errs.length} frequently shown cards`);
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

test('exploit cards come in score order, as X re-sorts its DPP picks', () => {
  const { ctx } = scratch();
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
  const { ctx, clock } = scratch();
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
