# Simulation results

Closed-loop runs of the whole server against synthetic users with hidden tastes
(offline LLM: edits come from the heuristic proposer and the edit library, new
personas from the template writer). 220 new users a day for 45 days (9,900
users), 10% of them on a static deck as a holdout. Run 2026-11-12, commit
`1c46063`.

The hidden world the loop is NOT told about: two launch personas are duds
(`isolde`, `raven`); 18% of users want categories the launch roster lacks
(animal characters, mature, curvy, dance); replies that end without a
question, run long, or repeat make users drop. Starters and spawned personas
get a hidden quality from how their categories meet that demand, drawn once
per persona.

## Results

| Run | Command (in `server/`) | (a) promoted edits that truly help | (b) faded and retired | (c) gate | (d) feed vs static: likes / deep chats per user | (e) like-rate error vs truth: naive / IPW / random-slot |
|---|---|---|---|---|---|---|
| 14 launch personas, every event | `node src/sim/simulate.ts --days 45 --users-per-day 220 --seed 7 --launch-only` | 8 of 8; 33 opened, 2 discarded, 23 running | `isolde`, `raven` and a weak spawned persona (`sable`) | opened day 15; 12 personas spawned over 4 generations; 0 while closed | 29.9% vs 28.7% / 0.64 vs 0.64 | 0.5 / 0.8 / 1.9 pp (bias -0.1 / -0.1 / 0.1) |
| all 154 personas, app events (report and block, no premium yet) | `... --seed 7 --no-premium` | 3 of 3; 59 opened, 56 running | `isolde` retired; nothing else faded | 32 of 153 at their sample; not open | 29.9% vs 27.4% / 0.47 vs 0.43 | 1.5 / 1.8 / 4.2 pp (bias 0.0 / 0.1 / 0.4) |
| all 154, app events before the report button | `... --seed 7 --no-premium --no-reports` | 1 of 1; 59 opened, 58 running | `isolde` retired, `raven` fading | 28 of 152; not open | 29.8% vs 26.8% / 0.48 vs 0.39 | 1.7 / 2.1 / 4.6 pp (bias -0.3 / -0.4 / -1.0) |

What the numbers say:

- **Fading works on the events the app actually sends.** Before the fix, with
  no premium and no report events, nothing faded at all: a signal nobody sends
  got weight 1/0.001 and swamped every interval. And the fade rule only
  considered personas that had reached the gate's chat count, which a persona
  nobody likes never does, so the duds could not fade while a fairly liked
  persona (`bruno`, 37% IPW like rate) was retired on 11 random-slot
  impressions. Now the worst dud fades in every run; at 154 personas the
  second is still on its way at day 45 in one of two runs.
- **A/B tests promote only real wins, and slowly.** Every promoted edit truly
  helps in every run. Each test runs at an online-FDR level (LORD++), which
  starts small (1.1% for the first test, then lower while no wins are in), so
  promotions come later than at a flat 5%: 8 at 14 personas against 13 in the
  earlier, uncontrolled run. At 154 personas the same traffic is spread over
  ten times as many personas, so after 45 days most tests are still running.
- **The feed beats a static deck** on likes in every run (by 1.2 to 3.0
  points), and on deep chats per user at 154 personas (0.47 vs 0.43, 0.48 vs
  0.39); at 14 personas they tie.
- **IPW is unbiased but, here, noisier than the raw rate.** Since the
  propensity fix (each card's propensity is now the share of 32 replays of the
  whole policy that show it; before, it came from the score's top-k alone and
  ignored the DPP and the explore slots), the IPW like rate's mean bias is
  within half a point of the truth in every run. In this simulation the feed's
  selection bias on like rate is small, so the unweighted rate is as close and
  steadier; IPW is kept because it stays unbiased when the feed leans harder.
- **The gate at the full roster.** Even at these relaxed thresholds (about
  315 impressions and 185 chats per persona), only a fifth of the 154
  personas had their sample after 45 days and about 29,000 chats, because
  chats concentrate on the liked personas. At the shipped thresholds (about
  1,190 impressions and 580 chats each), a run with 1,000 new users a day had
  17 of 154 there after 14 days and 37,498 chats (that run was cut off at day
  14). The floor is about 154 x 580 = 89,000 chats if chats were spread
  evenly; in practice the first automatic persona waits for the least-liked
  personas to reach their sample or fade out. The 3x-median escape hatch
  rarely helps at this size: while personas keep reaching the gate one by
  one, the median keeps rising with them.

## Settings

The 45-day runs use relaxed thresholds so a run finishes in minutes (gate: a
10-point difference, at least 300 impressions and 120 chats per persona; tests:
120 to 900 per arm; fade after 2 ticks). `--shipped` uses the server's own
defaults. Every run turns off the art requirement (no image generator in a
simulation) and the served-replies rule for tests (the simulator plays every
reply from the persona text, variant included, so its tests are real).

## Fixes these simulations forced

- the persona registry stamped `first_seen_at` with the wall clock, so on any
  other clock every new persona looked overdue and the gate spawned every tick;
- 7-day premium conversion counted early converters before the window closed;
- guardrails used a fixed non-inferiority bound that never clears for rare
  events, which blocked every winning edit;
- the fade bar was the median, which eventually fades half of any roster;
- the feed weighted a deep chat at a fixed 1.5 against a like, so it chased
  likes; the weight is now 1 / (mean deep-chat rate);
- a score signal with no events (premium, reports) swamped every interval;
- fading waited for the gate's chat count and compared against the popular
  personas only;
- logged propensities ignored the DPP rerank and the explore slots;
- the simulator re-drew a persona's hidden traits per experiment arm, which
  made some arms differ for reasons other than the edit.
