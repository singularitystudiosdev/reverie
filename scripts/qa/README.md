# QA scripts

Playwright drives for the device matrix, the real flows, the living atmosphere,
reduced motion and frame time. Playwright is not a project dependency: point
`PLAYWRIGHT_MODULE` at an installed copy (`.../node_modules/playwright/index.mjs`),
with Chromium's headless shell installed (`npx playwright install chromium-headless-shell`).

```sh
npm run build
node scripts/qa/serve.mjs 44640 dist &           # serves dist/ fresh on every request
export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs
node scripts/qa/matrix.mjs final                 # iPhone 15, Pixel 7, iPad Mini (+ landscape), 1440x900, 320px, 200% zoom
node scripts/qa/flows.mjs                        # like -> match -> Say hi -> send -> typing -> reply; drawer; chips; Start over; reload; keys
node scripts/qa/reduced.mjs                      # prefers-reduced-motion: still particles, no slides, swipe still works
node scripts/qa/atmo.mjs final-atmo              # frame bursts: idle, gust, bloom, next world under the finger
node scripts/qa/perf.mjs 4 http://127.0.0.1:44640/ '' --trace   # 4x CPU throttle, rAF intervals + compositor frames
```

Screenshots and JSON land in `.tmp/reverie-shots/` (`QA_SHOTS` overrides it; `QA_URL`
overrides the served address). For the engine's own per-frame cost, quality tier
and particle count, serve a development build (`NODE_ENV=development npx vite build
--mode development --outDir .tmp/dist-dev`, which exposes `window.__atmo`) and pass
its URL to `perf.mjs`.

The browser runs single-process (`--single-process --no-sandbox --disable-gpu`)
so it starts inside an OS sandbox; each device gets its own browser because a
single-process Chromium exits when its context closes.
