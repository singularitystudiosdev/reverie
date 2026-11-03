// reduced.mjs: prefers-reduced-motion: reduce on iPhone 15.
// Particles render one still frame (no rAF loop), overlays stop, screens
// swap without a slide, and the swipe still works (the card fades instead of
// flying).
//
// Usage: PLAYWRIGHT_MODULE=... node scripts/qa/reduced.mjs
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { SHOTS, contextOptions, launch, sleep, BASE } from './pw.mjs';

const checks = [];
const ok = (name, pass, detail = '') => {
  checks.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
function mae(a, b) {
  try {
    execFileSync('magick', ['compare', '-metric', 'MAE', a, b, 'null:'], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    const m = /\(([\d.e-]+)\)/.exec(String(e.stderr));
    return m ? Number(m[1]) : NaN;
  }
}

const browser = await launch();
const context = await browser.newContext(contextOptions('iPhone 15', { reducedMotion: 'reduce', deviceScaleFactor: 2 }));
await context.addInitScript(() => {
  if (!sessionStorage.getItem('qa:init')) {
    localStorage.clear();
    sessionStorage.setItem('qa:init', '1');
  }
  // Count animation frames requested, to prove the engine loop stops.
  const raf = window.requestAnimationFrame.bind(window);
  window.__rafCount = 0;
  window.requestAnimationFrame = (cb) => {
    window.__rafCount++;
    return raf(cb);
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle' });
await sleep(1200);

const rafOver = async (ms) => {
  const a = await page.evaluate(() => window.__rafCount);
  await sleep(ms);
  const b = await page.evaluate(() => window.__rafCount);
  return b - a;
};
const runningAnimations = () =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => `${a.animationName ?? a.constructor.name}:${a.effect?.target?.className?.toString().slice(0, 30) ?? ''}`)
  );

// Chats list: rings still, no stagger.
ok('Chats list: no running animations', (await runningAnimations()).length === 0, (await runningAnimations()).join(', '));

// Push to a chat: no slide. Sample the incoming screen's transform right after the tap.
await page.locator('[data-slot="chat-row"]', { hasText: 'Vesper' }).tap();
await sleep(40);
const transforms = await page.evaluate(() =>
  [...document.querySelectorAll('main > div')].map((d) => getComputedStyle(d).transform)
);
ok('Chat push swaps without a slide', transforms.every((t) => t === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t)), transforms.join(' | '));
await sleep(1500);
const a = join(SHOTS, 'reduced-vesper-a.png');
const b = join(SHOTS, 'reduced-vesper-b.png');
await page.screenshot({ path: a });
const frames = await rafOver(1000);
await page.screenshot({ path: b });
const change = mae(a, b);
ok('Chat atmosphere is one still frame', change < 0.0005, `MAE ${(change * 100).toFixed(3)}%`);
ok('No animation-frame loop runs at rest', frames <= 2, `${frames} rAF calls in 1s`);
ok('Overlays stopped (no running animations)', (await runningAnimations()).length === 0, (await runningAnimations()).join(', '));

// Sending still works; her reply lands; the world stays still.
const input = page.locator('[data-slot="composer"] input');
await input.tap();
await input.fill('Good evening.');
await page.getByRole('button', { name: 'Send' }).tap();
await page.locator('[data-slot="message-list"] [data-slot="typing-dots"]').waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
await page.locator('[data-slot="message-list"] [data-slot="typing-dots"]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
await sleep(1200);
const c = join(SHOTS, 'reduced-vesper-c.png');
const d = join(SHOTS, 'reduced-vesper-d.png');
await page.screenshot({ path: c });
await sleep(700);
await page.screenshot({ path: d });
ok('After a reply the world is still again', mae(c, d) < 0.0005, `MAE ${(mae(c, d) * 100).toFixed(3)}%`);

// Explore: swipe still works, the card fades instead of flying.
await page.locator('[data-slot="tab"]', { hasText: 'Explore' }).tap();
await sleep(1200);
await page.screenshot({ path: join(SHOTS, 'reduced-explore.png') });
const card = page.locator('[aria-label$="View profile"]:not([inert] *)').first();
const box = await card.boundingBox();
const x0 = box.x + box.width / 2;
const y0 = box.y + box.height / 2;
await page.mouse.move(x0, y0);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(x0 - (box.width * 0.5 * i) / 12, y0);
  await sleep(16);
}
const follows = await page.evaluate(() => {
  const layer = [...document.querySelectorAll('[aria-label$="View profile"]')].find((el) => !el.closest('[inert]'))?.parentElement;
  return layer ? getComputedStyle(layer).transform : null;
});
ok('The card still follows the finger', !!follows && follows !== 'none', follows);
await page.mouse.up();
await sleep(60);
const flying = await page.evaluate(() => {
  const layer = [...document.querySelectorAll('[aria-label$="View profile"]')].find((el) => !el.closest('[inert]'))?.parentElement;
  return layer ? { o: getComputedStyle(layer).opacity, t: getComputedStyle(layer).transform } : null;
});
await sleep(600);
const top = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label$="View profile"]')].find((el) => !el.closest('[inert]'))?.getAttribute('aria-label').split(',')[0]
);
ok('Swipe left passes under reduced motion', top === 'Kiyo', `${top}; at release ${JSON.stringify(flying)}`);
// Like with the button -> match moment fades in (no pop).
await page.locator('button[aria-label^="Like "]').tap();
await sleep(500);
await page.screenshot({ path: join(SHOTS, 'reduced-match.png') });
const scale = await page.evaluate(() => {
  const av = document.querySelector('[aria-labelledby="match-title"] [data-slot="avatar"]')?.parentElement;
  return av ? getComputedStyle(av).transform : null;
});
ok('Match moment: no pop', scale === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(scale ?? ''), scale);
ok('Match moment: atmosphere still', (await rafOver(800)) <= 2);
ok('No page errors', errors.length === 0, errors.join(' | '));

await browser.close().catch(() => {});
const failed = checks.filter((x) => !x.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} reduced-motion checks pass`);
process.exitCode = failed.length ? 1 : 0;
