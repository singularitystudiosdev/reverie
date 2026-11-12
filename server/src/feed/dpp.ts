/**
 * Determinantal point process rerank, as X's vm-ranker does it
 * (xai-org/x-algorithm, vm-ranker/dpp.rs): quality q_i = exp(alpha *
 * score_i / max_score) with alpha = theta / (2(1 - theta)), kernel
 * L_ij = q_i q_j cos(e_i, e_j), greedy MAP by incremental Cholesky
 * (Chen et al., NeurIPS 2018). theta -> 0 is pure diversity; theta -> 1 is
 * pure score order. Returns indices in selection order.
 */
/** Cosine similarity between candidate vectors, computed once per pair and cached (the feed
 *  replays the DPP many times per request to estimate propensities; only the scores change). */
export function cosineCache(vectors: number[][]): (i: number, j: number) => number {
  const n = vectors.length;
  const norms = vectors.map((v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1);
  const cache = new Float64Array(n * n).fill(NaN);
  return (i, j) => {
    const key = i < j ? i * n + j : j * n + i;
    let v = cache[key];
    if (Number.isNaN(v)) {
      let dot = 0;
      const a = vectors[i];
      const b = vectors[j];
      for (let x = 0; x < a.length; x++) dot += a[x] * b[x];
      v = cache[key] = dot / (norms[i] * norms[j]);
    }
    return v;
  };
}

export function dppSelect(
  scores: number[],
  vectors: number[][],
  k: number,
  theta: number,
  sim: (i: number, j: number) => number = cosineCache(vectors),
): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const t = Math.min(Math.max(theta, 0), 1 - 1e-6);
  const alpha = t / (2 * (1 - t));
  const max = Math.max(...scores.map((s) => Math.abs(s)), 1e-9);
  const q = scores.map((s) => Math.exp((alpha * s) / max));
  const L = (i: number, j: number) => q[i] * q[j] * (i === j ? 1 : sim(i, j));

  const d2 = q.map((x) => x * x);
  const c: number[][] = Array.from({ length: n }, () => []);
  const selected: number[] = [];
  const chosen = new Set<number>();
  while (selected.length < Math.min(k, n)) {
    let j = -1;
    let best = -Infinity;
    for (let i = 0; i < n; i++) if (!chosen.has(i) && d2[i] > best) {
      best = d2[i];
      j = i;
    }
    if (j === -1 || best <= 1e-6) break;
    selected.push(j);
    chosen.add(j);
    const dj = Math.sqrt(d2[j]);
    for (let i = 0; i < n; i++) {
      if (chosen.has(i)) continue;
      let dot = 0;
      for (let x = 0; x < c[j].length; x++) dot += c[j][x] * c[i][x];
      const e = (L(j, i) - dot) / dj;
      c[i].push(e);
      d2[i] -= e * e;
    }
    c[j].push(dj);
  }
  // Residual volume exhausted (near-duplicates): fill by score.
  if (selected.length < Math.min(k, n)) {
    const rest = [...Array(n).keys()].filter((i) => !chosen.has(i)).sort((a, b) => scores[b] - scores[a]);
    selected.push(...rest.slice(0, Math.min(k, n) - selected.length));
  }
  return selected;
}
