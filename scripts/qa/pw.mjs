// pw.mjs: shared Playwright plumbing for the QA scripts.
//
// Playwright is not a project dependency. Point PLAYWRIGHT_MODULE at an
// installed copy (e.g. an npx cache: .../node_modules/playwright/index.mjs),
// or install it next to the project. The browser runs as Playwright's
// chrome-headless-shell in ONE process (`--single-process --no-sandbox
// --disable-gpu`): inside an OS sandbox a multi-process Chromium cannot start
// its GPU and helper processes.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const mod = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
export const { chromium, devices } = mod.default ?? mod;

export const BASE = process.env.QA_URL ?? 'http://127.0.0.1:44640/';
export const SHOTS = resolve(process.env.QA_SHOTS ?? '.tmp/reverie-shots');
mkdirSync(SHOTS, { recursive: true });

export async function launch() {
  return chromium.launch({
    args: ['--no-sandbox', '--single-process', '--disable-gpu', '--disable-dev-shm-usage', '--mute-audio'],
  });
}

/** The device matrix: the three named devices, each with its landscape twin, plus a desktop. */
export const MATRIX = [
  ['iphone15', 'iPhone 15'],
  ['iphone15-land', 'iPhone 15 landscape'],
  ['pixel7', 'Pixel 7'],
  ['pixel7-land', 'Pixel 7 landscape'],
  ['ipadmini', 'iPad Mini'],
  ['ipadmini-land', 'iPad Mini landscape'],
  ['desktop', null],
];

export function contextOptions(name, extra = {}) {
  if (!name) {
    return { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...extra };
  }
  const d = devices[name];
  if (!d) throw new Error(`unknown device ${name}`);
  return { ...d, ...extra };
}

/** A fresh page with an empty store, so every run starts from the seed. */
export async function freshPage(browser, opts, { keepStorage = false } = {}) {
  const context = await browser.newContext(opts);
  if (!keepStorage) {
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('qa:init')) {
        localStorage.clear();
        sessionStorage.setItem('qa:init', '1');
      }
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return { context, page, errors };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tap (coarse pointer) or click (fine pointer). */
export async function press(page, locator) {
  const hasTouch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  if (hasTouch) await el.tap();
  else await el.click();
}

/** A pointer drag on an element, in steps, optionally stopping mid-way (returns a release fn). */
export async function dragBy(page, locator, dx, { steps = 12, hold = false, dy = 0 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('drag target has no box');
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    await sleep(16);
  }
  const release = async () => {
    await page.mouse.up();
  };
  if (!hold) await release();
  return release;
}
