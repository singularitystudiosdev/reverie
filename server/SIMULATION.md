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

## Gender, age and art style (2026-11-12, later)

A real session swiped right only on women it found attractive and was dealt a
64-year-old man. The feed had learned gender as one of a persona's 5 to 7
tags, each swipe split across them, so after 9 likes the user's "female" tag
stood at 1.01 for against 1.24 against. The ranker now keeps each user's like
rate per gender, age band and art style, counting every swipe in full, and
multiplies P(like) by it (posterior mean; a Thompson draw on three axes was
tried first and lost to the old ranker, because the noise scrambled decks).

Replaying that user's 53 real events, 400 decks of 6:

| | old ranker | new ranker |
|---|---|---|
| the 64-year-old man in the deck | 3.3% of decks | 0.0% |
| men | 21.1% of cards | 11.5% (the user did like one man) |
| mature or senior | 7.7% of cards | 3.5% |

The simulated users now have these preferences too (78% prefer women, 12% men,
10% either; 65% prefer under-40s; 45% anime, 30% realistic, 25% either), so
like rates drop for everyone and these rows are not comparable with the table
above. Same world, 25 days, all 154 personas, app events:

| Seed | feed like rate, old -> new ranker | deep chats per user, old -> new |
|---|---|---|
| 7 | 18.6% -> 19.1% | 0.33 -> 0.39 |
| 11 | 18.8% -> 19.1% | 0.41 -> 0.38 |

A small aggregate gain (about 2 standard errors on seed 7), as expected: most
users prefer women and three quarters of the roster are women, so the trait
model matters most for the minority the old feed served worst. In this world
the static deck (the 14 launch women first) is a strong baseline on deep chats.

## Feed audit: tempered draws, X's DPP, full-weight taste, a roster prior (2026-11-12, later)

A new static-world bench (`npm run bench:feed`, `src/sim/feedbench.ts`) runs the
ranker alone against the simulator's hidden user model: 1,000 warm-up users swipe
two decks of 6 under the feed's own policy, then 300 fresh users swipe 5 decks of
6, and every card served is scored by its TRUE like probability (no coin flips in
the metric, SE about 0.0016). Two yardsticks: each user's oracle, and one static
deck in the order of the population's true mean like rate. `--latent 1` adds a
"look" taste no tag carries.

The old ranker lost to that static popularity deck: 0.187 against 0.220 mean true
like probability per card, 0.179 against 0.273 on a new user's first deck. Four
causes, each measured:

- **Thompson noise.** Every Beta draw was a full draw, including P(deep chat)
  from a Beta(1, 4) prior (sd 0.16) at weight 1 / (mean deep rate), about 5, and
  one draw per tag of every candidate. Draws are now pulled toward their means by
  `feed.tsScale` = 0.3 (0 is the mean, 1 plain Thompson sampling).
- **Diluted taste.** A swipe added 1/#tags to each of a persona's 6 to 8 tags.
  It now counts in full on every tag.
- **The DPP.** It ran over the whole roster at theta 0.5 on tags that included
  gender, age and style, in pick order. It now runs as X's vm-ranker does: the top
  3 x k by score, theta 0.65, the kept cards in score order, themes only.
- **Flat persona prior.** Every persona's like rate started at Beta(1, 2), and any
  persona under 100 impressions (most of the roster at launch) at the pessimistic
  new-persona prior. It now starts where a ridge regression on persona features
  puts it (strength by the method of moments); the pessimistic prior is kept for
  personas the loop spawns.

Also: the undersampled explore slot takes the user's best among the least-shown
quarter (it was one global argmin every user got until the next model rebuild),
long-ago passes come back when the unseen roster runs out, and the app re-ranks
every 3 swipes after sending its queued events (it used to rank without the last
3 s of swipes, and only when the page ran out).

Feed bench, mean true like probability per card (first deck in brackets):

| | seed 7 | seed 11 | latent look, seed 7 | launch scale (150 warm-up users), seed 7 / 11 |
|---|---|---|---|---|
| old ranker | 0.187 (0.179) | 0.184 (0.176) | 0.203 (0.187) | 0.185 (0.177) / - |
| new ranker | **0.205** (0.219) | **0.206** (0.214) | **0.230** (0.240) | **0.213** (0.229) / **0.206** (0.210) |
| in-place fixes without the roster prior | 0.205 (0.218) | - | 0.231 (0.245) | 0.207 (0.219) / 0.196 (0.201) |
| static popularity deck (true means) | 0.220 (0.273) | 0.224 (0.260) | 0.245 | 0.233 / 0.225 |
| oracle | 0.295 | 0.301 | 0.404 | 0.304 / 0.304 |

The roster prior adds nothing measurable after the 1,000-user warm-up and 0.6 to
1.0 points at launch scale (about 12 impressions per persona), which is where the
app is. The new ranker also shows
fewer cards outside the user's preferred gender (16.4% against 18.7% at seed 7,
13.6% against 16.2% at seed 11).

Closed loop, 25 days, 220 users a day, all 154 personas, app events (`--no-premium`):

| Seed | feed like rate, old -> new | feed vs static deck, old -> new | deep chats per user, old -> new |
|---|---|---|---|
| 7 | 19.1% -> **21.5%** | +2.2 -> +4.5 points | 0.39 -> 0.38 |
| 11 | 19.1% -> **21.0%** | +1.9 -> +3.1 points | 0.38 -> 0.42 |

Fading in these short runs is noisy either way: the old ranker faded `sylvara` (a
strong persona) at seed 7 and `isolde` at 11, the new one `nerissa` at 7 and
`mirelle` and `isolde` at 11; neither faded `raven` within 25 days.

A known cost: a feed that personalises harder shows each persona more to its
fans, so the raw like rate overstates it more (mean bias 2.7 points against 1.3 to
1.7) and the IPW rate, clipped at 20, removes only part of it (1.6 against 0.5 to
1.1 points). The fade decisions read the IPW rate; a doubly robust estimator would
close the gap.

Tried and dropped (bench, seed 7): plain Thompson sampling on one coherent
taste draw per deck (0.166 to 0.180: whole decks flip with the draw); a
hierarchical Bayesian logistic Thompson ranker (per-user taste weights over
persona features, Laplace posterior, EASE item-item collaborative term,
empirical-Bayes prior) at 0.198 (tsScale 0.3) and 0.204 (posterior mode), behind
the in-place fixes in both worlds (latent look: 0.220 against 0.231). Its prior's
variances, estimated by EM from Laplace posteriors, collapsed to the floor (the
penalized-quasi-likelihood bias on binary data); tuning them on held-out swipes
fixed that but not the gap.

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
