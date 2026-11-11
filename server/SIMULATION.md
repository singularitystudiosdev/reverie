# Simulation results

`npm run simulate -- --days 45 --users-per-day 220 --seed 7` (offline LLM, so
edits come from the heuristic proposer and the edit library; new personas from
the template writer). 9,900 synthetic users with hidden tastes; 10% see a
static deck as a holdout. Run 2026-11-11.

The hidden world the loop is NOT told about: two seed personas are duds
(`isolde`, `raven`); 18% of users want categories the seed roster lacks
(animal characters, mature, curvy, dance); replies that end without a question,
run long, or repeat make users drop.

| Check | Result |
|---|---|
| (a) promoted edits truly help | 13 of 13 promoted edits are ones the hidden model rewards; 0 harmful promoted; 40 opened, 3 discarded, 24 still running at day 45 |
| edit library transfer | 4 transferred edits tried, 4 won (fresh edits: 9 of 12 decided won) |
| (b) worst personas fade | retired exactly the two hidden duds (`raven`, `isolde`); a weak spawned persona (`mira-3`) is fading |
| (c) spawn only after the gate | gate first opened day 20; generations on days 20, 26, 32, 45; 0 spawns while closed |
| (d) feed vs static deck | like rate 31.2% vs 29.1% (n = 92,080 vs 10,274 impressions, about 4.5 standard errors); deep chats per user 0.64 vs 0.60, within run-to-run noise (an earlier run had 0.64 vs 0.70) |

Explore found the hidden demand without being told: spawned personas such as
`auntie-mae-2` (a dramatic wolf-woman, mature, curvy) and `mira-2` (a vampire
of the dance studio) reached 46-52% like rates against 22-37% for the seeds,
and exploit variations of the best seeds (`tamsin` and `esme` from `vesper`,
`juniper` and `bryn` from `kiyo`) entered the top of the table.

Fixes earlier runs of this simulation forced:

- the persona registry stamped `first_seen_at` with the wall clock, so on any
  other clock every new persona looked overdue and the gate spawned every tick;
- 7-day premium conversion counted early converters before the window closed,
  inflating young personas;
- guardrails used a fixed non-inferiority bound that never clears for rare
  events, which blocked every winning edit; they now block on "significantly
  worse" or a point estimate past the margin;
- the fade bar was the median, which eventually fades half of any roster; it
  is now the bottom quartile;
- the feed weighted a deep chat at a fixed 1.5 against a like, so it chased
  likes; the weight is now 1 / (mean deep-chat rate).

What this does not show: real users' tastes, how much LLM-written edits move
real conversations, or delayed metrics at real scale (D7, premium).
