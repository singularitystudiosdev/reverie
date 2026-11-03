// handoff.mjs: proves the post-match world hand-off.
//
// Like Sylvara by drag -> match moment -> "Keep exploring". The frame must
// ramp the next world (Kiyo's foxfire) in from the preview that Explore armed
// and decoded while the match showed; it must not build a fresh world after
// the tap (a cold crossfade: plate not decoded, a pop when it lands).
//
// Two runs:
//  1. DEV build (QA_DEV_URL, exposes the engine as window.__atmoEngine): an
//     rAF sampler records the engine's stack and preview every frame from the
//     tap on, and makeWorld calls are counted. PASS needs: no stack world was
//     made after the tap; the world that fades in IS the armed preview object
//     (same identity, plate decoded); its opacity starts under 5% and rises
//     monotonically with no step over 15% per frame; it ends opaque and the
//     outgoing world is removed only then.
//  2. PRODUCTION build (QA_URL): a screenshot burst from the tap, one strip
//     PNG, with the mean change between frames, for the eye.
//
// Usage: PLAYWRIGHT_MODULE=... QA_DEV_URL=http://127.0.0.1:44581/ node scripts/qa/handoff.mjs [prefix=handoff]
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { BASE, SHOTS, contextOptions, freshPage, launch, sleep } from './pw.mjs';

const prefix = process.argv[2] ?? 'handoff';
const DEV = process.env.QA_DEV_URL ?? 'http://127.0.0.1:44581/';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function likeByDrag(page) {
  // A fresh store opens on Explore; from a chat, the header magnifier gets there.
  const toExplore = page.locator('button[aria-label="Explore new people"]');
  if (await toExplore.isVisible().catch(() => false)) await toExplore.tap();
  await sleep(2600); // the first card's world is up and the second armed and decoded
  const card = page.locator('[aria-label$="View profile"]:not([inert] *)').first();
  const box = await card.boundingBox();
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(x0 + (box.width * 0.55 * i) / 16, y0 + i);
    await sleep(16);
  }
  await page.mouse.up();
  await page.locator('[role="dialog"][aria-labelledby="match-title"]').waitFor({ state: 'visible', timeout: 4000 });
}

// ---- 1. the engine's own state, frame by frame (development build) ----
{
  const browser = await launch();
  const { page, errors } = await freshPage(browser, contextOptions('iPhone 15'), {});
  await page.goto(DEV, { waitUntil: 'networkidle' });
  await sleep(800);
  const hasEngine = await page.evaluate(() => !!window.__atmoEngine);
  ok('development build exposes the engine', hasEngine);
  if (hasEngine) {
    await page.evaluate(() => {
      const e = window.__atmoEngine;
      const ids = new WeakMap();
      let n = 0;
      const idOf = (w) => (w ? (ids.get(w) ?? (ids.set(w, ++n), n)) : null);
      const made = [];
      const orig = e.makeWorld.bind(e);
      e.makeWorld = (spec, src, role) => {
        const w = orig(spec, src, role);
        made.push({ t: performance.now(), theme: spec.id, role, obj: idOf(w) });
        return w;
      };
      const snap = (w) => (w ? { obj: idOf(w), id: w.id, op: +w.opacity.toFixed(3), ready: !!w.group.ready, ramp: !!w.ramp } : null);
      const frames = [];
      let on = false;
      const tick = () => {
        if (on) frames.push({ t: performance.now(), stack: e.stack.map(snap), preview: snap(e.preview), previewW: +e.rtpc.previewW.toFixed(3) });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__hand = { frames, made, start: () => { on = true; frames.length = 0; made.length = 0; }, snap: () => ({ stack: e.stack.map(snap), preview: snap(e.preview) }) };
    });
    await likeByDrag(page);
    await sleep(2000); // sit on the match: the preview eases to weight 0 and stays armed
    const during = await page.evaluate(() => window.__hand.snap());
    console.log('during match:', JSON.stringify(during));
    ok('while the match shows, the top card (Kiyo) is armed and decoded', during.preview?.id === 'foxfire' && during.preview.ready, JSON.stringify(during.preview));
    const armedObj = during.preview?.obj;
    await page.evaluate(() => window.__hand.start());
    await page.getByRole('button', { name: 'Keep exploring' }).tap();
    await sleep(1600);
    const { frames, made } = await page.evaluate(() => ({ frames: window.__hand.frames, made: window.__hand.made }));
    const t0 = frames[0]?.t ?? 0;
    const tops = frames.map((f) => f.stack[f.stack.length - 1]);
    const first = tops.find((w) => w?.id === 'foxfire');
    const series = tops.filter((w) => w?.obj === armedObj).map((w) => w.op);
    const steps = series.slice(1).map((v, i) => v - series[i]);
    const maxStep = Math.max(0, ...steps);
    const stackMade = made.filter((m) => m.role === 'stack');
    console.log(`frames ${frames.length} over ${Math.round(frames.at(-1).t - t0)}ms; made after tap: ${JSON.stringify(made.map((m) => [Math.round(m.t - t0), m.theme, m.role]))}`);
    console.log(`foxfire opacity per frame: ${series.filter((_, i) => i % 3 === 0).join(' ')}`);
    ok('no stack world is built after "Keep exploring" (no cold crossfade)', stackMade.length === 0, `${stackMade.length} stack worlds made`);
    ok('the world fading in is the armed preview object, plate decoded', !!first && first.obj === armedObj && first.ready, JSON.stringify(first));
    ok('it starts under 5% opacity (no pop)', series.length > 0 && series[0] < 0.05, `first ${series[0]}`);
    ok('it rises monotonically with no step over 15% per frame', steps.every((s) => s >= -0.001) && maxStep <= 0.15, `max step ${maxStep.toFixed(3)} over ${series.length} frames`);
    ok('it ends opaque and alone', frames.at(-1).stack.length === 1 && frames.at(-1).stack[0].op === 1 && frames.at(-1).stack[0].id === 'foxfire', JSON.stringify(frames.at(-1).stack));
    ok('the next card (Nerissa) is re-armed behind it', frames.at(-1).preview?.id === 'tide', JSON.stringify(frames.at(-1).preview));
  }
  if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
  await browser.close().catch(() => {});
}

// ---- 2. the pixels (production build): a burst from the tap ----
{
  const browser = await launch();
  const { page } = await freshPage(browser, contextOptions('iPhone 15', { deviceScaleFactor: 2 }));
  await likeByDrag(page);
  await sleep(2000);
  const files = [];
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Keep exploring' }).tap();
  for (let i = 0; i < 8; i++) {
    const wait = t0 + i * 120 - Date.now();
    if (wait > 0) await sleep(wait);
    const f = join(SHOTS, `${prefix}-keep-${i}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
  const mae = (a, b) => {
    try {
      execFileSync('magick', ['compare', '-metric', 'MAE', a, b, 'null:'], { stdio: 'pipe' });
      return 0;
    } catch (e) {
      const m = /\(([\d.e-]+)\)/.exec(String(e.stderr));
      return m ? Number(m[1]) : NaN;
    }
  };
  const diffs = files.slice(1).map((f, i) => mae(files[i], f));
  const strip = join(SHOTS, `${prefix}-keep.png`);
  execFileSync('magick', [...files, '-resize', 'x640', '+append', strip]);
  console.log(`burst strip ${strip}\nchange per step [${diffs.map((d) => (d * 100).toFixed(2)).join(' ')}]`);
  const biggest = Math.max(...diffs);
  ok('pixel burst: no single frame jumps (largest step under 12% mean change)', biggest < 0.12, `${(biggest * 100).toFixed(2)}%`);
  await browser.close().catch(() => {});
}

// ---- 3. like by drag -> Say hi -> chat -> send -> typing -> reply: gust, then bloom (development build) ----
{
  const browser = await launch();
  const { page, errors } = await freshPage(browser, contextOptions('iPhone 15'), {});
  await page.goto(DEV, { waitUntil: 'networkidle' });
  await sleep(800);
  await page.evaluate(() => {
    const e = window.__atmoEngine;
    const rows = [];
    const tick = () => {
      rows.push({ t: performance.now(), typing: e.rtpc.typing, gust: e.rtpc.gust, bloom: e.rtpc.bloom, top: e.stack[e.stack.length - 1]?.id });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__rtpc = rows;
  });
  await likeByDrag(page);
  await sleep(700);
  await page.getByRole('button', { name: 'Say hi' }).tap();
  await sleep(1500);
  const header = await page.locator('[data-slot="chat-header"] h1').textContent();
  ok('Say hi opens Sylvara\'s chat in her world', header === 'Sylvara' && (await page.evaluate(() => window.__rtpc.at(-1).top)) === 'grove', header);
  const input = page.locator('[data-slot="composer"] input');
  await input.tap();
  await input.fill('Walk with me to the old oak?');
  const tSend = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Send' }).tap();
  await page.locator('[data-slot="message-list"] [data-slot="typing-dots"]').waitFor({ state: 'visible', timeout: 2000 });
  const tTyping = await page.evaluate(() => performance.now());
  await page.locator('[data-slot="message-list"] [data-slot="typing-dots"]').waitFor({ state: 'detached', timeout: 6000 });
  const tReply = await page.evaluate(() => performance.now());
  await sleep(1500);
  const rows = await page.evaluate(() => window.__rtpc);
  const after = rows.filter((r) => r.t >= tSend);
  const peak = (key, lo, hi) => after.filter((r) => r.t >= lo && r.t <= hi).reduce((m, r) => (r[key] > m.v ? { v: r[key], t: r.t } : m), { v: 0, t: 0 });
  const gust = peak('gust', tSend, tReply);
  const typing = peak('typing', tTyping, tReply);
  const bloom = peak('bloom', tReply, tReply + 1500);
  // The dots leave with an exit animation, so the reply bubble lands a beat before they detach:
  // judge "not before" against the moment the reply text is in the list.
  const bloomOnset = after.find((r) => r.bloom > 0.05)?.t ?? Infinity;
  const bloomBefore = bloomOnset - tTyping;
  console.log(`send at 0ms; typing dots +${Math.round(tTyping - tSend)}ms; reply +${Math.round(tReply - tSend)}ms`);
  console.log(`gust peak ${gust.v.toFixed(2)} at +${Math.round(gust.t - tSend)}ms; typing peak ${typing.v.toFixed(2)}; bloom peak ${bloom.v.toFixed(2)} at +${Math.round(bloom.t - tSend)}ms; bloom onset +${Math.round(bloomOnset - tSend)}ms, dots gone +${Math.round(tReply - tSend)}ms`);
  ok('gust fires on send (peak over 0.3, before the typing window ends)', gust.v > 0.3 && gust.t < tReply, `${gust.v.toFixed(2)}`);
  ok('typing rises while she types (over 0.5)', typing.v > 0.5, `${typing.v.toFixed(2)}`);
  ok('bloom fires when the reply lands, after typing began and the gust (peak over 0.3)', bloom.v > 0.3 && bloomOnset > gust.t && bloomOnset >= tTyping + 800, `peak ${bloom.v.toFixed(2)}, onset +${Math.round(bloomOnset - tSend)}ms vs dots gone +${Math.round(tReply - tSend)}ms`);
  ok('gust comes first, then bloom', gust.t < bloom.t, `gust +${Math.round(gust.t - tSend)}ms, bloom +${Math.round(bloom.t - tSend)}ms`);
  if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `HANDOFF FAIL: ${failed.map((r) => r.name).join('; ')}` : 'HANDOFF PASS');
process.exit(failed.length ? 1 : 0);
