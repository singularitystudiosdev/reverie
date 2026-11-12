/**
 * Live ranker experiments (src/feed/experiment.ts): sticky, namespaced arms; per-arm feed settings
 * and factor fits; the arm carried from the serve to the impression; the per-arm report.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createContext } from '../src/app.ts';
import { SERVER_ROOT, type Config, type DeepPartial } from '../src/config.ts';
import { feedArm, feedExperimentReport, type FeedExperiment } from '../src/feed/experiment.ts';
import { getFeedModel, invalidateFeedModel } from '../src/feed/model.ts';
import { buildFeed } from '../src/feed/ranker.ts';
import { offlineLlm } from '../src/llm/claude.ts';
import { ingest } from '../src/telemetry/ingest.ts';

function scratch(over: DeepPartial<Config> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reverie-exp-'));
  const personasDir = path.join(dir, 'personas');
  fs.mkdirSync(personasDir);
  for (const f of fs.readdirSync(path.join(SERVER_ROOT, 'personas'))) if (f.endsWith('.md')) fs.copyFileSync(path.join(SERVER_ROOT, 'personas', f), path.join(personasDir, f));
  const clock = { t: Date.UTC(2026, 10, 12) };
  const ctx = createContext({ dbPath: path.join(dir, 't.db'), personasDir, ...over, lifecycle: { requireArt: false, ...over.lifecycle } }, offlineLlm, () => clock.t);
  return { ctx, clock };
}

const experiment: FeedExperiment = {
  name: 'explore-test',
  arms: [{ name: 'control' }, { name: 'no-explore', weight: 3, feed: { exploreEvery: 1_000_000 } }],
};

/** The first user ids (p0, p1, ...) that land in each arm. */
function usersIn(ctx: ReturnType<typeof scratch>['ctx']): Record<string, string> {
  const found: Record<string, string> = {};
  for (let i = 0; i < 1000 && Object.keys(found).length < 2; i++) {
    const a = feedArm(ctx, `p${i}`, { persist: false }).arm!;
    found[a] ??= `p${i}`;
  }
  return found;
}

test('users land in a sticky, namespaced arm in proportion to its weight, and a weight edit moves nobody', () => {
  const { ctx } = scratch({ feed: { experiment } });
  const counts: Record<string, number> = {};
  for (let i = 0; i < 4000; i++) {
    const a = feedArm(ctx, `u${i}`).arm!;
    counts[a] = (counts[a] ?? 0) + 1;
  }
  assert.ok(Math.abs(counts['explore-test:no-explore'] / 4000 - 0.75) < 0.03, JSON.stringify(counts));
  // Re-weighting after enrolment: everyone already enrolled keeps their arm.
  const before = Array.from({ length: 200 }, (_, i) => feedArm(ctx, `u${i}`).arm);
  ctx.cfg.feed.experiment = { ...experiment, arms: [{ name: 'control', weight: 9 }, experiment.arms[1]] };
  assert.deepEqual(Array.from({ length: 200 }, (_, i) => feedArm(ctx, `u${i}`).arm), before);
  assert.equal(feedArm(scratch().ctx, 'u1').arm, null, 'no experiment, no arm');
});

test('an arm serves with its own settings, and its arm rides from the serve to the impression', () => {
  const { ctx, clock } = scratch({ feed: { experiment } });
  const who = usersIn(ctx);
  const control = who['explore-test:control'];
  const noExplore = who['explore-test:no-explore'];
  assert.equal(feedArm(ctx, noExplore).feed.exploreEvery, 1_000_000);
  assert.equal(feedArm(ctx, control).feed.exploreEvery, ctx.cfg.feed.exploreEvery);
  // A control user's first page puts its 10th card up for exploration (a random slot on about half
  // of first pages; the other half go back to exploit cards); the other arm's pages never explore.
  const slots = (u: string) => buildFeed(ctx, u, { limit: 10, dryRun: true }).cards.map((c) => c.slot);
  assert.ok(Array.from({ length: 20 }, () => slots(control)).some((s) => s.includes('random')), 'control explores');
  for (let k = 0; k < 20; k++) assert.ok(slots(noExplore).every((s) => s === 'exploit'));
  const r = buildFeed(ctx, noExplore, { limit: 5 });
  assert.equal(r.arm, 'explore-test:no-explore');
  const pid = r.cards[0].personaId;
  ingest(ctx, { type: 'impression', user_id: noExplore, persona_id: pid, ts: clock.t, props: { request_id: r.requestId } });
  ingest(ctx, { type: 'swipe', user_id: noExplore, persona_id: pid, ts: clock.t + 1, props: { dir: 'like', request_id: r.requestId } });
  const row = ctx.db.prepare('SELECT arm, outcome FROM impressions WHERE user_id = ?').get(noExplore) as { arm: string; outcome: string };
  assert.deepEqual({ ...row }, { arm: 'explore-test:no-explore', outcome: 'like' });
});

test("page-level arms draw per request, and an arm that changes the factor fit gets its own fit", () => {
  const { ctx } = scratch({
    feed: { calibrate: true, experiment: { name: 'fit-test', unit: 'page', arms: [{ name: 'weights' }, { name: 'intercepts', feed: { personaEffects: true } }] } },
  });
  const arms = new Set(Array.from({ length: 40 }, () => buildFeed(ctx, 'same-user', { limit: 3, dryRun: true }).arm));
  assert.deepEqual([...arms].sort(), ['fit-test:intercepts', 'fit-test:weights']);
  const insert = ctx.db.prepare('INSERT INTO impressions (ts, user_id, persona_id, slot, p_shown, outcome, factors) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 800; i++) insert.run(i, `f${i % 80}`, i % 2 ? 'ada' : 'luna', 'exploit', 0.5, i % 5 ? 'pass' : 'like', JSON.stringify([-1, 0, 0, 0]));
  invalidateFeedModel(ctx); // the fits cache for 10 minutes
  const m = getFeedModel(ctx, 0);
  assert.equal(m.fits.get('weights')!.effects, null);
  assert.ok(m.fits.get('effects')!.effects?.has('ada'), 'the intercept arm has its intercepts');
  assert.equal(m.fits.get('effects')!.calib![2], 0);
});

test('the report: likes per card clustered by user, an always-valid difference against the first arm, guardrails, warnings', () => {
  const { ctx, clock } = scratch({ feed: { experiment } });
  let t = clock.t;
  for (let i = 0; i < 80; i++) {
    const u = `r${i}`;
    const r = buildFeed(ctx, u, { limit: 3 });
    for (const c of r.cards) {
      ingest(ctx, { type: 'impression', user_id: u, persona_id: c.personaId, ts: ++t, props: { request_id: r.requestId } });
      ingest(ctx, { type: 'swipe', user_id: u, persona_id: c.personaId, ts: ++t, props: { dir: r.arm === 'explore-test:control' ? 'like' : 'pass', request_id: r.requestId } });
    }
  }
  const rep = feedExperimentReport(ctx);
  assert.deepEqual(rep.arms.map((a) => a.arm), ['explore-test:control', 'explore-test:no-explore']);
  const [c, x] = rep.arms;
  assert.equal(c.users + x.users, 80);
  assert.equal(c.likeRate.estimate, 1);
  assert.equal(x.likeRate.estimate, 0);
  assert.equal(c.vsFirst, null);
  assert.ok(x.vsFirst!.likeRate.upper < 0, JSON.stringify(x.vsFirst!.likeRate));
  assert.ok(rep.sampleRatio && rep.sampleRatio.p > 0.001, JSON.stringify(rep.sampleRatio));
  assert.ok(rep.warnings.some((w) => w.includes('no-explore') && w.includes('understated')), rep.warnings.join(' | '));
});
