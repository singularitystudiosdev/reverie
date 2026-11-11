/**
 * The statistics the loop decides with.
 *
 * - Asymptotic confidence sequences (Waudby-Smith et al. 2023,
 *   arXiv 2103.06476) in the form GrowthBook ships
 *   (docs.growthbook.io/statistics/sequential): valid under continuous
 *   peeking, which an autonomous loop does every tick. In the proxy
 *   simulation, a fixed z-test peeked 40 times had a 0.305 false-positive rate
 *   on A/A data; this sequence had 0.022. Because the guarantee is asymptotic
 *   (good only for a late first peek, Thm 2.8), callers impose a delayed start
 *   (config.experiments.minPerArm) before acting on it.
 * - Two-proportion power for the "statistically significant sample" gate.
 * - Normal-approximation intervals for persona scores (fade decisions).
 */

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Half-width of the asymptotic confidence sequence for an estimate with
 * standard error `se` after `n` total observations (both arms), tuned to be
 * tightest near `nStar` total observations.
 */
export function csHalfWidth(se: number, n: number, nStar: number, alpha = 0.05): number {
  if (n <= 0 || !Number.isFinite(se)) return Infinity;
  const l = -2 * Math.log(alpha);
  const rho2 = (l + Math.log(l + 1)) / Math.max(nStar, 1);
  const nr = n * rho2;
  return se * Math.sqrt(n) * Math.sqrt(((2 * (nr + 1)) / (n * n * rho2)) * Math.log(Math.sqrt(nr + 1) / alpha));
}

export interface Interval {
  estimate: number;
  lower: number;
  upper: number;
  n: number;
}

/** Confidence sequence on p_t - p_c. */
export function diffProportionsCS(xT: number, nT: number, xC: number, nC: number, nStar: number, alpha = 0.05): Interval {
  const pT = nT ? xT / nT : 0;
  const pC = nC ? xC / nC : 0;
  // Floor the variance so a 0/n or n/n arm does not collapse the interval at small n.
  const vT = Math.max(pT * (1 - pT), 0.25 / Math.max(nT, 1)) / Math.max(nT, 1);
  const vC = Math.max(pC * (1 - pC), 0.25 / Math.max(nC, 1)) / Math.max(nC, 1);
  const est = pT - pC;
  const h = csHalfWidth(Math.sqrt(vT + vC), nT + nC, nStar, alpha);
  return { estimate: est, lower: est - h, upper: est + h, n: nT + nC };
}

/** Confidence sequence on mean_t - mean_c for a bounded continuous metric. */
export function diffMeansCS(
  t: { n: number; mean: number; variance: number },
  c: { n: number; mean: number; variance: number },
  nStar: number,
  alpha = 0.05,
): Interval {
  const se = Math.sqrt(t.variance / Math.max(t.n, 1) + c.variance / Math.max(c.n, 1));
  const est = t.mean - c.mean;
  const h = csHalfWidth(se, t.n + c.n, nStar, alpha);
  return { estimate: est, lower: est - h, upper: est + h, n: t.n + c.n };
}

/** Per-arm sample size to detect an absolute lift `mde` from `p` (two-sided alpha, power). */
export function twoProportionN(p: number, mde: number, alpha = 0.05, power = 0.8): number {
  const p1 = Math.min(Math.max(p, 0.001), 0.999);
  const p2 = Math.min(Math.max(p + mde, 0.001), 0.999);
  const pb = (p1 + p2) / 2;
  const za = normInv(1 - alpha / 2);
  const zb = normInv(power);
  const n = (za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (mde * mde);
  return Math.ceil(n);
}

/** Wilson interval for a proportion. */
export function wilson(x: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { estimate: 0, lower: 0, upper: 1, n: 0 };
  const p = x / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half), n };
}

/** Mean and unbiased variance. */
export function moments(xs: number[]): { n: number; mean: number; variance: number } {
  const n = xs.length;
  if (!n) return { n: 0, mean: 0, variance: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, variance };
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
