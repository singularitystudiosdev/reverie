/**
 * Online false-discovery-rate control for the stream of persona A/B tests.
 *
 * Every persona keeps getting tests, so over time dozens to hundreds run, and at a fixed 5% level
 * about one in twenty tests with no real effect would still "win" and rewrite a persona file. LORD++
 * (Ramdas, Yang, Wainwright, Jordan 2017, "Online control of the false discovery rate with decaying
 * memory", arXiv 1710.00499) gives test t its own level alpha_t so that the false discovery rate
 * over the whole stream stays at alpha:
 *
 *   alpha_t = gamma_t W0 + (alpha - W0) gamma_{t - tau_1} + alpha * sum_{j >= 2} gamma_{t - tau_j}
 *
 * where tau_j are the indices of earlier discoveries and gamma is a non-increasing sequence summing
 * to 1. Tests here run side by side, so alpha_t is fixed when test t opens and counts only the
 * discoveries already decided by then: the asynchronous form (Zrnic, Ramdas, Jordan, "Asynchronous
 * online testing of multiple hypotheses", arXiv 1812.05068). Each test is itself an always-valid
 * sequential test at its alpha_t, so it can be checked every tick.
 *
 * gamma_j is proportional to j^-1.6: heavier at the start than LORD++'s default sequence, because
 * this stream is short (tens of tests a month, not millions), and still summable.
 */
const P = 1.6;
const Z = (() => {
  const N = 100_000;
  let s = 0;
  for (let j = 1; j <= N; j++) s += j ** -P;
  return s + (N + 0.5) ** (1 - P) / (P - 1);
})();

export function gamma(j: number): number {
  return j >= 1 ? j ** -P / Z : 0;
}

/**
 * The level for test number `t` (1-based, in opening order), given the opening indices of earlier
 * tests already decided as discoveries.
 */
export function lordLevel(t: number, discoveries: number[], alpha: number, w0 = alpha / 2): number {
  let level = gamma(t) * w0;
  const earlier = discoveries.filter((tau) => tau < t).sort((a, b) => a - b);
  earlier.forEach((tau, j) => {
    level += (j === 0 ? alpha - w0 : alpha) * gamma(t - tau);
  });
  return Math.min(level, alpha);
}
