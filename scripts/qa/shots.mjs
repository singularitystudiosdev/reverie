// shots.mjs: the final review set, one PNG per surface on the frames that matter:
// the desktop phone frame, iPhone 15 (full screen, real insets) and the 393x659
// Safari viewport. Chats, Vesper's chat, Nova's chat, Explore (Sylvara), mid-drag,
// the match moment (reached by dragging), the profile sheet and the drawer.
//
// Usage: PLAYWRIGHT_MODULE=... node scripts/qa/shots.mjs [prefix=verify]
import { join } from 'node:path';
import { SHOTS, contextOptions, devices, dragBy, freshPage, launch, press, sleep } from './pw.mjs';

const prefix = process.argv[2] ?? 'verify';
const SETS = [
  ['desktop', contextOptions(null), null],
  ['iphone15', { ...devices['iPhone 15'], viewport: { width: 393, height: 852 } }, { top: 59, bottom: 34, left: 0, right: 0 }],
  ['short', { ...devices['iPhone 15'], viewport: { width: 393, height: 659 } }, null],
];

for (const [key, opts, insets] of SETS) {
  const browser = await launch();
  const { context, page } = await freshPage(browser, opts);
  if (insets) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await page.reload({ waitUntil: 'networkidle' });
  }
  const shot = async (name) => page.screenshot({ path: join(SHOTS, `${prefix}-${key}-${name}.png`) });
  await sleep(1200);
  await shot('chats');
  await press(page, page.locator('[data-slot="chat-row"]', { hasText: 'Vesper' }));
  await sleep(1600);
  await shot('vesper');
  await press(page, page.locator('[data-slot="chat-header"] button[aria-label="Chats"]'));
  await sleep(700);
  await shot('drawer');
  await press(page, page.locator('[data-slot="chats-drawer"] button', { hasText: 'Nova' }).first());
  await sleep(1700);
  await shot('nova');
  await press(page, page.locator('[data-slot="chat-header"] button', { hasText: 'Profile' }));
  await sleep(900);
  await shot('profile');
  await press(page, page.locator('button[aria-label="Close profile"]'));
  await sleep(500);
  await press(page, page.locator('[data-slot="tab"]', { hasText: 'Explore' }));
  await sleep(1800);
  await shot('explore');
  const card = page.locator('[aria-label$="View profile"]:not([inert] *)').first();
  const box = await card.boundingBox();
  const release = await dragBy(page, card, box.width * 0.26, { hold: true, steps: 14 });
  await sleep(450);
  await shot('middrag');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await release();
  await sleep(700);
  // The match moment by dragging past the threshold.
  const b2 = await card.boundingBox();
  await dragBy(page, card, b2.width * 0.55, { steps: 16 });
  await page.locator('[role="dialog"][aria-labelledby="match-title"]').waitFor({ state: 'visible', timeout: 4000 });
  await sleep(1500);
  await shot('match');
  console.log(`${key} done`);
  await browser.close().catch(() => {});
}
