// perf.mjs: frame time with the atmosphere running, iPhone 15 emulation,
// CDP CPU throttle (default 4x). Two scenes: Explore (Sylvara on top) and a
// chat (Nova). Reports the page's frame intervals (a rAF probe: what a person
// sees) and, on a dev build (window.__atmo), the engine's own per-frame cost,
// its quality tier and particle count.
//
// Usage: PLAYWRIGHT_MODULE=... node scripts/qa/perf.mjs [rate=4] [url] [query]
//   e.g. node scripts/qa/perf.mjs 4 http://127.0.0.1:44641/ '?tier=0'
import { contextOptions, launch, sleep, BASE } from './pw.mjs';

const rate = Number(process.argv[2] ?? 4);
const url = process.argv[3] ?? BASE;
const query = process.argv[4] ?? '';
const WARM_MS = 3500;
// --trace: also record a Chrome trace over the window and read each frame's
// PipelineReporter (begin-frame to presentation, raster included) and
// whether it was presented or dropped: the compositor's view, not just rAF.
const TRACE = process.argv.includes('--trace');

async function readTrace(cdp) {
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  const { stream } = await done;
  let text = '';
  for (;;) {
    const { data, eof, base64Encoded } = await cdp.send('IO.read', { handle: stream, size: 1 << 20 });
    text += base64Encoded ? Buffer.from(data, 'base64').toString() : data;
    if (eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  const parsed = JSON.parse(text);
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const open = new Map();
  const frames = [];
  for (const e of events) {
    if (e.name !== 'PipelineReporter') continue;
    const key = `${e.id ?? e.id2?.local}`;
    if (e.ph === 'b') open.set(key, e);
    else if (e.ph === 'e' && open.has(key)) {
      const b = open.get(key);
      open.delete(key);
      const fr = b.args?.frame_reporter ?? e.args?.frame_reporter ?? {};
      const state = fr.state ?? "unknown";
      if (fr.has_high_latency && fr.frame_sequence === 1) continue;
      frames.push({ ms: (e.ts - b.ts) / 1000, state });
    }
  }
  return frames;
}
const MEASURE_MS = 6000;

const stats = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { n: xs.length, avg: +avg.toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), over20: +((xs.filter((x) => x > 20).length / xs.length) * 100).toFixed(1) };
};

// A fixed JS workload, timed in the page: proves the CPU throttle is on.
const calibrate = (page) =>
  page.evaluate(() => {
    const t = performance.now();
    let x = 0;
    for (let i = 0; i < 3e6; i++) x += Math.sqrt(i) * Math.sin(i);
    return +(performance.now() - t + (x > Infinity ? 1 : 0)).toFixed(1);
  });

async function scene(name, go, during) {
  const browser = await launch();
  const context = await browser.newContext(contextOptions('iPhone 15'));
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('qa:init')) {
      localStorage.clear();
      sessionStorage.setItem('qa:init', '1');
    }
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(url + query, { waitUntil: 'networkidle' });
  await sleep(800);
  await go(page);
  const calm = await calibrate(page);
  if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const throttled = await calibrate(page);
  await sleep(WARM_MS);
  if (TRACE) {
    await cdp.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      traceConfig: { includedCategories: ['benchmark', 'cc', 'viz', 'disabled-by-default-devtools.timeline.frame'] },
    });
  }
  const probe = page.evaluate(async (ms) => {
    const atmo = window.__atmo;
    const e0 = atmo ? atmo.engineMs.length : 0;
    const intervals = [];
    await new Promise((resolve) => {
      let last = performance.now();
      const end = last + ms;
      const step = (t) => {
        intervals.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return {
      intervals: intervals.slice(1),
      engineMs: atmo ? atmo.engineMs.slice(e0) : null,
      tier: atmo ? atmo.tier : null,
      particles: atmo ? atmo.particles : null,
      dpr: devicePixelRatio,
    };
  }, MEASURE_MS);
  if (during) await during(page);
  const result = await probe;
  const pipeline = TRACE ? await readTrace(cdp) : null;
  await browser.close().catch(() => {});
  const frame = stats(result.intervals);
  const engine = result.engineMs ? stats(result.engineMs) : null;
  console.log(
    `${name.padEnd(16)} throttle ${rate}x (calib ${calm}->${throttled}ms)  frame avg ${frame.avg}ms p50 ${frame.p50} p95 ${frame.p95} p99 ${frame.p99} (>20ms: ${frame.over20}%, n=${frame.n})` +
      (engine ? `  | engine avg ${engine.avg}ms p95 ${engine.p95}  tier T${result.tier}  particles ${result.particles}` : '')
  );
  if (pipeline) {
    const by = {};
    for (const f of pipeline) by[f.state] = (by[f.state] ?? 0) + 1;
    const presented = pipeline.filter((f) => /PRESENTED/.test(f.state)).map((f) => f.ms);
    console.log(`${''.padEnd(16)} pipeline: ${JSON.stringify(by)}  presented ${JSON.stringify(stats(presented))}`);
  }
  return { name, rate, frame, engine, tier: result.tier, particles: result.particles };
}

const out = [];
// Baseline: the Chats list on the near-still base world, for the pipeline
// latency the browser adds on its own.
out.push(await scene('chats-base', async () => {}));
out.push(
  await scene('explore', async (page) => {
    await page.locator('[data-slot="tab"]', { hasText: 'Explore' }).tap();
    await sleep(1500);
  })
);
out.push(
  await scene('chat-nova', async (page) => {
    await page.locator('[data-slot="chat-row"]', { hasText: 'Nova' }).tap();
    await sleep(1500);
  })
);

// Interaction: the heaviest paths. Explore while the card is dragged back and
// forth (two worlds, preview crossfade, motion values every pointermove);
// Nova's chat while sending (gust, typing, her reply's bloom, React renders).
const dragLoop = async (page) => {
  const card = page.locator('[aria-label$="View profile"]:not([inert] *)').first();
  const box = await card.boundingBox();
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < MEASURE_MS - 300) {
    const phase = Math.sin(i / 20);
    await page.mouse.move(x0 + phase * box.width * 0.27, y0);
    i++;
  }
  await page.mouse.move(x0, y0, { steps: 4 });
  await page.mouse.up();
};
out.push(
  await scene(
    'explore-drag',
    async (page) => {
      await page.locator('[data-slot="tab"]', { hasText: 'Explore' }).tap();
      await sleep(1500);
    },
    dragLoop
  )
);
out.push(
  await scene(
    'chat-nova-send',
    async (page) => {
      await page.locator('[data-slot="chat-row"]', { hasText: 'Nova' }).tap();
      await sleep(1500);
    },
    async (page) => {
      for (const text of ['Hey you', 'What are you hacking tonight?']) {
        const input = page.locator('[data-slot="composer"] input');
        await input.fill(text);
        await page.keyboard.press('Enter');
        await sleep(2600);
      }
    }
  )
);
console.log(JSON.stringify(out));
