import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dppSelect } from '../src/feed/dpp.ts';
import { dynamicPrior, probBeats } from '../src/stats/dynamicPrior.ts';
import { csHalfWidth, diffProportionsCS, normCdf, normInv, twoProportionN } from '../src/stats/inference.ts';
import { gamma, lordLevel } from '../src/stats/fdr.ts';
import { makeRng } from '../src/stats/random.ts';

test('normal helpers are inverse of each other', () => {
  for (const p of [0.01, 0.05, 0.5, 0.9, 0.975]) assert.ok(Math.abs(normCdf(normInv(p)) - p) < 2e-4, String(p));
});

test('confidence-sequence half-width matches the GrowthBook formula by hand', () => {
  const se = 0.02;
  const n = 1000;
  const nStar = 2000;
  const alpha = 0.05;
  const rho = Math.sqrt((-2 * Math.log(alpha) + Math.log(-2 * Math.log(alpha) + 1)) / nStar);
  const expected = se * Math.sqrt(n) * Math.sqrt(((2 * (n * rho ** 2 + 1)) / (n ** 2 * rho ** 2)) * Math.log(Math.sqrt(n * rho ** 2 + 1) / alpha));
  assert.ok(Math.abs(csHalfWidth(se, n, nStar, alpha) - expected) < 1e-12);
  // Wider than the fixed-horizon interval, as the docs say.
  assert.ok(csHalfWidth(se, n, nStar, alpha) > 1.96 * se);
});

test('peeking 40 times: the confidence sequence keeps A/A false positives near alpha, a z-test does not', () => {
  const rng = makeRng(11);
  let z = 0;
  let cs = 0;
  const sims = 300;
  for (let s = 0; s < sims; s++) {
    let x1 = 0;
    let x2 = 0;
    let n = 0;
    let hz = false;
    let hc = false;
    for (let look = 0; look < 40; look++) {
      for (let i = 0; i < 50; i++) {
        x1 += rng() < 0.3 ? 1 : 0;
        x2 += rng() < 0.3 ? 1 : 0;
      }
      n += 50;
      const p1 = x1 / n;
      const p2 = x2 / n;
      const se = Math.sqrt(p1 * (1 - p1) / n + p2 * (1 - p2) / n);
      if (Math.abs(p1 - p2) / se > 1.96) hz = true;
      const ci = diffProportionsCS(x1, n, x2, n, 2000);
      if (ci.lower > 0 || ci.upper < 0) hc = true;
    }
    z += hz ? 1 : 0;
    cs += hc ? 1 : 0;
  }
  assert.ok(z / sims > 0.15, `z-test FPR ${z / sims}`);
  assert.ok(cs / sims <= 0.07, `CS FPR ${cs / sims}`);
});

test('two-proportion sample size matches the textbook value', () => {
  // p = 0.3 -> 0.35 at alpha 0.05, power 0.8: about 1,374-1,377 per arm.
  const n = twoProportionN(0.3, 0.05);
  assert.ok(n > 1350 && n < 1400, String(n));
});

test('dynamic prior: a new persona beats the incumbent with probability about eps (Monte Carlo)', () => {
  const rng = makeRng(5);
  const incumbent = { a: 1 + 300, b: 1 + 2700 }; // ~10% like rate
  const prior = dynamicPrior(incumbent, 0.1, 30);
  assert.ok(Math.abs(probBeats(prior, incumbent) - 0.1) < 0.01);
  let wins = 0;
  const draws = 20000;
  for (let i = 0; i < draws; i++) if (rng.beta(prior.a, prior.b) > rng.beta(incumbent.a, incumbent.b)) wins++;
  assert.ok(Math.abs(wins / draws - 0.1) < 0.03, `MC P(new beats incumbent) = ${wins / draws}`);
  assert.ok(prior.a / (prior.a + prior.b) < 0.1, 'prior mean sits below the incumbent');
});

test('DPP prefers a diverse slate over near-duplicates at equal scores', () => {
  const vecs = [
    [1, 0, 0],
    [1, 0, 0],
    [1, 0.01, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const pick = dppSelect([1, 1, 1, 0.95, 0.9], vecs, 3, 0.5);
  assert.equal(pick.length, 3);
  const set = new Set(pick);
  assert.ok(set.has(3) && set.has(4), `picked ${pick}`);
});

test('online FDR (LORD++): levels start small, grow after discoveries, and hold the stream FDR near alpha', () => {
  let sum = 0;
  for (let j = 1; j <= 200_000; j++) sum += gamma(j);
  assert.ok(sum > 0.98 && sum <= 1, `gamma sums to ${sum}`);
  assert.ok(Math.abs(lordLevel(1, [], 0.05) - gamma(1) * 0.025) < 1e-12);
  assert.ok(lordLevel(5, [2, 3], 0.05) > lordLevel(5, [], 0.05), 'discoveries earn level back');
  assert.ok(lordLevel(3, [3, 7], 0.05) === lordLevel(3, [], 0.05), 'only earlier discoveries count');
  // A stream of 400 tests, 80% true nulls (uniform p), 20% real effects (p concentrated near 0).
  const rng = makeRng(11);
  let fdpSum = 0;
  const runs = 200;
  for (let r = 0; r < runs; r++) {
    const disc: number[] = [];
    let falseDisc = 0;
    for (let t = 1; t <= 400; t++) {
      const isNull = rng() < 0.8;
      const p = isNull ? rng() : rng() ** 8;
      if (p <= lordLevel(t, disc, 0.05)) {
        disc.push(t);
        if (isNull) falseDisc++;
      }
    }
    fdpSum += disc.length ? falseDisc / disc.length : 0;
  }
  assert.ok(fdpSum / runs <= 0.05, `empirical FDR ${fdpSum / runs}`);
});
