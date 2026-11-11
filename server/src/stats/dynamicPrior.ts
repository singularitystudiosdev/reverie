/**
 * Dynamic-prior Thompson sampling for new personas (Zhao et al. 2026,
 * "Dynamic Prior Thompson Sampling for Cold-Start Exploration in Recommender
 * Systems", arXiv 2602.00943).
 *
 * A Beta(1,1) prior tells Thompson sampling that an unseen persona has a 50%
 * like rate. Real like rates are far lower, so every new persona would flood
 * decks until data arrives, and with batched updates that can take hours.
 * Instead the new arm's prior mean q is chosen so that, at introduction,
 * P(new beats incumbent) = eps. In the proxy simulation (6% new vs 10%
 * incumbent, updates every 150 impressions), Beta(1,1) spent 175 of 1500
 * impressions on the weaker newcomer and this prior spent 53.
 *
 * The paper solves a quadratic under a normal approximation of both Betas,
 * with prior strength n_k * r. This implementation keeps the same normal
 * approximation but solves for q by bisection (no transcription risk in the
 * quadratic's coefficients), and caps the strength so a newcomer can still
 * move within a few hundred impressions. Tests check it against Monte Carlo.
 */
import { normCdf } from './inference.ts';

export interface BetaParams {
  a: number;
  b: number;
}

function betaMoments(a: number, b: number): { mean: number; variance: number } {
  const s = a + b;
  return { mean: a / s, variance: (a * b) / (s * s * (s + 1)) };
}

/** P(X > Y) for X ~ Beta(x), Y ~ Beta(y), normal approximation. */
export function probBeats(x: BetaParams, y: BetaParams): number {
  const mx = betaMoments(x.a, x.b);
  const my = betaMoments(y.a, y.b);
  const sd = Math.sqrt(mx.variance + my.variance);
  return sd === 0 ? (mx.mean > my.mean ? 1 : 0) : normCdf((mx.mean - my.mean) / sd);
}

/**
 * The prior for a new arm given the incumbent's posterior.
 * @param incumbent posterior of the arm to beat (e.g. the best persona in the newcomer's category)
 * @param eps target P(new beats incumbent) at introduction
 * @param strength pseudo-observations in the prior (paper: n_k * r; capped by the caller)
 */
export function dynamicPrior(incumbent: BetaParams, eps: number, strength: number): BetaParams {
  const pk = incumbent.a / (incumbent.a + incumbent.b);
  let lo = 1e-4;
  let hi = Math.max(pk, 2e-4);
  const at = (q: number) => probBeats({ a: q * strength, b: (1 - q) * strength }, incumbent);
  // No root inside (0, p_k): an incumbent too uncertain for the target to bind.
  if (at(lo) >= eps || at(hi) <= eps) {
    const q = eps * pk;
    return { a: q * strength, b: (1 - q) * strength };
  }
  for (let i = 0; i < 60; i++) {
    const q = (lo + hi) / 2;
    const p = probBeats({ a: q * strength, b: (1 - q) * strength }, incumbent);
    if (p < eps) lo = q;
    else hi = q;
  }
  let q = (lo + hi) / 2;
  // The paper's fallback when the solution leaves (0, p_k): q = eps * p_k.
  if (!(q > 0 && q < pk)) q = eps * pk;
  return { a: q * strength, b: (1 - q) * strength };
}
