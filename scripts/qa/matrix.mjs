// matrix.mjs: the device matrix. For each device, a fresh page from the seed,
// then: Chats, a chat (Vesper), the drawer, the profile sheet, Explore
// (Sylvara on top), mid-drag, and the match overlay. Every state gets a
// screenshot and the floors: horizontal overflow, touch targets >= 44px on a
// coarse pointer, input font >= 16px, no text under 12px, the 9:16 frame on
// desktop, and the safe-area insets on phones.
//
// Usage: PLAYWRIGHT_MODULE=... node scripts/qa/matrix.mjs [prefix=qa] [device-key...]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MATRIX, SHOTS, contextOptions, dragBy, freshPage, launch, press, sleep } from './pw.mjs';

const prefix = process.argv[2] ?? 'qa';
const only = process.argv.slice(3);

// A 320px-wide phone for the reflow floor (WCAG 1.4.10).
const EXTRA = [
  ['w320', { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  // The 1440x900 desktop at 200% browser zoom: 720x450 CSS px at 2 device px each.
  ['desktop-zoom200', { viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 }],
];

// iPhone 15 safe areas (portrait / landscape), applied through CDP where supported.
const INSETS = {
  iphone15: { top: 59, bottom: 34, left: 0, right: 0 },
  'iphone15-land': { top: 0, bottom: 21, left: 59, right: 59 },
  pixel7: { top: 24, bottom: 16, left: 0, right: 0 },
  'pixel7-land': { top: 0, bottom: 16, left: 24, right: 0 },
};

/** Floors measured in the page. */
async function measure(page) {
  return page.evaluate(() => {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const vw = document.documentElement.clientWidth;
    const out = { coarse, vw, overflow: [], smallTargets: [], smallInputs: [], smallText: [], frame: null };

    // Overflow: the document, and any element whose box leaves the viewport
    // horizontally without living inside a horizontal scroller.
    const se = document.scrollingElement;
    if (se.scrollWidth > se.clientWidth) out.overflow.push(`document ${se.scrollWidth}>${se.clientWidth}`);
    const inScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) return true;
        if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') {
          const r = p.getBoundingClientRect();
          if (r.right <= vw + 0.5 && r.left >= -0.5) return true;
        }
      }
      return false;
    };

    const hidden = (el) => {
      if (el.closest('[inert],[aria-hidden="true"]')) return true;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return true;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return true;
      // Faded-out layers (opacity 0 ancestors) are not on screen.
      for (let p = el; p; p = p.parentElement) if (getComputedStyle(p).opacity === '0') return true;
      return false;
    };
    const srOnly = (el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'absolute' && el.getBoundingClientRect().width <= 1;
    };
    const label = (el) =>
      (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);

    for (const el of document.querySelectorAll('body *')) {
      if (hidden(el)) continue;
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) {
        out.overflow.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${Math.round(r.left)},${Math.round(r.right)}]`);
      }
    }

    const controls = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]');
    for (const el of controls) {
      if (hidden(el) || el.disabled) continue;
      const r = el.getBoundingClientRect();
      const min = coarse ? 44 : 24;
      if (r.width + 0.5 < min || r.height + 0.5 < min) out.smallTargets.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (el.matches('input, select, textarea')) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) out.smallInputs.push(`${label(el)} ${fs}px`);
      }
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent.trim()) continue;
      seen.add(el);
      if (hidden(el) || srOnly(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) out.smallText.push(`"${n.textContent.trim().slice(0, 30)}" ${fs}px`);
    }

    const dev = document.querySelector('[data-slot="device"]');
    if (dev) {
      const r = dev.getBoundingClientRect();
      out.frame = { w: Math.round(r.width), h: Math.round(r.height), ratio: +(r.width / r.height).toFixed(4), radius: getComputedStyle(dev).borderTopLeftRadius };
    }
    // Safe areas: where the top/bottom chrome actually sits.
    const q = (s) => document.querySelector(s)?.getBoundingClientRect();
    const tab = q('[data-slot="tab-bar"] ul');
    const head = q('[data-slot="chat-header"] button') ?? q('h1');
    out.chrome = {
      tabBottomGap: tab ? Math.round((dev?.getBoundingClientRect().bottom ?? innerHeight) - tab.bottom) : null,
      headTop: head ? Math.round(head.top - (dev?.getBoundingClientRect().top ?? 0)) : null,
      safeTop: getComputedStyle(document.documentElement).getPropertyValue('--statusbar-h').trim(),
    };
    return out;
  });
}

async function shot(page, key, screen, results) {
  const file = join(SHOTS, `${prefix}-${key}-${screen}.png`);
  await page.screenshot({ path: file });
  const m = await measure(page);
  results.push({ device: key, screen, file, ...m });
  const flags = [
    m.overflow.length && `overflow ${m.overflow.length}`,
    m.smallTargets.length && `targets ${m.smallTargets.join('; ')}`,
    m.smallInputs.length && `inputs ${m.smallInputs.join('; ')}`,
    m.smallText.length && `text ${m.smallText.join('; ')}`,
  ].filter(Boolean);
  console.log(`${key.padEnd(14)} ${screen.padEnd(10)} ${flags.length ? 'FLAG ' + flags.join(' | ') : 'ok'}${m.overflow.length ? '\n    ' + m.overflow.slice(0, 6).join('\n    ') : ''}`);
}

async function runDevice(browser, key, opts) {
  const results = [];
  const { context, page, errors } = await freshPage(browser, opts);
  if (INSETS[key]) {
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: INSETS[key] });
      await page.reload({ waitUntil: 'networkidle' });
      await sleep(600);
    } catch (e) {
      console.log(`${key}: safe-area override unavailable (${String(e).split('\n')[0]})`);
    }
  }
  await sleep(900);
  await shot(page, key, 'chats', results);

  // A chat: Vesper.
  await press(page, page.locator('[data-slot="chat-row"]', { hasText: 'Vesper' }));
  await sleep(1200);
  await shot(page, key, 'vesper', results);

  // The drawer, then close it with its button.
  await press(page, page.locator('[data-slot="chat-header"] button[aria-label="Chats"]'));
  await sleep(600);
  await shot(page, key, 'drawer', results);
  await press(page, page.locator('button[aria-label="Close chats"]'));
  await sleep(500);

  // The profile sheet from the header's Profile pill.
  await press(page, page.locator('[data-slot="chat-header"] button', { hasText: 'Profile' }));
  await sleep(700);
  await shot(page, key, 'profile', results);
  await press(page, page.locator('button[aria-label="Close profile"]'));
  await sleep(500);

  // Explore: Sylvara on top.
  await press(page, page.locator('[data-slot="tab"]', { hasText: 'Explore' }));
  await sleep(1400);
  await shot(page, key, 'explore', results);

  // Mid-drag, below the commit threshold, then let it spring back.
  const card = page.locator('[aria-label$="View profile"]:not([inert] *)').first();
  const box = await card.boundingBox();
  const release = await dragBy(page, card, box.width * 0.26, { hold: true, steps: 14 });
  await sleep(450);
  await shot(page, key, 'middrag', results);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await release();
  await sleep(700);

  // Like -> the match moment.
  await press(page, page.locator('button[aria-label^="Like "]'));
  await sleep(1300);
  await shot(page, key, 'match', results);

  return { results, errors };
}

const all = [];
const devicesToRun = [...MATRIX.map(([k, n]) => [k, contextOptions(n)]), ...EXTRA].filter(([k]) => !only.length || only.includes(k));
for (const [key, opts] of devicesToRun) {
  // One browser per device: a single-process Chromium exits when its context closes.
  const browser = await launch();
  try {
    const { results, errors } = await runDevice(browser, key, opts);
    all.push(...results);
    if (errors.length) console.log(`${key}: page errors:\n  ${errors.join('\n  ')}`);
    const r0 = results[0];
    console.log(`${key}: coarse=${r0.coarse} vw=${r0.vw} frame=${JSON.stringify(r0.frame)} chrome=${JSON.stringify(results.map((r) => r.chrome))}`);
  } catch (e) {
    console.log(`${key}: FAILED ${String(e.stack).split('\n').slice(0, 8).join('\n')}`);
  }
  await browser.close().catch(() => {});
}
writeFileSync(join(SHOTS, `${prefix}-matrix.json`), JSON.stringify(all, null, 2));
console.log(`wrote ${all.length} states`);
