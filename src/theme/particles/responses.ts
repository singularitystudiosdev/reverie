/*
  Per-world response curves: game-audio RTPC style (RTPC-SPEC.md sections 2,
  3 and 3b, built verbatim from the drilled tables). Screens set named
  parameters (typing, drag, affinity) and fire pulses (gust, bloom); every
  world maps those sources onto its own particle layers, overlay opacities,
  wind and light washes through the curves below.

  Combining: spawn / speed / alpha bindings MULTIPLY (identity 1); overlay,
  wind, glow and dim bindings ADD (identity 0). Every curve returns its
  identity at x = 0, except affinity and idle curves. Clamps live in
  tuning.ts (`clampTo`).

  Numeric-literal exemption: this file is simulation data (brief, "Rule").
*/
import type { OverlayKind, ParticleKind, ThemeId } from '../../data/types';

export type Src = 'typing' | 'pass' | 'like' | 'affinity' | 'idle' | 'gust' | 'bloom';
/** Shape of the segment STARTING at this point: linear, t^2, 1-(1-t)^2, smoothstep, hold. */
export type Seg = 'l' | 'in' | 'out' | 's' | 'h';
export type Pt = readonly [x: number, y: number, seg?: Seg];
/** x ascending, at most 5 points, clamped outside. */
export type Curve = readonly Pt[];
export type Binding = readonly [src: Src, curve: Curve];
/** MUL, identity 1. */
export interface LayerResponse {
  spawn?: Binding[];
  speed?: Binding[];
  alpha?: Binding[];
}
/** ADD onto rest; final clamp 0..1 (or `max`, the noise limit of glitch). */
export interface OverlayResponse {
  rest: number;
  add?: Binding[];
  max?: number;
}
export interface ThemeResponse {
  layers?: Partial<Record<ParticleKind, LayerResponse>>;
  overlays?: Partial<Record<OverlayKind, OverlayResponse>>;
  /** ADD, frame-widths per second (+x right, +y down). */
  windX?: Binding[];
  windY?: Binding[];
  /** ADD, canvas wash alpha. */
  glow?: Binding[];
  dim?: Binding[];
  bloomEmit?: { kind: ParticleKind; n: number };
}

/* ---------------------------------------------------------------- helpers */

/** A 0..1 source mapped linearly (or by `seg`) from y0 to y1. */
const b = (src: Src, y0: number, y1: number, seg: Seg = 'l'): Binding => [src, [[0, y0, seg], [1, y1]]];
/** Gust and bloom curves use 'out'. */
const g = (y0: number, y1: number): Binding => b('gust', y0, y1, 'out');
const bl = (y0: number, y1: number): Binding => b('bloom', y0, y1, 'out');
/** Idle: nothing for the first 10 s, then the value at 25 s and 45 s. */
const idleC = (rest: number, y25: number, y45: number): Binding => [
  'idle',
  [[0, rest], [10, rest], [25, y25], [45, y45]],
];
/** Affinity spawn multiplier at 0 / 0.5 / 1 (a layer that enters from zero eases in). */
const aff = (a0: number, a5: number, a1: number): Binding => [
  'affinity',
  [[0, a0, a0 === 0 ? 'in' : 'l'], [0.5, a5], [1, a1]],
];
/** Affinity overlay offsets: the rest is the value at 0, this adds (v.5 - v0, v1 - v0). */
const affO = (v0: number, v5: number, v1: number): Binding => [
  'affinity',
  [[0, 0], [0.5, v5 - v0], [1, v1 - v0]],
];
/** Stem 3 glow floor: enters above affinity 0.6. */
const glowFloor = (v1: number): Binding => ['affinity', [[0, 0], [0.6, 0], [1, v1]]];

/* ----------------------------------------------------------------- tables */

export const responses: Record<ThemeId, ThemeResponse> = {
  base: {
    // Flat: affinity ignored, no idle (the Chats list stays still).
    windX: [g(0, -0.15)],
    glow: [b('typing', 0, 0.04), bl(0, 0.1), b('like', 0, 0.08)],
    dim: [b('pass', 0, 0.08)],
  },

  grove: {
    layers: {
      leaf: { spawn: [aff(0.5, 0.85, 1.2), g(1, 2.2), b('pass', 1, 1.4)], speed: [b('typing', 1, 0.7), idleC(1, 0.85, 0.7)] },
      firefly: {
        spawn: [aff(0.2, 0.7, 1.3), b('typing', 1, 1.6), idleC(1, 1.3, 1.6)],
        alpha: [b('typing', 1, 1.3), bl(1, 1.6), b('like', 1, 1.5)],
      },
      pollen: { spawn: [aff(0, 0.3, 1), g(1, 1.8), bl(1, 2)] },
    },
    overlays: {
      godrays: {
        rest: 0.35,
        add: [affO(0.35, 0.5, 0.65), b('typing', 0, -0.15), bl(0, 0.25), b('like', 0, 0.2), idleC(0, -0.05, -0.12)],
      },
      fog: { rest: 0.5, add: [b('pass', 0, 0.15)] },
      vignette: { rest: 0.55 },
    },
    windX: [g(0, -0.45), b('pass', 0, -0.35), b('like', 0, 0.25)],
    glow: [bl(0, 0.18), b('like', 0, 0.14), glowFloor(0.06)],
    dim: [b('typing', 0, 0.06), b('pass', 0, 0.2)],
    bloomEmit: { kind: 'firefly', n: 10 },
  },

  crimson: {
    layers: {
      rose: { spawn: [aff(0.5, 0.85, 1.3), g(1, 2.2), bl(1, 1.8), b('like', 1, 1.6)], speed: [b('typing', 1, 0.6), idleC(1, 0.8, 0.65)] },
      bat: { spawn: [aff(0.4, 0.8, 1.2), b('typing', 1, 0.5), g(1, 2.5), idleC(1, 0.6, 1.8)], speed: [g(1, 1.8), b('pass', 1, 1.6)] },
    },
    overlays: {
      fog: { rest: 0.45, add: [affO(0.45, 0.5, 0.55), b('typing', 0, 0.15), b('pass', 0, 0.2)] },
      vignette: { rest: 0.6, add: [b('typing', 0, 0.1), b('like', 0, -0.1), idleC(0, 0.06, 0.12)] },
      // A soft candle flare, never random: rests at 0, flashes only on bloom.
      lightning: { rest: 0, add: [bl(0, 0.3)] },
    },
    windX: [g(0, -0.35), b('pass', 0, -0.5), b('like', 0, 0.25)],
    glow: [bl(0, 0.2), b('like', 0, 0.18), glowFloor(0.05)],
    dim: [b('pass', 0, 0.28)],
    bloomEmit: { kind: 'rose', n: 10 },
  },

  sakura: {
    layers: {
      petal: {
        spawn: [aff(0.5, 0.85, 1.2), g(1, 2.5), bl(1, 1.6), b('pass', 1, 1.8), b('like', 1, 2)],
        speed: [b('typing', 1, 0.6), idleC(1, 0.9, 0.8)],
      },
      bokeh: { spawn: [aff(0, 0.5, 1)], alpha: [b('typing', 1, 1.3), b('like', 1, 1.5)] },
    },
    overlays: {
      sunbeam: { rest: 0.3, add: [affO(0.3, 0.45, 0.6), g(0, 0.1), bl(0, 0.2), idleC(0, -0.05, -0.12)] },
      lanterns: { rest: 0.1, add: [affO(0.1, 0.25, 0.45), b('typing', 0, 0.25), bl(0, 0.15), idleC(0, 0.08, 0.18)] },
    },
    windX: [g(0, -0.5), b('pass', 0, -0.55), b('like', 0, 0.4)],
    glow: [bl(0, 0.15), b('like', 0, 0.12), glowFloor(0.05)],
    dim: [b('pass', 0, 0.12)],
    bloomEmit: { kind: 'petal', n: 12 },
  },

  tide: {
    layers: {
      bubble: { spawn: [aff(0.5, 0.85, 1.2), b('typing', 1, 1.8), g(1, 2.2)], speed: [b('typing', 1, 1.3), b('like', 1, 1.4), idleC(1, 0.85, 0.7)] },
      bokeh: { spawn: [aff(0, 0.5, 1)], alpha: [bl(1, 1.5), idleC(1, 1.2, 1.4)] },
    },
    overlays: {
      caustics: { rest: 0.35, add: [affO(0.35, 0.45, 0.55), b('typing', 0, -0.12), bl(0, 0.15), b('pass', 0, -0.2)] },
      godrays: { rest: 0.3, add: [affO(0.3, 0.45, 0.55), g(0, 0.1), b('like', 0, 0.2), idleC(0, -0.05, -0.12)] },
    },
    windX: [g(0, -0.35), b('pass', 0, -0.4)],
    windY: [b('typing', 0, -0.04)],
    glow: [bl(0, 0.18), b('like', 0, 0.12), glowFloor(0.05)],
    dim: [b('pass', 0, 0.25)],
    bloomEmit: { kind: 'bubble', n: 12 },
  },

  ember: {
    layers: {
      ember: {
        spawn: [aff(0.5, 0.85, 1.2), g(1, 3), b('pass', 1, 0.4), b('like', 1, 1.8), idleC(1, 0.8, 0.55)],
        speed: [b('typing', 1, 0.7), bl(1, 1.5)],
        alpha: [idleC(1, 1.15, 1.3)],
      },
      sparkle: { spawn: [aff(0, 0.5, 1), g(1, 2)] },
    },
    overlays: {
      heat: {
        rest: 0.2,
        add: [affO(0.2, 0.3, 0.4), b('typing', 0, 0.12), g(0, 0.1), bl(0, 0.2), b('pass', 0, -0.2), b('like', 0, 0.15), idleC(0, -0.05, -0.12)],
      },
      vignette: { rest: 0.6, add: [bl(0, -0.1)] },
    },
    windX: [g(0, -0.3)],
    windY: [g(0, -0.25), b('pass', 0, 0.1), b('like', 0, -0.3)],
    glow: [b('typing', 0, 0.06), bl(0, 0.28), b('like', 0, 0.2), glowFloor(0.08)],
    dim: [b('pass', 0, 0.28)],
    bloomEmit: { kind: 'ember', n: 14 },
  },

  frost: {
    layers: {
      snow: { spawn: [aff(0.5, 0.85, 1.2), g(1, 2.5), b('pass', 1, 2)], speed: [b('typing', 1, 0.6), idleC(1, 0.8, 0.6)] },
      sparkle: { spawn: [aff(0, 0.5, 1), b('like', 1, 2)], alpha: [bl(1, 1.6), idleC(1, 1.2, 1.4)] },
    },
    overlays: {
      aurora: { rest: 0.1, add: [affO(0.1, 0.3, 0.5), bl(0, 0.3), b('like', 0, 0.2), idleC(0, 0.08, 0.2)] },
      frostEdge: { rest: 0.25, add: [affO(0.25, 0.3, 0.35), b('typing', 0, 0.25), g(0, -0.1), b('pass', 0, 0.2), b('like', 0, -0.15)] },
    },
    windX: [g(0, -0.55), b('pass', 0, -0.4)],
    glow: [bl(0, 0.2), b('like', 0, 0.15), glowFloor(0.04)],
    dim: [b('pass', 0, 0.15)],
    bloomEmit: { kind: 'sparkle', n: 14 },
  },

  neon: {
    layers: {
      rain: { spawn: [aff(0.5, 0.85, 1.2)], speed: [b('like', 1, 1.3), idleC(1, 0.9, 0.85)] },
      glyph: {
        spawn: [aff(0.2, 0.7, 1.3), b('typing', 1, 2.2), g(1, 2.5), b('like', 1, 2), idleC(1, 1.2, 1.5)],
        speed: [b('typing', 1, 1.3)],
      },
    },
    overlays: {
      scanlines: { rest: 0.2, add: [affO(0.2, 0.25, 0.3), b('typing', 0, 0.1), bl(0, 0.15), b('like', 0, 0.05), idleC(0, 0.05, 0.1)] },
      // Noise limit: capped at 0.4, event-driven only, never idle.
      glitch: { rest: 0, add: [g(0, 0.35), bl(0, 0.2), b('pass', 0, 0.4)], max: 0.4 },
      fog: { rest: 0.3, add: [affO(0.3, 0.35, 0.4), bl(0, 0.1), idleC(0, 0.05, 0.1)] },
    },
    windX: [g(0, -0.3), b('pass', 0, -0.3)],
    glow: [bl(0, 0.22), b('like', 0, 0.2), glowFloor(0.06)],
    dim: [b('pass', 0, 0.2)],
    bloomEmit: { kind: 'glyph', n: 12 },
  },

  celestial: {
    layers: {
      star: { spawn: [aff(0.5, 0.85, 1.2)], alpha: [b('typing', 1, 1.4), bl(1, 1.5), b('pass', 1, 0.7), idleC(1, 1.15, 1.3)] },
      shootingStar: { spawn: [aff(0.3, 1, 1.5), b('typing', 1, 0), g(1, 4), b('like', 1, 3), idleC(1, 1.5, 2)] },
      sparkle: { spawn: [aff(0, 0.4, 1)] },
    },
    overlays: {
      moon: { rest: 0.4, add: [affO(0.4, 0.5, 0.6), b('typing', 0, 0.1), bl(0, 0.25), b('pass', 0, -0.15), idleC(0, 0.05, 0.1)] },
      aurora: { rest: 0.05, add: [affO(0.05, 0.15, 0.3), g(0, 0.1), b('like', 0, 0.2)] },
    },
    glow: [bl(0, 0.22), b('like', 0, 0.15)],
    dim: [b('pass', 0, 0.2)],
    bloomEmit: { kind: 'sparkle', n: 14 },
  },

  sunflower: {
    layers: {
      pollen: { spawn: [aff(0.5, 0.85, 1.2), g(1, 2.5)], speed: [b('typing', 1, 0.6)] },
      butterfly: {
        spawn: [aff(0.15, 0.7, 1.3), bl(1, 2), b('like', 1, 2), idleC(1, 0.8, 0.6)],
        speed: [b('typing', 1, 0.7), g(1, 1.4), idleC(1, 0.85, 0.7)],
      },
    },
    overlays: {
      sunbeam: { rest: 0.3, add: [affO(0.3, 0.45, 0.55), b('typing', 0, 0.15), bl(0, 0.25), b('pass', 0, -0.2), b('like', 0, 0.2), idleC(0, -0.05, -0.1)] },
      grain: { rest: 0.15, add: [idleC(0, 0.03, 0.06)] },
    },
    windX: [g(0, -0.45), b('pass', 0, -0.35), b('like', 0, 0.25)],
    glow: [bl(0, 0.2), b('like', 0, 0.15), glowFloor(0.06)],
    dim: [b('pass', 0, 0.1)],
    bloomEmit: { kind: 'pollen', n: 14 },
  },

  citylights: {
    layers: {
      bokeh: {
        spawn: [aff(0.5, 0.85, 1.3), b('like', 1, 1.6)],
        speed: [g(1, 1.3)],
        alpha: [b('typing', 1, 1.5), bl(1, 1.8), b('like', 1, 1.4), idleC(1, 1.15, 1.3)],
      },
      rain: { spawn: [aff(0.4, 0.8, 1.1), b('typing', 1, 0.7), g(1, 2), b('pass', 1, 2), b('like', 1, 0.6), idleC(1, 0.7, 0.5)] },
    },
    overlays: {
      grain: { rest: 0.2 },
      vignette: { rest: 0.5, add: [b('typing', 0, 0.1), idleC(0, 0.05, 0.1)] },
    },
    windX: [g(0, -0.3), b('pass', 0, -0.3)],
    glow: [bl(0, 0.25), b('like', 0, 0.18), glowFloor(0.05)],
    dim: [b('pass', 0, 0.2)],
    bloomEmit: { kind: 'bokeh', n: 8 },
  },

  foxfire: {
    layers: {
      maple: { spawn: [aff(0.5, 0.85, 1.2), g(1, 2.5), b('pass', 1, 2)], speed: [b('typing', 1, 0.7), idleC(1, 0.9, 0.8)] },
      wisp: {
        spawn: [aff(0.2, 0.8, 1.4), b('typing', 1, 2), b('like', 1, 1.6), idleC(1, 1.3, 1.8)],
        speed: [g(1, 1.5), b('pass', 1, 1.5)],
        alpha: [b('typing', 1, 1.4), bl(1, 1.6)],
      },
    },
    overlays: {
      fog: { rest: 0.4 },
      lanterns: { rest: 0.1, add: [affO(0.1, 0.3, 0.55), b('typing', 0, 0.1), bl(0, 0.2), b('like', 0, 0.2), idleC(0, 0.08, 0.15)] },
    },
    windX: [g(0, -0.5), b('pass', 0, -0.45), b('like', 0, 0.3)],
    glow: [bl(0, 0.22), b('like', 0, 0.15), glowFloor(0.05)],
    dim: [b('pass', 0, 0.2)],
    bloomEmit: { kind: 'wisp', n: 10 },
  },

  mirage: {
    layers: {
      sand: { spawn: [aff(0.5, 0.85, 1.2), b('typing', 1, 0.6), g(1, 3)], speed: [b('typing', 1, 0.5), idleC(1, 0.8, 0.5)] },
      sparkle: { spawn: [aff(0, 0.5, 1.2), b('like', 1, 2)], alpha: [b('typing', 1, 1.4), bl(1, 1.6), idleC(1, 1.15, 1.3)] },
    },
    overlays: {
      heat: { rest: 0.2, add: [affO(0.2, 0.3, 0.4), b('typing', 0, 0.12), g(0, 0.1)] },
      sunbeam: { rest: 0.35, add: [affO(0.35, 0.5, 0.6), g(0, -0.1), bl(0, 0.25), b('like', 0, 0.2), idleC(0, -0.06, -0.15)] },
    },
    windX: [g(0, -0.6), b('pass', 0, -0.6), b('like', 0, 0.3)],
    glow: [bl(0, 0.25), b('like', 0, 0.12), glowFloor(0.05)],
    dim: [b('pass', 0, 0.2), idleC(0, 0.03, 0.06)],
    bloomEmit: { kind: 'sparkle', n: 16 },
  },

  raven: {
    layers: {
      feather: { spawn: [aff(0.5, 0.85, 1.2), g(1, 2.5), b('pass', 1, 2)], speed: [b('typing', 1, 0.6), idleC(1, 0.8, 0.6)] },
      bokeh: { spawn: [aff(0.1, 0.6, 1.2)], alpha: [b('typing', 1, 0.7), bl(1, 1.7), b('like', 1, 1.5), idleC(1, 1.15, 1.3)] },
    },
    overlays: {
      fog: { rest: 0.4, add: [affO(0.4, 0.45, 0.5), b('typing', 0, 0.1), idleC(0, 0.06, 0.12)] },
      grain: { rest: 0.2, add: [g(0, 0.08), idleC(0, 0.03, 0.05)] },
      vignette: { rest: 0.6, add: [b('typing', 0, 0.12), bl(0, -0.1)] },
    },
    windX: [g(0, -0.5), b('pass', 0, -0.45), b('like', 0, 0.3)],
    glow: [bl(0, 0.2), b('like', 0, 0.15), glowFloor(0.05)],
    dim: [b('pass', 0, 0.25)],
    bloomEmit: { kind: 'feather', n: 8 },
  },

  brass: {
    layers: {
      gear: { spawn: [aff(0.5, 0.85, 1.2)], speed: [b('typing', 1, 1.8), b('pass', 1, 0.4), b('like', 1, 1.6), idleC(1, 0.8, 0.5)] },
      steam: { spawn: [aff(0.4, 0.8, 1.2), b('typing', 1, 1.6), g(1, 3), bl(1, 1.8), idleC(1, 0.8, 0.7)], speed: [g(1, 1.5)] },
      sparkle: { spawn: [aff(0, 0.4, 1.1), b('typing', 1, 1.3), b('like', 1, 2)] },
    },
    overlays: {
      sunbeam: { rest: 0.35, add: [affO(0.35, 0.45, 0.6), bl(0, 0.2), b('like', 0, 0.15), idleC(0, -0.05, -0.1)] },
      grain: { rest: 0.15 },
    },
    windX: [g(0, -0.35), b('pass', 0, -0.4)],
    windY: [g(0, -0.1)],
    glow: [bl(0, 0.2), b('like', 0, 0.15), glowFloor(0.05)],
    dim: [b('pass', 0, 0.15)],
    bloomEmit: { kind: 'sparkle', n: 12 },
  },
};

/* --------------------------------------------------------------- compiler */

export const SRC = {
  typing: 0,
  pass: 1,
  like: 2,
  affinity: 3,
  idle: 4,
  gust: 5,
  bloom: 6,
} as const satisfies Record<Src, number>;
export const SRC_COUNT = 7;

const SEG: Record<Seg, number> = { l: 0, in: 1, out: 2, s: 3, h: 4 };

export interface CompiledBinding {
  src: number;
  k: Float32Array;
}

export interface CompiledLayer {
  spawn: CompiledBinding[];
  speed: CompiledBinding[];
  alpha: CompiledBinding[];
}

export interface CompiledOverlay {
  kind: OverlayKind;
  rest: number;
  max: number;
  add: CompiledBinding[];
}

export interface CompiledResponse {
  layers: Partial<Record<ParticleKind, CompiledLayer>>;
  overlays: Partial<Record<OverlayKind, CompiledOverlay>>;
  windX: CompiledBinding[];
  windY: CompiledBinding[];
  glow: CompiledBinding[];
  dim: CompiledBinding[];
  bloomEmit: { kind: ParticleKind; n: number } | null;
}

/** Compile a curve once to [x, y, segCode] triples. */
export function compileCurve(curve: Curve): Float32Array {
  const k = new Float32Array(curve.length * 3);
  curve.forEach(([x, y, seg], i) => {
    k[i * 3] = x;
    k[i * 3 + 1] = y;
    k[i * 3 + 2] = SEG[seg ?? 'l'];
  });
  return k;
}

const compileList = (list: readonly Binding[] | undefined): CompiledBinding[] =>
  (list ?? []).map(([src, curve]) => ({ src: SRC[src], k: compileCurve(curve) }));

const cache = new Map<ThemeId, CompiledResponse>();

/** The compiled response of a world (compiled on first use, then cached). */
export function compiledResponse(id: ThemeId): CompiledResponse {
  const hit = cache.get(id);
  if (hit) return hit;
  const r = responses[id] ?? responses.base;
  const layers: Partial<Record<ParticleKind, CompiledLayer>> = {};
  for (const [kind, lr] of Object.entries(r.layers ?? {}) as [ParticleKind, LayerResponse][]) {
    layers[kind] = { spawn: compileList(lr.spawn), speed: compileList(lr.speed), alpha: compileList(lr.alpha) };
  }
  const overlays: Partial<Record<OverlayKind, CompiledOverlay>> = {};
  for (const [kind, or] of Object.entries(r.overlays ?? {}) as [OverlayKind, OverlayResponse][]) {
    overlays[kind] = { kind, rest: or.rest, max: or.max ?? 1, add: compileList(or.add) };
  }
  const out: CompiledResponse = {
    layers,
    overlays,
    windX: compileList(r.windX),
    windY: compileList(r.windY),
    glow: compileList(r.glow),
    dim: compileList(r.dim),
    bloomEmit: r.bloomEmit ?? null,
  };
  cache.set(id, out);
  return out;
}

/** Zero-allocation curve evaluation (spec section 2, verbatim). */
export function evalCurve(k: Float32Array, x: number): number {
  const n = k.length / 3;
  if (x <= k[0]) return k[1];
  if (x >= k[(n - 1) * 3]) return k[(n - 1) * 3 + 1];
  let i = 0;
  while (x > k[(i + 1) * 3]) i++;
  const x0 = k[i * 3], y0 = k[i * 3 + 1], s = k[i * 3 + 2], x1 = k[(i + 1) * 3], y1 = k[(i + 1) * 3 + 1];
  if (s === 4) return y0;
  let t = (x - x0) / (x1 - x0);
  if (s === 1) t *= t;
  else if (s === 2) t = 1 - (1 - t) * (1 - t);
  else if (s === 3) t = t * t * (3 - 2 * t);
  return y0 + (y1 - y0) * t;
}

/**
 * Product of MUL bindings. `scale` (quality tier response scale) shrinks each
 * factor's deviation from 1; affinity and idle are never scaled (they are the
 * world's level, not an event response).
 */
export function mulOf(list: CompiledBinding[], src: Float32Array, scale: number): number {
  let v = 1;
  for (let i = 0; i < list.length; i++) {
    const bnd = list[i];
    const f = evalCurve(bnd.k, src[bnd.src]);
    v *= bnd.src === SRC.affinity || bnd.src === SRC.idle ? f : 1 + (f - 1) * scale;
  }
  return v;
}

/** Sum of ADD bindings, the event deviations scaled like mulOf. */
export function addOf(list: CompiledBinding[], src: Float32Array, scale: number): number {
  let v = 0;
  for (let i = 0; i < list.length; i++) {
    const bnd = list[i];
    const f = evalCurve(bnd.k, src[bnd.src]);
    v += bnd.src === SRC.affinity || bnd.src === SRC.idle ? f : f * scale;
  }
  return v;
}

/** The add-list with gust bindings multiplied by the gust direction (windX). */
export function windOf(list: CompiledBinding[], src: Float32Array, scale: number, gustDir: number): number {
  let v = 0;
  for (let i = 0; i < list.length; i++) {
    const bnd = list[i];
    const f = evalCurve(bnd.k, src[bnd.src]);
    // Gust curves are authored blowing left (toward her): flip them with gustDir.
    v += (bnd.src === SRC.gust ? -f * gustDir : f) * (bnd.src === SRC.affinity || bnd.src === SRC.idle ? 1 : scale);
  }
  return v;
}
