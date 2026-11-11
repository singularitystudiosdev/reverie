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
import { SERVER_ROOT } from '../src/config.ts';
import type { Ctx } from '../src/context.ts';
import { assignArm, effectivePersona, promote, type ExperimentRow } from '../src/experiments/engine.ts';
import { buildFeed } from '../src/feed/ranker.ts';
import { spawnGeneration } from '../src/lifecycle/evolve.ts';
import { computeGate } from '../src/lifecycle/gate.ts';
import { offlineLlm } from '../src/llm/claude.ts';
import { getSection, parsePersona } from '../src/personas/markdown.ts';
import { ingest } from '../src/telemetry/ingest.ts';
import { computeAllStats } from '../src/telemetry/rollups.ts';
import { chatTurn } from '../src/chat.ts';

function scratch(): { ctx: Ctx; dir: string; clock: { t: number } } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reverie-test-'));
  const personasDir = path.join(dir, 'personas');
  fs.mkdirSync(personasDir);
  for (const f of fs.readdirSync(path.join(SERVER_ROOT, 'personas'))) if (f.endsWith('.md')) fs.copyFileSync(path.join(SERVER_ROOT, 'personas', f), path.join(personasDir, f));
  const clock = { t: Date.UTC(2026, 10, 12) };
  const ctx = createContext({ dbPath: path.join(dir, 't.db'), personasDir, lifecycle: { requireArt: false } }, offlineLlm, () => clock.t);
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
  assert.equal(closed.blocking.length, 14);
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
  const withPassed = buildFeed(ctx, 'f', { limit: 13, includePassed: true });
  assert.ok(withPassed.cards.some((c) => c.personaId === 'ada'));
});

test('crisis language gets the fixed safety reply and a logged referral', async () => {
  const { ctx } = scratch();
  const r = await chatTurn(ctx, 'c', 'hanami', 'i want to kill myself');
  assert.equal(r.source, 'crisis');
  assert.match(r.messages[0], /988/);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM safety_events WHERE kind = 'crisis_referral'").get() as { n: number }).n, 1);
});
