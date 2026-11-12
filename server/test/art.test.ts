/**
 * The automatic art step against a fake provider: a spawned draft goes live
 * with the five starter files on disk, the daily cap stops (and next UTC day
 * resumes) generation, failures leave the draft and are recorded, and with the
 * flag off nothing happens. The provider wire formats are checked with a fake fetch.
 * Needs `magick`, `ffmpeg` and `ffprobe` on PATH, like the job itself.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createContext, createServer } from '../src/app.ts';
import { artFileNames } from '../src/art/process.ts';
import { draftsNeedingArt, runArtJob, spentToday, subjectFromPersona } from '../src/art/job.ts';
import { buildPrompts, videoPromptFor } from '../src/art/prompts.ts';
import { ArtProviderError, GeminiXaiProvider, type ArtProvider } from '../src/art/providers.ts';
import { SERVER_ROOT, loadConfig, type DeepPartial, type Config } from '../src/config.ts';
import type { Ctx } from '../src/context.ts';
import { spawnGeneration } from '../src/lifecycle/evolve.ts';
import { offlineLlm } from '../src/llm/claude.ts';
import { tick, waitingOnArt } from '../src/jobs/scheduler.ts';
import { computeAllStats } from '../src/telemetry/rollups.ts';

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reverie-art-fixture-'));
const PNG = path.join(fixtureDir, 'still.png');
const MP4 = path.join(fixtureDir, 'clip.mp4');
execFileSync('magick', ['-size', '180x320', 'gradient:#ff8fab-#4b3f72', PNG]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=180x320:rate=24:duration=3', '-pix_fmt', 'yuv420p', MP4]);
const pngBytes = fs.readFileSync(PNG);
const mp4Bytes = fs.readFileSync(MP4);

class FakeProvider implements ArtProvider {
  stills: string[] = [];
  scenes: string[] = [];
  videos: string[] = [];
  failAt: 'still' | 'scene' | 'video' | null = null;
  billed = true;
  async still(prompt: string) {
    this.stills.push(prompt);
    if (this.failAt === 'still') throw new ArtProviderError('moderation: declined', 'refused');
    return pngBytes;
  }
  async scene(prompt: string) {
    this.scenes.push(prompt);
    if (this.failAt === 'scene') throw new ArtProviderError('scene declined', 'refused');
    return pngBytes;
  }
  async video(prompt: string, still: Buffer) {
    this.videos.push(prompt);
    assert.ok(still.equals(pngBytes), 'the portrait is the first frame');
    if (this.failAt === 'video') throw new ArtProviderError('video job failed', 'failed', this.billed);
    return mp4Bytes;
  }
}

/** Test prices: 0.5 per persona (2 images at 0.1 + 6 s of video at 0.05/s). */
const ART: DeepPartial<Config>['art'] = { enabled: true, dailyBudgetUsd: 100, perPersonaEstimateUsd: 0.5, imageUsd: 0.1, videoUsdPerSec: 0.05, videoSeconds: 6, maxPerTick: 10, maxAttempts: 3 };

function scratch(art: DeepPartial<Config>['art'] = {}): { ctx: Ctx; dir: string; out: string; clock: { t: number }; fake: FakeProvider } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reverie-art-test-'));
  const personasDir = path.join(dir, 'personas');
  const out = path.join(dir, 'characters');
  fs.mkdirSync(personasDir);
  for (const f of fs.readdirSync(path.join(SERVER_ROOT, 'personas'))) if (f.endsWith('.md')) fs.copyFileSync(path.join(SERVER_ROOT, 'personas', f), path.join(personasDir, f));
  const clock = { t: Date.UTC(2026, 10, 12, 10) };
  const ctx = createContext({ dbPath: path.join(dir, 't.db'), personasDir, lifecycle: { requireArt: true }, art: { ...ART, outputDir: out, ...art } }, offlineLlm, () => clock.t);
  const fake = new FakeProvider();
  ctx.artProvider = fake;
  return { ctx, dir, out, clock, fake };
}

async function spawnDrafts(ctx: Ctx) {
  const stats = computeAllStats(ctx, false);
  const created = await spawnGeneration(ctx, stats, new Set(stats.map((s) => s.personaId)));
  assert.ok(created.length >= 3);
  assert.ok(created.every((p) => p.meta.status === 'draft' && !p.meta.art.portrait));
  return created;
}

const rows = (ctx: Ctx) => ctx.db.prepare('SELECT persona_id, est_usd, status, error FROM art_spend ORDER BY id').all() as { persona_id: string; est_usd: number; status: string; error: string | null }[];
const dim = (file: string) => execFileSync('magick', ['identify', '-format', '%wx%h', `${file}[0]`]).toString();

test('a spawned draft goes live through tick() with exactly the five starter files and art set', async () => {
  const { ctx, out, fake } = scratch({ maxPerTick: 1 });
  await spawnDrafts(ctx);
  const first = draftsNeedingArt(ctx)[0]; // oldest first, then by id
  const rep = await tick(ctx, { writeReport: false });
  assert.deepEqual(rep.art.attached, [first.meta.id]);
  assert.deepEqual(rep.spawned, [], 'no new generation while other drafts still wait');

  const id = first.meta.id;
  const live = ctx.personas.get(id)!;
  assert.equal(live.meta.status, 'active');
  assert.deepEqual(live.meta.art, {
    portrait: `/characters/${id}.webp`,
    portraitSm: `/characters/${id}-sm.webp`,
    loop: `/characters/${id}-loop.mp4`,
    scene: `/characters/${id}-scene.webp`,
    sceneSm: `/characters/${id}-scene-sm.webp`,
  });
  assert.deepEqual(fs.readdirSync(out).sort(), Object.values(artFileNames(id)).sort(), 'five files, no staging leftovers');
  assert.equal(dim(path.join(out, `${id}.webp`)), '893x1600');
  assert.equal(dim(path.join(out, `${id}-sm.webp`)), '357x640');
  assert.equal(dim(path.join(out, `${id}-scene.webp`)), '893x1600');
  assert.equal(dim(path.join(out, `${id}-scene-sm.webp`)), '357x640');
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'csv=p=0', path.join(out, `${id}-loop.mp4`)]).toString();
  assert.match(probe, /720,1280,24\/1/);
  assert.equal(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(out, `${id}-loop.mp4`)]).toString().trim(), '', 'muted');

  // The persona file on disk carries the art, and the ledger has one ok row with the itemised estimate.
  assert.match(fs.readFileSync(ctx.personas.file(id), 'utf8'), new RegExp(`/characters/${id}-loop.mp4`));
  assert.deepEqual(rows(ctx).map((r) => [r.persona_id, r.status, Math.round(r.est_usd * 1000) / 1000]), [[id, 'ok', 0.5]]);
  assert.equal(fake.stills.length, 1);

  // Prompts: adult, clothed, non-explicit, no text; the video prompt names no placeholder.
  assert.match(fake.stills[0], /9:16/);
  assert.match(fake.stills[0], /adult/);
  assert.match(fake.stills[0], /fully and modestly clothed/);
  assert.match(fake.stills[0], /non-explicit/);
  assert.match(fake.stills[0], /No text, no brand logos/);
  assert.match(fake.scenes[0], /no people and no characters at all/);
  assert.doesNotMatch(fake.videos[0], /<IMAGE_0>|<FIRST_FRAME>/);

  // The next tick takes the rest, one per tick, until none wait.
  while (draftsNeedingArt(ctx).length) await tick(ctx, { writeReport: false });
  assert.ok(ctx.personas.all().every((p) => p.meta.status !== 'draft'));
});

test('the daily cap stops generation at the budget and resumes the next UTC day', async () => {
  const { ctx, clock, fake } = scratch({ dailyBudgetUsd: 1.2 }); // two personas at 0.5, a third would pass 1.2
  await spawnDrafts(ctx);
  const first = await runArtJob(ctx);
  assert.equal(first.attached.length, 2);
  assert.equal(first.skipped, 'budget');
  assert.equal(Math.round(spentToday(ctx) * 100) / 100, 1);
  assert.equal(fake.videos.length, 2);

  const again = await runArtJob(ctx);
  assert.equal(again.attached.length, 0);
  assert.equal(again.skipped, 'budget');
  assert.equal(fake.videos.length, 2, 'no provider call once the cap is reached');
  assert.equal(draftsNeedingArt(ctx).length, 2);

  // 23:59 UTC the same day: still capped. Just after midnight UTC: the day's ledger starts at zero.
  clock.t = Date.UTC(2026, 10, 12, 23, 59);
  assert.equal((await runArtJob(ctx)).attached.length, 0);
  clock.t = Date.UTC(2026, 10, 13, 0, 1);
  assert.equal(spentToday(ctx), 0);
  const next = await runArtJob(ctx);
  assert.equal(next.attached.length, 2);
  assert.equal(draftsNeedingArt(ctx).length, 0);
});

test('a failing provider leaves the draft, records each failure, retries identically, then leaves it for a human', async () => {
  const { ctx, out, fake } = scratch();
  const [p] = await spawnDrafts(ctx);
  const only = { only: p.meta.id };
  // Leave p as the only draft, so the scheduler's wait is about p alone.
  for (const q of ctx.personas.all()) if (q.meta.status === 'draft' && q.meta.id !== p.meta.id) ctx.personas.save({ ...q, meta: { ...q.meta, status: 'retired' } }, 'test');
  assert.equal(waitingOnArt(ctx), true, 'a fresh draft holds the next generation');
  fake.failAt = 'scene';
  for (let i = 1; i <= 3; i++) {
    const r = await runArtJob(ctx, only);
    assert.equal(r.attached.length, 0);
    assert.equal(r.failed[0].id, p.meta.id);
    assert.equal(r.failed[0].kind, 'refused');
    assert.equal(ctx.personas.get(p.meta.id)!.meta.status, 'draft');
    assert.equal(r.gaveUp.length, i === 3 ? 1 : 0);
  }
  const ledger = rows(ctx);
  assert.equal(ledger.length, 3);
  assert.ok(ledger.every((r) => r.status === 'refused' && /scene declined/.test(r.error ?? '')));
  assert.ok(ledger.every((r) => Math.abs(r.est_usd - 0.1) < 1e-9), 'only the portrait was drawn, so only it is charged');
  assert.equal(fs.existsSync(out) ? fs.readdirSync(out).length : 0, 0, 'no partial files');
  // Every retry used the identical prompts: nothing loosened.
  assert.equal(new Set(fake.stills).size, 1);
  assert.equal(new Set(fake.scenes).size, 1);

  const log = ctx.db.prepare("SELECT persona_id, detail FROM lifecycle_log WHERE kind = 'art_gave_up'").all() as { persona_id: string; detail: string }[];
  assert.equal(log.length, 1);
  assert.equal(log[0].persona_id, p.meta.id);
  assert.equal(JSON.parse(log[0].detail).attempts, 3);
  assert.equal(waitingOnArt(ctx), false, 'a draft the job gave up on no longer holds the loop');

  // A fourth run does not call the provider for it again, nor log twice.
  const calls = fake.stills.length;
  await runArtJob(ctx, only);
  await runArtJob(ctx, only);
  assert.equal(fake.stills.length, calls);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM lifecycle_log WHERE kind = 'art_gave_up'").get() as { n: number }).n, 1);
});

test('a video job the provider never accepted is not charged; one it accepted is', async () => {
  const { ctx, fake } = scratch();
  await spawnDrafts(ctx);
  fake.failAt = 'video';
  fake.billed = false;
  await runArtJob(ctx);
  const r1 = rows(ctx);
  assert.ok(r1.length >= 3 && r1.every((r) => r.status === 'failed' && Math.abs(r.est_usd - 0.2) < 1e-9));
  const before = r1.length;
  fake.billed = true;
  await runArtJob(ctx);
  const r2 = rows(ctx).slice(before);
  assert.ok(r2.length > 0 && r2.every((r) => Math.abs(r.est_usd - 0.5) < 1e-9));
});

test('with the flag off nothing runs, and with it on but no keys the job skips once without throwing', async () => {
  const off = scratch({ enabled: false });
  await spawnDrafts(off.ctx);
  const r = await runArtJob(off.ctx);
  assert.equal(r.enabled, false);
  assert.equal(r.skipped, 'disabled');
  assert.equal(off.fake.stills.length, 0);
  assert.equal(rows(off.ctx).length, 0);
  const t = await tick(off.ctx, { writeReport: false });
  assert.equal(t.art.attached.length, 0);
  assert.ok(draftsNeedingArt(off.ctx).length > 0);

  const noKeys = scratch({ geminiKey: undefined, xaiKey: undefined });
  noKeys.ctx.artProvider = undefined;
  await spawnDrafts(noKeys.ctx);
  assert.equal((await runArtJob(noKeys.ctx)).skipped, 'missing-keys');
  assert.equal((await runArtJob(noKeys.ctx)).skipped, 'missing-keys');
  assert.equal(rows(noKeys.ctx).length, 0);

  // The default is off: loadConfig without the env var disables it.
  assert.equal(loadConfig({}).art.enabled, process.env.REVERIE_AUTO_ART === '1');
});

test('the prompt builder keeps the starter wording and always stays adult, clothed and text-free', () => {
  const { ctx } = scratch();
  const raven = ctx.personas.get('raven')!;
  const s = subjectFromPersona(raven);
  const pr = buildPrompts(s);
  for (const text of [pr.portrait, pr.scene]) assert.match(text, /9:16/);
  assert.match(pr.portrait, /Subject: .*adult/);
  assert.doesNotMatch(pr.portrait, /pin-up|lingerie is|sultry/i);
  assert.match(pr.portrait, /No nudity, no lingerie, no see-through clothing/);
  assert.match(videoPromptFor(pr), /^Animate this exact portrait.* The image stays exactly/);
  // The starter builder's "spicy" wording exists only behind its own flag.
  assert.match(buildPrompts({ ...s, spicy: true }).portrait, /fully clothed and non-explicit/);
  assert.doesNotMatch(buildPrompts({ ...s, strict: false }).portrait, /pin-up/);
});

test('the Gemini and xAI requests follow the documented shapes and failures map to refused or failed', async () => {
  const cfg = loadConfig({ art: { geminiKey: 'g-key', xaiKey: 'x-key' } }).art;
  const calls: { url: string; init: RequestInit }[] = [];
  let videoPolls = 0;
  const geminiOk = { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: pngBytes.toString('base64') }] }] };
  let gemini: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: geminiOk };
  let poll: unknown[] = [{ status: 'pending' }, { status: 'done', video: { url: 'https://vidgen.example/v.mp4', duration: 6, respect_moderation: true } }];
  const res = (ok: boolean, status: number, body: unknown) => ({ ok, status, json: async () => body, arrayBuffer: async () => new Uint8Array(mp4Bytes).buffer }) as unknown as Response;
  const fakeFetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes('generativelanguage')) return res(gemini.ok, gemini.status, gemini.body);
    if (url === 'https://api.x.ai/v1/videos/generations') return res(true, 200, { request_id: 'req-1' });
    if (url === 'https://api.x.ai/v1/videos/req-1') return res(true, 200, poll[Math.min(videoPolls++, poll.length - 1)]);
    if (url === 'https://vidgen.example/v.mp4') return res(true, 200, {});
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;
  const p = new GeminiXaiProvider(cfg, { fetch: fakeFetch, sleep: async () => {}, pollMs: 0 });

  const img = await p.still('a portrait');
  assert.ok(img.equals(pngBytes));
  const g = calls[0];
  assert.equal(g.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  const gh = g.init.headers as Record<string, string>;
  assert.equal(gh['x-goog-api-key'], 'g-key');
  assert.equal(gh['Api-Revision'], '2026-05-20');
  assert.deepEqual(JSON.parse(g.init.body as string), {
    model: 'gemini-nano-banana-2.1',
    input: [{ type: 'text', text: 'a portrait' }],
    response_format: { type: 'image', aspect_ratio: '9:16', image_size: '2K' },
    store: false,
  });

  const clip = await p.video('animate', pngBytes);
  assert.ok(clip.equals(mp4Bytes));
  const sub = calls.find((c) => c.url === 'https://api.x.ai/v1/videos/generations')!;
  assert.equal((sub.init.headers as Record<string, string>).Authorization, 'Bearer x-key');
  const body = JSON.parse(sub.init.body as string);
  assert.equal(body.model, 'grok-imagine-video');
  assert.equal(body.duration, 6);
  assert.equal(body.resolution, '720p');
  assert.equal(body.aspect_ratio, '9:16');
  assert.equal(body.generate_audio, false);
  assert.match(body.image.url, /^data:image\/png;base64,/);
  assert.equal(videoPolls, 2, 'polled until done');

  // A response with no image is a refusal; a 5xx is an outage.
  gemini = { ok: true, status: 200, body: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I cannot help with that.' }] }] } };
  await assert.rejects(p.still('x'), (e: ArtProviderError) => e.kind === 'refused' && !e.billed);
  gemini = { ok: false, status: 503, body: { error: { message: 'overloaded' } } };
  await assert.rejects(p.scene('x'), (e: ArtProviderError) => e.kind === 'failed');
  poll = [{ status: 'done', video: { url: 'https://vidgen.example/v.mp4', respect_moderation: false } }];
  videoPolls = 0;
  await assert.rejects(p.video('x', pngBytes), (e: ArtProviderError) => e.kind === 'refused' && e.billed);
  poll = [{ status: 'failed', error: { code: 'invalid_argument', message: 'content blocked by moderation policy' } }];
  videoPolls = 0;
  await assert.rejects(p.video('x', pngBytes), (e: ArtProviderError) => e.kind === 'refused');
  poll = [{ status: 'failed', error: { code: 'internal_error', message: 'try again' } }];
  videoPolls = 0;
  await assert.rejects(p.video('x', pngBytes), (e: ArtProviderError) => e.kind === 'failed');
});

test('POST /admin/art/run and GET /admin/art-queue expose the job and the spend', async () => {
  const { ctx, fake } = scratch({ dailyBudgetUsd: 0.6 });
  await spawnDrafts(ctx);
  const server: http.Server = createServer(ctx);
  await new Promise<void>((r) => server.listen(0, r));
  try {
    const base = `http://localhost:${(server.address() as { port: number }).port}`;
    const run = (await (await fetch(`${base}/admin/art/run`, { method: 'POST' })).json()) as { attached: string[]; skipped?: string; spentTodayUsd: number };
    assert.equal(run.attached.length, 1);
    assert.equal(run.skipped, 'budget');
    assert.equal(run.spentTodayUsd, 0.5);
    const q = (await (await fetch(`${base}/admin/art-queue`)).json()) as { auto: { enabled: boolean; spentTodayUsd: number; remainingTodayUsd: number; waiting: string[]; recent: unknown[] }; drafts: unknown[] };
    assert.equal(q.auto.enabled, true);
    assert.equal(q.auto.spentTodayUsd, 0.5);
    assert.equal(q.auto.remainingTodayUsd, 0.1);
    assert.equal(q.auto.recent.length, 1);
    assert.equal(q.auto.waiting.length, q.drafts.length);
    assert.equal(fake.videos.length, 1);
  } finally {
    server.close();
  }
});
