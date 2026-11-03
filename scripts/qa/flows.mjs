// flows.mjs: tap through the real flows on a phone (iPhone 15 by default),
// with page.tap() on what a thumb uses:
//   swipe like on Sylvara -> match -> Say hi -> chat -> send -> typing shows ->
//   her reply arrives; drawer -> switch chat; filter chips; Start over;
//   reload keeps state; arrow keys on desktop.
//
// Usage: PLAYWRIGHT_MODULE=... node scripts/qa/flows.mjs [device="iPhone 15"]
import { join } from 'node:path';
import { SHOTS, contextOptions, freshPage, launch, sleep } from './pw.mjs';

const deviceName = process.argv[2] ?? 'iPhone 15';
const checks = [];
const ok = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await launch();
const { page, errors } = await freshPage(browser, contextOptions(deviceName));
const tap = async (loc) => {
  await loc.first().waitFor({ state: 'visible', timeout: 5000 });
  await loc.first().tap();
};
const topName = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('[aria-label$="View profile"]')].find((el) => !el.closest('[inert]'));
    return b ? b.getAttribute('aria-label').split(',')[0] : null;
  });
const frameTheme = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-frame]')).getPropertyValue('--t-accent').trim());

// 1. Explore, drag Sylvara past the commit threshold to like her.
await tap(page.locator('button[aria-label="Explore new people"]'));
await sleep(1200);
ok('Explore opens with Sylvara on top', (await topName()) === 'Sylvara', await topName());
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
const dialog = page.locator('[role="dialog"][aria-labelledby="match-title"]');
await dialog.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
ok('Swipe right on Sylvara shows the match moment', await dialog.isVisible(), await dialog.locator('h2').textContent().catch(() => ''));
await sleep(700);
await page.screenshot({ path: join(SHOTS, 'flow-match.png') });

// 2. Say hi -> her chat with the opener.
await tap(page.getByRole('button', { name: 'Say hi' }));
await sleep(1000);
const headerName = await page.locator('[data-slot="chat-header"] h1').textContent().catch(() => null);
ok('Say hi opens her chat', headerName === 'Sylvara', headerName);
const bubbles = () => page.locator('[data-slot="message-list"] ol > li').count();
const before = await bubbles();
ok('Her opener is the first message', before >= 1, `${before} messages`);

// 3. Send a message: typing shows first, then her reply lands.
const input = page.locator('[data-slot="composer"] input');
await input.tap();
await input.fill('Hello Sylvara, what is the forest like tonight?');
await tap(page.getByRole('button', { name: 'Send' }));
const t0 = Date.now();
const typing = page.locator('[data-slot="message-list"] [data-slot="typing-dots"]');
await typing.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
const typingSeenAt = Date.now() - t0;
ok('Typing dots show after sending', await typing.isVisible(), `${typingSeenAt}ms`);
await page.screenshot({ path: join(SHOTS, 'flow-typing.png') });
await typing.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
const replyAt = Date.now() - t0;
const after = await bubbles();
ok('Her reply arrives after typing', after >= before + 2, `${before} -> ${after} messages, typing ${replyAt}ms`);
ok('Typing lasts 1200..2400ms', replyAt >= 1150 && replyAt <= 2600, `${replyAt}ms`);
await sleep(500);
await page.screenshot({ path: join(SHOTS, 'flow-reply.png') });

// 4. Quick reply chip: "Take me somewhere" -> a card group.
await tap(page.getByRole('button', { name: 'Quick replies' }));
await sleep(300);
await tap(page.getByRole('button', { name: 'Take me somewhere' }));
await page.locator('[data-slot="card-group"]').last().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
ok('"Take me somewhere" answers with a card group', await page.locator('[data-slot="card-group"]').count() > 0);
await sleep(600);
await page.screenshot({ path: join(SHOTS, 'flow-cards.png') });

// 5. Drawer -> switch to Nova.
await tap(page.locator('[data-slot="chat-header"] button[aria-label="Chats"]'));
await sleep(500);
const drawer = page.locator('[data-slot="chats-drawer"]');
ok('Hamburger opens the drawer', await drawer.isVisible());
const firstRow = await drawer.locator('li').first().textContent();
ok('Sylvara moved to the top of the list', /Sylvara/.test(firstRow ?? ''), (firstRow ?? '').slice(0, 30));
await tap(drawer.locator('button', { hasText: 'Nova' }));
await sleep(1000);
const now = await page.locator('[data-slot="chat-header"] h1').textContent().catch(() => null);
ok('A drawer pick switches the chat', now === 'Nova' && !(await drawer.isVisible()), now);
ok('The frame is themed to Nova', (await frameTheme()) !== '', await frameTheme());

// 6. Filter chips.
await tap(page.locator('button[aria-label="Explore new people"]'));
await sleep(900);
await tap(page.getByRole('button', { name: 'Goth', exact: true }));
await sleep(700);
const goth = await topName();
ok('Goth filter shows Raven (Vesper is matched)', goth === 'Raven', goth);
await tap(page.getByRole('button', { name: 'Fantasy', exact: true }));
await sleep(700);
ok('Fantasy filter shows Nerissa (Sylvara is matched)', (await topName()) === 'Nerissa', await topName());

// 7. Pass everyone in Fantasy -> empty -> Start over.
for (let i = 0; i < 6 && (await topName()); i++) {
  await tap(page.locator('button[aria-label^="Pass on "]'));
  await sleep(700);
}
const startOver = page.getByRole('button', { name: 'Start over' });
ok('An empty deck offers one action', await startOver.isVisible().catch(() => false));
await page.screenshot({ path: join(SHOTS, 'flow-empty.png') });
await tap(startOver);
await sleep(900);
const back = await topName();
ok('Start over brings the deck back with the filter cleared', back === 'Kiyo', back);
const pressedAll = await page.getByRole('button', { name: 'All', exact: true }).getAttribute('aria-pressed');
ok('Start over resets the chip to All', pressedAll === 'true');

// 8. Pass one, then reload: matches, messages and passes persist.
await tap(page.locator('button[aria-label^="Pass on "]'));
await sleep(700);
const topBeforeReload = await topName();
await page.reload({ waitUntil: 'networkidle' });
await sleep(1200);
const rows = await page.locator('[data-slot="chat-row"]').allTextContents();
ok('Reload keeps the new match in Chats', rows.some((r) => r.includes('Sylvara')), `${rows.length} rows`);
await tap(page.locator('[data-slot="chat-row"]', { hasText: 'Sylvara' }));
await sleep(900);
const persisted = await page.locator('[data-slot="message-list"] ol > li').count();
ok('Reload keeps her conversation', persisted >= after + 2, `${persisted} messages`);
await tap(page.locator('button[aria-label="Explore new people"]'));
await sleep(900);
ok('Reload keeps passes (same top card)', (await topName()) === topBeforeReload, `${await topName()} vs ${topBeforeReload}`);

ok('No page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close().catch(() => {});

// Desktop: arrow keys swipe (Left = pass, Right = like).
{
  const b2 = await launch();
  const { page: p2 } = await freshPage(b2, contextOptions(null));
  // Keyboard only: Tab through the Chats list and a chat; every stop shows
  // a 2px solid ring and sits inside the frame.
  const tabStops = async (n) => {
    const stops = [];
    for (let i = 0; i < n; i++) {
      await p2.keyboard.press('Tab');
      stops.push(
        await p2.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const dev = document.querySelector('[data-slot="device"]').getBoundingClientRect();
          const ring = (cs.outlineStyle === 'solid' && cs.outlineWidth === '2px') || el.closest('form')?.matches(':has(input:focus-visible)');
          return {
            name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24),
            ring: !!ring,
            inside: r.left >= dev.left - 1 && r.right <= dev.right + 1 && r.top >= dev.top - 1 && r.bottom <= dev.bottom + 1,
          };
        })
      );
    }
    return stops.filter(Boolean);
  };
  const listStops = await tabStops(10);
  ok('Keyboard: every Chats stop draws the 2px ring', listStops.every((s) => s.ring), listStops.filter((s) => !s.ring).map((s) => s.name).join(', '));
  ok('Keyboard: focused stops sit inside the frame', listStops.every((s) => s.inside), listStops.filter((s) => !s.inside).map((s) => s.name).join(', '));
  await p2.locator('[data-slot="chat-row"]', { hasText: 'Vesper' }).focus();
  await p2.keyboard.press('Enter');
  await sleep(900);
  const chatStops = await tabStops(6);
  ok('Keyboard: every chat stop draws the 2px ring', chatStops.every((s) => s.ring), chatStops.map((s) => `${s.name}${s.ring ? '' : ' (no ring)'}`).join(', '));
  await p2.keyboard.press('Escape');
  await p2.locator('button[aria-label="Explore new people"]').click();
  await sleep(1200);
  const name0 = await p2.evaluate(() => [...document.querySelectorAll('[aria-label$="View profile"]')].find((el) => !el.closest('[inert]'))?.getAttribute('aria-label').split(',')[0]);
  await p2.keyboard.press('ArrowLeft');
  await sleep(700);
  const name1 = await p2.evaluate(() => [...document.querySelectorAll('[aria-label$="View profile"]')].find((el) => !el.closest('[inert]'))?.getAttribute('aria-label').split(',')[0]);
  ok('ArrowLeft passes on desktop', name0 === 'Sylvara' && name1 === 'Kiyo', `${name0} -> ${name1}`);
  await p2.keyboard.press('ArrowRight');
  await sleep(900);
  ok('ArrowRight likes (match moment)', await p2.locator('[role="dialog"][aria-labelledby="match-title"]').isVisible());
  // Keyboard focus: Tab moves between Say hi and Keep exploring; the ring is drawn.
  await p2.keyboard.press('Tab');
  const ring = await p2.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { text: el.textContent, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, offset: cs.outlineOffset };
  });
  ok('Focus ring is a 2px solid outline, offset 2px', /solid 2px/.test(ring.outline) && ring.offset === '2px', JSON.stringify(ring));
  await p2.screenshot({ path: join(SHOTS, 'flow-focus.png') });
  await b2.close().catch(() => {});
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} flow checks pass`);
process.exitCode = failed.length ? 1 : 0;
