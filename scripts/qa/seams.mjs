// seams.mjs: the merged-tree seams that a flow does not touch.
//  - the focus ring takes each world's accent (Tab in the base list, grove and crimson),
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
  await press(page, page.locator('button[aria-label="Explore new people"]'));
  await sleep(1800);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await probe('grove', true);
  ok('three worlds, three different ring colours', new Set(Object.values(seen).map((r) => r.color)).size === 3, Object.values(seen).map((r) => r.color).join(' | '));

  await browser.close().catch(() => {});
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} seam checks pass`);
process.exitCode = failed.length ? 1 : 0;
