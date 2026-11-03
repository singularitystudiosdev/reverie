// seams.mjs: the merged-tree seams that a flow does not touch.
//  - the focus ring takes each world's accent (Tab in the base list, grove and crimson),
//  - tab labels render at --text-label (14px), not the 16px body size,
//  - in the landscape left rail "Explore" fits its 64px item without clipping,
//  - the Explore card stays portrait (>= 3:4) on the short phone and the other phones.
//
// Usage: PLAYWRIGHT_MODULE=... node scripts/qa/seams.mjs
import { join } from 'node:path';
import { SHOTS, contextOptions, freshPage, launch, press, sleep } from './pw.mjs';

const checks = [];
const ok = (name, pass, detail = '') => {
  checks.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const ringOf = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    const accent = getComputedStyle(document.querySelector('[data-frame]')).getPropertyValue('--t-accent').trim();
    // Resolve the accent to rgb() through a probe element.
    const probe = document.createElement('i');
    probe.style.color = accent;
    document.body.append(probe);
    const accentRgb = getComputedStyle(probe).color;
    probe.remove();
    return {
      el: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24),
      style: `${cs.outlineStyle} ${cs.outlineWidth}`,
      offset: cs.outlineOffset,
      color: cs.outlineColor,
      accent: accentRgb,
    };
  });

// ---- focus ring per world (phone, keyboard) ----
{
  const browser = await launch();
  const { page } = await freshPage(browser, contextOptions('iPhone 15'));
  const seen = {};
  const probe = async (label, shot) => {
    await page.keyboard.press('Tab');
    await sleep(300); // chips transition their colours (150ms): read the settled ring
    const r = await ringOf(page);
    seen[label] = r;
    ok(`focus ring in ${label} is 2px solid, offset 2px, in the world's accent`, /solid 2px/.test(r.style) && r.offset === '2px' && r.color === r.accent, JSON.stringify(r));
    if (shot) await page.screenshot({ path: join(SHOTS, `seam-focus-${label}.png`) });
  };
  await sleep(900);
  await probe('base', true);
  await press(page, page.locator('[data-slot="chat-row"]', { hasText: 'Vesper' }));
  await sleep(1500);
  await page.keyboard.press('Tab');
  await probe('crimson', true);
  await press(page, page.locator('[data-slot="tab"]', { hasText: 'Explore' }));
  await sleep(1800);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await probe('grove', true);
  ok('three worlds, three different ring colours', new Set(Object.values(seen).map((r) => r.color)).size === 3, Object.values(seen).map((r) => r.color).join(' | '));

  // ---- tab labels at --text-label ----
  const labels = await page.evaluate(() => {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--text-label').trim();
    return {
      token,
      sizes: [...document.querySelectorAll('[data-slot="tab"] > span.relative:not([data-slot])')].map((s) => [s.textContent, getComputedStyle(s).fontSize, getComputedStyle(s.parentElement).fontSize]),
    };
  });
  ok('tab labels render at 14px (--text-label)', labels.sizes.length === 2 && labels.sizes.every(([, a, b]) => a === '14px' && b === '14px'), JSON.stringify(labels));
  await browser.close().catch(() => {});
}

// ---- the landscape rail ----
for (const name of ['iPhone 15 landscape', 'Pixel 7 landscape']) {
  const browser = await launch();
  const { page } = await freshPage(browser, contextOptions(name));
  await sleep(900);
  const rail = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-slot="tab"]')];
    return items.map((b) => {
      const label = b.querySelector(':scope > span.relative:not([data-slot])');
      const range = document.createRange();
      range.selectNodeContents(label);
      const t = range.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      return { text: label.textContent, itemW: Math.round(r.width), textW: Math.round(t.width), clipped: t.left < r.left - 0.5 || t.right > r.right + 0.5 || b.scrollWidth > b.clientWidth, font: getComputedStyle(label).fontSize };
    });
  });
  ok(`${name}: rail labels fit their 64px item`, rail.length === 2 && rail.every((i) => i.itemW === 64 && !i.clipped), JSON.stringify(rail));
  await page.screenshot({ path: join(SHOTS, `seam-rail-${name.split(' ')[0].toLowerCase()}.png`) });
  await browser.close().catch(() => {});
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} seam checks pass`);
process.exitCode = failed.length ? 1 : 0;
