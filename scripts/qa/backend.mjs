// backend.mjs: the app talking to the persona backend, end to end, in a browser.
//   deck order comes from /v1/feed -> swipe right -> match -> Say hi -> send ->
//   a reply lands -> the server has the user's impressions, swipe, match,
//   chat and messages, with the feed's propensities on the impressions.
//
// Needs the server and an app build pointed at it:
//   REVERIE_DB=/tmp/e2e.db PORT=8799 REVERIE_ADMIN_OPEN=1 node server/src/main.ts &
//   VITE_REVERIE_API=http://127.0.0.1:8799 npx vite build --outDir .tmp/dist-api
//   node scripts/qa/serve.mjs 44641 .tmp/dist-api &
//   QA_URL=http://127.0.0.1:44641/ QA_API=http://127.0.0.1:8799 PLAYWRIGHT_MODULE=... node scripts/qa/backend.mjs
import { join } from 'node:path';
import { SHOTS, contextOptions, freshPage, launch, sleep } from './pw.mjs';

const API = process.env.QA_API ?? 'http://127.0.0.1:8799';
const checks = [];
const ok = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const api = (path) => fetch(`${API}${path}`).then((r) => r.json());

const browser = await launch();
const { page, errors } = await freshPage(browser, contextOptions('iPhone 15'));
const tap = async (loc) => {
  await loc.first().waitFor({ state: 'visible', timeout: 5000 });
  await loc.first().tap();
};
const topName = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('[aria-label$="View profile"]')].find((el) => !el.closest('[inert]'));
    return b ? b.getAttribute('aria-label').split(',')[0] : null;
  });

// The app may open on the chat list (tap through to Explore) or straight on the deck.
await tap(page.locator('button[aria-label="Explore new people"]')).catch(() => {});
await page.locator('[aria-label$="View profile"]').first().waitFor({ state: 'visible', timeout: 8000 });
await sleep(1500);
const uid = await page.evaluate(() => localStorage.getItem('reverie:uid'));
ok('the app has an anonymous telemetry id', Boolean(uid), uid);

const before = await api(`/admin/users/${uid}`);
const feedIds = (before.lastFeed ?? []).map((r) => r.persona_id);
ok('the backend served this user a ranked deck', feedIds.length >= 5, feedIds.join(', '));

// Swipe right on the top card.
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
// The match arrives as a notice banner with a Chat button.
const notice = page.getByText('It\u2019s a match').first();
await notice.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
ok('the first like matches', await notice.isVisible());
await sleep(400);
await tap(page.getByRole('button', { name: /^Chat/ }));
await sleep(1500);
const input = page.locator('[data-slot="composer"] input');
await input.tap();
await input.fill('Hi! Tell me about your world?');
await tap(page.getByRole('button', { name: 'Send' }));
await sleep(4500);
const herCount = await page.locator('[data-slot="message-list"] ol > li').count();
ok('a reply lands in the chat', herCount >= 3, `${herCount} messages`);
await page.screenshot({ path: join(SHOTS, 'backend-chat.png') });

// Leave the chat and let the telemetry flush.
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await sleep(1500);
const after = await api(`/admin/users/${uid}`);
const counts = Object.fromEntries(after.events.map((e) => [e.type, e.n]));
ok('server got session, impression, swipe and match', counts.session_start >= 1 && counts.impression >= 1 && counts.swipe >= 1 && counts.match >= 1, JSON.stringify(counts));
ok('server got the chat and both sides of the conversation', counts.chat_open >= 1 && counts.message >= 3, `messages ${counts.message}`);
// A card seen before the feed answered is honestly 'unranked'; every card the feed served carries its slot and propensity.
const served = after.impressions.filter((i) => i.slot !== 'unranked');
ok(
  'impressions from the feed carry their slot and propensity',
  served.length >= 1 && served.every((i) => i.p_shown > 0 && i.p_shown <= 1),
  `${served.length}/${after.impressions.length} feed-served: ${JSON.stringify(served[0])}`,
);
// The card on screen before the feed answered stays on top; every card after it follows the feed's order.
const shownIds = after.impressions.map((i) => i.persona_id);
const firstShown = shownIds[0];
const expectedNext = feedIds.filter((id) => id !== firstShown)[0];
ok('after the first card, the deck follows the feed', shownIds[1] === expectedNext, `shown ${shownIds.join(' -> ')}, feed ${feedIds.slice(0, 4).join(', ')}`);
const conv = after.conversations[0];
ok('the conversation is tracked with user turns', conv && conv.user_turns >= 1, conv ? `${conv.persona_id} ${conv.user_turns} turns` : 'none');
ok('the like raised the user affinity for that persona category', after.affinity.length > 0 && after.affinity[0].a > 0, JSON.stringify(after.affinity.slice(0, 3)));
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
