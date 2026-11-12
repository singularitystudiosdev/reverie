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
fans, so the raw like rate overstates it more (mean bias 3.1 to 3.2 points with the
current ranker, against 1.3 to 1.7) and the IPW rate, clipped at 20, removes only
part of it (1.5 to 1.7 against 0.5 to 1.1 points). The fade decisions read the IPW rate; a doubly robust estimator would
close the gap.

### Second pass: the first deck

After those fixes a new user's first deck still scored 0.219 against 0.273 for the
true-popularity deck (seed 7). Toggling each piece at serve time on one trained
model (1,500 decks per setting, SE about 0.0004; Shapley shares, seed 7 / 11) split
that 0.055 / 0.049 gap into: tempered randomness 0.022 / 0.021, the explore slot
0.013 / 0.012, the DPP 0.009 / -0.007, and the persona estimates themselves
0.012 / 0.023. For a zero-swipe user the score is exactly the persona's like-rate
estimate, so that last part is the cost of learning from about 12,000 impressions
(it is gone at 3,000 warm-up users), not a ranking bug. Two changes:

- Only user-informed parameters are drawn: affinity on tags the user has swiped
  on and the persona's like rate. Unseen tags, P(deep chat) and P(report) take
  their means (drawn, they were prior noise: 0.024 of the gap).
- A first deck (zero swipes) keeps its uniformly random slots but gives its
  undersampled slots to exploit cards. Dropping both slots won more in the bench
  but left no persona with the 30 random-slot impressions the fade check needs.

| | bench seed 7 | bench seed 11 | latent look | closed loop like rate, seed 7 / 11 | deep chats per user, seed 7 / 11 |
|---|---|---|---|---|---|
| old ranker | 0.187 (first deck 0.179) | 0.184 (0.176) | 0.203 | 19.1% / 19.1% | 0.39 / 0.38 |
| first fixes | 0.205 (0.219) | 0.206 (0.214) | 0.230 | 21.5% / 21.0% | 0.38 / 0.42 |
| **+ first-deck changes (current)** | **0.211 (0.243)** | **0.212 (0.239)** | **0.234** | **23.1% / 23.0%** | **0.43 / 0.48** |
| same, both explore slots dropped on first decks | 0.215 (0.256) | 0.214 (0.251) | 0.231 | 22.9% / 23.0% | 0.41 / 0.43 |

With the random slots kept, 20 to 21 personas still reach 30 random-slot
impressions (bias 0.0 and -1.6 points); with both dropped, none did, and seed 11
then faded `sylvara`, one of the strongest personas.

Tried and dropped (bench, seed 7): plain Thompson sampling on one coherent
taste draw per deck (0.166 to 0.180: whole decks flip with the draw); a
hierarchical Bayesian logistic Thompson ranker (per-user taste weights over
persona features, Laplace posterior, EASE item-item collaborative term,
empirical-Bayes prior) at 0.198 (tsScale 0.3) and 0.204 (posterior mode), behind
the in-place fixes in both worlds (latent look: 0.220 against 0.231). Its prior's
variances, estimated by EM from Laplace posteriors, collapsed to the floor (the
penalized-quasi-likelihood bias on binary data); tuning them on held-out swipes
fixed that but not the gap.

## State-of-the-art audit: the app's paging hid every explore card; a persona-to-persona term (2026-11-12, later)

The feed bench swiped whole decks; the app does not. It asks for 10 cards, shows the first
3, re-ranks after 3 swipes and puts the new page first (`src/state/store.tsx`,
`REFRESH_AFTER`). The explore slots sat at page positions 4 and 9, so in the app they were
almost never on screen: the bench's new `--page 3` mode plays the app's paging, and with the
old ranker **0% of the cards seen were explore cards and no persona ever reached the 30
random-slot impressions the fade check needs**. Without that traffic the persona estimates
also drift (correlation of the model's persona like rates with the truth 0.59 / 0.62 / 0.38 /
0.30 below, against 0.78 to 0.86 with exploration).

- **Explore slots on the card stream.** Every 5th card the user decides on is an explore card;
  each page places the next one where that card falls, `(k - 1 - decided mod k) mod k`. The
  propensity a card logs is now its chance of landing in the window the app shows (the client
  sends `visible=3`), not in the whole page of 10.
- **Persona-to-persona term (`feed.cfWeight` 0.5).** Each serve logs the ranker's mean
  P(like) without this term (`p_pred`); among users who liked persona i, the likes of persona j
  over what the ranker predicted for them (an O/E ratio shrunk by 3 pseudo-likes) is how much
  i's fans like j beyond tags, traits and j's base rate. Item-based CF on the model's
  residuals, the family of Koren's global neighbourhood model on baseline residuals (KDD 2008)
  and of Tinder's TinVec co-swipe embeddings at persona level.
- **Dwell** (impression to swipe) is logged on every decided card. The ranker does not read it
  yet: the simulator has no dwell to calibrate it against.

Feed bench under the app's paging (`--page 3`), mean true like probability per card (first
deck in brackets), SE about 0.001; explore = share of seen cards that were explore cards,
fade sample = personas with 30+ random-slot impressions:

| | seed 7 | seed 11 | latent look, seed 7 | latent look, seed 11 | explore | fade sample |
|---|---|---|---|---|---|---|
| old ranker | 0.2127 (0.262) | 0.2060 (0.239) | 0.2346 (0.281) | 0.2334 (0.258) | 0% | 0 |
| explore on the card stream | 0.2071 (0.245) | 0.2084 (0.228) | 0.2332 (0.277) | 0.2320 (0.263) | 18.6% | 44 to 50 |
| **+ persona-to-persona term 0.5** | **0.2110 (0.242)** | **0.2064 (0.225)** | **0.2422 (0.282)** | **0.2337 (0.254)** | 18.6% | 44 to 51 |
| same, term at 1.0 | 0.2105 | 0.2013 | 0.2451 | 0.2388 | 18.6% | 45 to 51 |
| same at 1.0, explore every 8th card | 0.2175 | 0.2110 | 0.2526 | - | 9.3% | 0 |
| static popularity deck (true means) | 0.2242 | 0.2180 | 0.2508 | 0.2461 | | |
| oracle | 0.2974 | 0.2943 | 0.4178 | 0.4190 | | |

The old bench mode (one deck of 6, every card swiped), old ranker -> current: 0.2147 -> 0.2123
(seed 7), 0.2093 -> 0.2070 (seed 11), 0.2373 -> 0.2428 (latent look). The term pays where taste
lives outside the tags (a look, a drawing style), which is the case it exists for, and costs
up to 0.002 where tags explain everything; at weight 1.0 it gained more with a latent look
(+0.012 and +0.007) but lost 0.007 at seed 11.

What is left between the ranker and the true-popularity deck is mostly the exploration
itself: the explore cards (18.6% of what users see) are worth about 0.13 against about 0.23
for an exploit card. Halving them wins 0.007 to 0.010 but then no persona reaches its fade
sample in the bench's 42,000 cards. The rate is the lifecycle's to trade: every halving
doubles the traffic before a dud can be faded.

**Exploration stops where its sample is in** (`feed.randomTarget` 40, `undersampledTarget` 0 =
the gate's own count). A paired split of the gap on one trained model (seed 7) put all of it
on exploration: the explore cards cost 0.019, exploit cards alone beat the true-popularity deck
by 0.006, and the cards' true like probabilities are 0.233 exploit, 0.117 random, 0.133
undersampled. A score-tilted explore draw recovers only 0.001 to 0.003, so the slots stay
uniform but spend nothing on a persona whose sample is in: a random slot draws only among
personas under 40 random-slot swipes (the fade check needs 30), an undersampled slot only among
personas short of the gate's impressions. The draw still never depends on the user. While
samples fill, the deck is as before (bench seed 7 / 11 / latent: 0.2092 / 0.2064 / 0.2388, the
same within noise) and the random sample spreads wider (39 to 56 personas at 30+). Once they
are in, the bench's saturated proxy (targets 6 and 60) shows the steady state:

| | seed 7 | seed 11 | latent look, seed 7 | latent look, seed 11 | explore |
|---|---|---|---|---|---|
| samples filling (current, as above) | 0.2110 | 0.2064 | 0.2422 | 0.2337 | 18.6% |
| samples in | **0.2172** | **0.2121** | **0.2470** | **0.2432** | 11 to 12% |
| static popularity deck (true means) | 0.2242 | 0.2180 | 0.2508 | 0.2461 | |

**Fitted factor weights** (`feed.calibrate`). P(like) was the product affinity x quality x
traits x persona-to-persona term at weight 1 each; binned against the true rate, its
predictions ran from 0.021 to 0.628 where the truth ran from 0.109 to 0.301, a logit slope of
about 0.29 (3x too spread). Each serve now logs the factors' logs (posterior means) and the
model rebuild fits a logistic regression of every decided card on them, ridge toward the
plain product, from 500 swipes on.

Single runs turned out to move by up to 0.007 on the ranker's own random draws alone (the
bench now takes `--rseed`), so the comparison that counts is three ranker seeds per arm,
mean +/- sd, world seed 7 (first deck in brackets):

| | app paging, tags explain taste | app paging, latent look | whole decks, tags | whole decks, latent look |
|---|---|---|---|---|
| old ranker | 0.2113 +/- 0.0067 (0.258) | 0.2340 +/- 0.0027 (0.286) | 0.2132 +/- 0.0004 (0.251) | 0.2373 (one run) |
| **current (fitted weights off)** | **0.2118 +/- 0.0022 (0.243)** | **0.2399 +/- 0.0007 (0.281)** | **0.2100 +/- 0.0024 (0.252)** | **0.2422 +/- 0.0028 (0.278)** |
| current with fitted weights on | 0.2116 +/- 0.0018 (0.249) | 0.2487 +/- 0.0014 (0.292) | 0.2118 +/- 0.0015 (0.249) | 0.2479 +/- 0.0007 (0.283) |
| static popularity deck (true means) | 0.2242 | 0.2508 | 0.2242 | 0.2508 |

Under the app's paging the current ranker ties the old one where tags explain taste and beats
it by 0.006 with a latent look, while it now shows the 18.6% explore cards the old one never
did, its runs vary a third as much (the old ranker without exploration sometimes locks into bad
persona estimates: 0.2042 in one run), and its persona estimates track the truth at 0.81 to
0.84 against 0.39 to 0.48. With whole decks it costs 0.003 where tags explain taste (one explore
card in 5 instead of 1 in 6).

The fitted weights win every bench cell they are in (+0.009 with a latent look under the app's
paging), but the closed loop, which also has chats feeding the affinity and the whole
lifecycle, disagrees: like rate 20.6% against 23.1% at seed 7 (21.5% in an earlier run of the
unbounded fit) and 22.8% against 22.6% at seed 11, deep chats 0.42 / 0.47 against 0.46 / 0.48.
With them on, both seeds faded the true dud `isolde` (off: nothing at seed 7, two non-duds at
11) and the naive like-rate error fell to 1.5 / 2.0 points from 3.2 / 3.1.

The closed-loop loss came from the chat term, not the fit. The score multiplies P(like) by
`1 + w_deep P(deep chat) - w_neg P(report)`, a persona-level term the same for every user. The
fit makes P(like) about half as spread across a deck (sd of its log 0.38 against 0.76), so the
shared term got about twice the say and pulled every user toward the same chat-heavy personas;
deep chats per user did not rise with it. Removing the term gave 23.0% with the fit on against
20.6% (seed 7), and changed nothing with it off; the loss was all in exploit cards and largest
on each user's first cards. Ruled out: chat messages inflating the affinity factor (they halve
its fitted weight, but removing them left the loss), drift over the 25 days (the loss is flat
from day 1), the persona-to-persona term (the loss stays at weight 0). With the fit on, the
chat term is now raised to `feed.calibratedChatExponent` (0.5):

| Closed loop, 25 days, `--no-premium` | like rate, fit on -> off | deep chats per user, on -> off | faded, on / off |
|---|---|---|---|
| seed 7 | 22.9% -> 23.1% (20.6% before the fix) | 0.42 -> 0.46 | `isolde`, `megumi` / nothing |
| seed 11 | 22.3% -> 22.6% | 0.47 -> 0.48 | nothing / `ravenna`, `eleanor-ashby` |
| seed 3 | 21.7% -> 22.2% | 0.39 -> 0.43 | `isolde` / `nerissa` |

Near parity, with the same small sign on all three seeds, in a world with no latent look (where
the bench's +0.009 lives); naive like-rate error 2.1 / 2.2 / 2.1 points against 3.2 / 3.1 / 2.5.
The fit ships off (`feed.calibrate`) and is safe to turn on for a live A/B.

Closed loop, 25 days, 220 users a day, all 154 personas, `--no-premium`, seed 7 (whole decks
of 6, so the paging bug does not show here), before the exploration cap: like rate 23.1% -> 23.2%, deep chats per user
0.43 -> 0.42; the hidden dud `isolde` is now faded and retired (before: nothing faded), with
27 personas at their random-slot sample against 21. A/B tests: 2 against 0 promotions, both
runs with 31 to 32 of 33 tests still running at day 25 (chat traffic differs between runs).

With the cap (seed 7 / 11): like rate 23.1% / 22.6% against 23.1% / 23.0% for the old
ranker, deep chats per user 0.46 / 0.48 against 0.43 / 0.48, random-slot samples on 32 / 31
personas against 21 / 20. The static holdout alone moves between 16.4% and 18.0% across these
runs (the ranker's draws shift every later random number), so the closed loop cannot separate
differences under about a point; fading in 25 days stays noisy (old: nothing / `ibuki`,
`isolde`; capped: nothing / `ravenna`, `eleanor-ashby`).

Tried and dropped: no Thompson spread and no DPP until a new user has a few swipes (their draws
are only noise on population estimates): first decks +0.008 / +0.006 / -0.004, the whole bench
within noise either way. Persona-to-persona lifts over passes as well as likes: -0.002 (pass
lifts are mostly noise). And judging each persona against the audience the feed chose for it (observed
likes over the sum of the multiplicative user lifts logged at serve time, an O/E standardised
rate). It lost everywhere (0.2038 / 0.2029 / 0.2313; first decks 0.217 against 0.245): a
multiplicative lift overshoots where probabilities saturate, so the expected side is wrong for
exactly the fans it should correct for. The bias it targets (a persona's fans inflate its
raw rate) is real; correcting it needs a calibrated model in logit space.

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
