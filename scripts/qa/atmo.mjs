// atmo.mjs: frame bursts proving the living atmosphere moves and answers.
// For each world: an idle burst (6 frames 150ms apart), a burst right after
// sending a message (the gust), a burst as her reply lands (the bloom); on
// Explore, the next world fading in under the finger as the card is dragged.
// Each burst becomes one strip PNG; the mean pixel change between frames
// (magick compare MAE, 0..1) is printed so "static" is a number, not a guess.
//
// Usage: PLAYWRIGHT_MODULE=... node scripts/qa/atmo.mjs [prefix=atmo] [reduced]
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { SHOTS, contextOptions, freshPage, launch, sleep } from './pw.mjs';

const prefix = process.argv[2] ?? 'atmo';
const reduced = process.argv.includes('reduced');
const summary = [];

function mae(a, b) {
  try {
    execFileSync('magick', ['compare', '-metric', 'MAE', a, b, 'null:'], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    const m = /\(([\d.e-]+)\)/.exec(String(e.stderr));
    return m ? Number(m[1]) : NaN;
  }
}

async function burst(page, name, { frames = 6, gapMs = 150, before } = {}) {
  const files = [];
  const t0 = Date.now();
  if (before) await before();
  for (let i = 0; i < frames; i++) {
    const due = t0 + i * gapMs;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
    const f = join(SHOTS, `${prefix}-${name}-${i}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
  const spanMs = Date.now() - t0;
  const diffs = files.slice(1).map((f, i) => mae(files[i], f));
  const strip = join(SHOTS, `${prefix}-${name}.png`);
  execFileSync('magick', [...files, '-resize', 'x640', '+append', strip]);
  const avg = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  summary.push({ name, strip, spanMs, diffs, avg });
  console.log(`${name.padEnd(22)} span ${spanMs}ms  mean change ${(avg * 100).toFixed(2)}%  [${diffs.map((d) => (d * 100).toFixed(2)).join(' ')}]`);
  return strip;
}

const browser = await launch();
const opts = contextOptions('iPhone 15', { deviceScaleFactor: 2, ...(reduced ? { reducedMotion: 'reduce' } : {}) });
const { page, errors } = await freshPage(browser, opts);
const tap = async (loc) => {
  await loc.first().waitFor({ state: 'visible', timeout: 5000 });
  await loc.first().tap();
};
const msgCount = () => page.locator('[data-slot="message-list"] ol > li').count();
const topCard = () => page.locator('[aria-label$="View profile"]:not([inert] *)').first();

async function chatBursts(label, text) {
  await sleep(1800);
  await burst(page, `${label}-idle`);
  const n0 = await msgCount();
  const input = page.locator('[data-slot="composer"] input');
  await input.tap();
  await input.fill(text);
  await burst(page, `${label}-gust`, { before: () => page.getByRole('button', { name: 'Send' }).tap() });
  // Wait for her reply to land, then capture the bloom.
  for (let i = 0; i < 60 && (await msgCount()) < n0 + 2; i++) await sleep(50);
  await burst(page, `${label}-bloom`);
  await sleep(600);
}

async function openChat(name) {
  await tap(page.locator('[data-slot="tab"]', { hasText: 'Chats' }));
  await sleep(700);
  await tap(page.locator('[data-slot="chat-row"]', { hasText: name }));
  await sleep(900);
}

async function dragPreview(label) {
  const card = topCard();
  const box = await card.boundingBox();
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const files = [];
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  // Commit threshold is 30% of the card width: sample 0..95% of it.
  const shares = [0, 0.25, 0.5, 0.75, 0.95];
  for (const [i, s] of shares.entries()) {
    const target = x0 + box.width * 0.3 * s;
    await page.mouse.move(target, y0, { steps: 4 });
    await sleep(420);
    const f = join(SHOTS, `${prefix}-${label}-drag-${i}.png`);
    await page.screenshot({ path: f });
    files.push(f);
  }
  await page.mouse.move(x0, y0, { steps: 6 });
  await page.mouse.up();
  await sleep(900);
  const strip = join(SHOTS, `${prefix}-${label}-drag.png`);
  execFileSync('magick', [...files, '-resize', 'x640', '+append', strip]);
  const diffs = files.slice(1).map((f, i) => mae(files[i], f));
  summary.push({ name: `${label}-drag`, strip, diffs });
  console.log(`${`${label}-drag`.padEnd(22)} change per step [${diffs.map((d) => (d * 100).toFixed(2)).join(' ')}]`);
}

// Grove: Explore with Sylvara on top, idle, then the next world under the finger.
await tap(page.locator('[data-slot="tab"]', { hasText: 'Explore' }));
await sleep(2200);
await burst(page, 'grove-explore-idle');
await dragPreview('grove');

// Like Sylvara -> match -> Say hi -> her chat.
await burst(page, 'grove-match', { before: () => page.locator('button[aria-label^="Like "]').tap() });
await sleep(600);
await tap(page.getByRole('button', { name: 'Say hi' }));
await chatBursts('grove-chat', 'Walk with me to the old oak?');

// Crimson (Vesper) and neon (Nova).
await openChat('Vesper');
await chatBursts('crimson', 'I brought the candles you asked for.');
await openChat('Nova');
await chatBursts('neon', 'What are you hacking tonight?');

// Sunflower: pass four, Clementine on top, like her, chat.
await tap(page.locator('[data-slot="tab"]', { hasText: 'Explore' }));
await sleep(900);
for (let i = 0; i < 6; i++) {
  const name = (await topCard().getAttribute('aria-label'))?.split(',')[0];
  if (name === 'Clementine') break;
  await tap(page.locator('button[aria-label^="Pass on "]'));
  await sleep(900);
}
await sleep(1500);
await burst(page, 'sunflower-explore-idle');
await tap(page.locator('button[aria-label^="Like "]'));
await sleep(1200);
await tap(page.getByRole('button', { name: 'Say hi' }));
await chatBursts('sunflower', 'How are the bees today?');

if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
await browser.close().catch(() => {});
console.log(JSON.stringify(summary.map(({ name, avg }) => ({ name, avg })), null, 0));
