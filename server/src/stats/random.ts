/**
 * Seedable randomness for Thompson sampling and the simulation:
 * mulberry32 uniform, Box-Muller normal, Marsaglia-Tsang gamma, Beta via two
 * gammas. Production uses a time-seeded instance; tests and the simulation
 * pass a fixed seed so runs reproduce.
 */
export interface Rng {
  (): number;
  normal(): number;
  gamma(shape: number): number;
  beta(a: number, b: number): number;
  pick<T>(xs: readonly T[]): T;
  int(n: number): number;
}

export function makeRng(seed = Date.now() ^ (Math.random() * 2 ** 31)): Rng {
  let s = seed >>> 0;
  const u = (() => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;

  let spare: number | null = null;
  u.normal = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let a = 0;
    let b = 0;
    while (a === 0) a = u();
    while (b === 0) b = u();
    const r = Math.sqrt(-2 * Math.log(a));
    spare = r * Math.sin(2 * Math.PI * b);
    return r * Math.cos(2 * Math.PI * b);
  };

  u.gamma = (shape: number): number => {
    if (shape <= 0) return 0;
    if (shape < 1) return u.gamma(shape + 1) * Math.pow(u() || 1e-12, 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = u.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const w = u();
      if (w < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };

  u.beta = (a: number, b: number): number => {
    const x = u.gamma(Math.max(a, 1e-6));
    const y = u.gamma(Math.max(b, 1e-6));
    return x + y === 0 ? 0.5 : x / (x + y);
  };

  u.pick = <T,>(xs: readonly T[]): T => xs[Math.floor(u() * xs.length)];
  u.int = (n: number) => Math.floor(u() * n);
  return u;
}

/** Stable 32-bit FNV-1a hash, for sticky experiment buckets. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
