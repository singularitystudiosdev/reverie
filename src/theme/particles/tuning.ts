/*
  Simulation constants of the atmosphere engine (RTPC-SPEC.md sections 1, 2, 4,
  6 and 7). These are physics and scheduling numbers, not design values: the
  brief exempts src/theme/particles/** from the token rule, so every number the
  engine, the parameter followers and the population model use lives here.
*/

/** Follower time constants (seconds). tau = T99.5 / 5.3 (Wwise "Filtering Over time"). */
export const follow = {
  /** Every follower clamps its step to this (seconds), so a tab return never jumps. */
  maxDt: 0.05,
  typingUp: 0.35,
  typingDown: 0.9,
  /** The typing falling edge is held this long (ms) so a reply batch with gaps does not flicker. */
  typingHoldMs: 400,
  dragUp: 0.06,
  dragDown: 0.25,
  affinity: 1.2,
  affinityDefault: 0.55,
  /** Idle clock range (seconds) and the glide back after a reset. */
  idleMax: 60,
  idleRelease: 1.2,
  /** abs(drag) above this counts as input for the idle clock. */
  idleDragReset: 0.05,
  gustDecay: 0.9,
  gustAttack: 0.06,
  /** Gusts within this window (ms) coalesce (max). */
  gustCoalesceMs: 400,
  bloomAttack: 0.2,
  bloomDecay: 1.8,
  /** Bloom particles start this long (ms) after the pulse. */
  bloomEmitDelayMs: 120,
  /** Bloom emit cooldown (ms). */
  bloomCooldownMs: 2500,
  /** Bloom emit duration (ms): particles come out of (0.5, 0.26) over this window. */
  bloomEmitSpanMs: 400,
  previewUp: 0.05,
  previewDown: 0.18,
  previewMax: 0.9,
  previewEdge0: 0.12,
  previewEdge1: 0.95,
  /** Preview particles spawn only above this weight. */
  previewSpawnMin: 0.08,
  /** pass / like dead zone around drag 0. */
  dragDeadZone: 0.08,
  /** A gust within this window (ms) of a drag release with abs(peak) >= gustDirPeak blows that way. */
  gustDirWindowMs: 600,
  gustDirPeak: 0.5,
  /** Default gust direction: toward her, on the left. */
  gustDirDefault: -1,
} as const;

/** Clamps on the combined response values (spec section 2). */
export const clampTo = {
  spawn: [0, 3.5],
  speed: [0.2, 2.2],
  alpha: [0, 1],
  wind: [-0.8, 0.8],
  glow: [0, 0.35],
  dim: [0, 0.4],
  overlay: [0, 1],
} as const;

/** Neutral inputs a preview world evaluates its curves with (spec 4.2). */
export const neutral = {
  affinity: 0.55,
} as const;

/** Crossfades (ms). The theme band itself comes from src/lib/motion.ts. */
export const fade = {
  /** Promotion of an armed preview: max(promoteMinMs, theme * (1 - w0)). */
  promoteMinMs: 120,
  /** Reduced motion: a theme change swaps in at most this long (ms). */
  reducedSwapMs: 150,
  /** Wait this long (ms) for a plate to decode before starting a crossfade anyway. */
  decodeWaitMs: 260,
  /** Groups stacked mid-crossfade before the oldest partial fade is finished at once. */
  maxStack: 3,
  /** During the UI colour tween the engine runs at this share of its cost cap. */
  tweenCostScale: 0.75,
} as const;

/** Population model (spec 2 and 7). */
export const population = {
  /** Density is per 100,000 CSS px^2 of frame area. */
  areaUnit: 100_000,
  /** New particles fade in over this (seconds); no pops. */
  fadeIn: 0.4,
  /** Life-limited particles fade out over their last this-many seconds. */
  fadeOut: 0.6,
  /** Live count grows by at most this many particles per second. */
  growthPerSec: 40,
  /** Pool size (slots): the hard particle cap, and so the drawImage cap per frame. */
  slots: 144,
  /** Per-layer particle caps. */
  layerCap: 48,
  rainLayerCap: 64,
  /** While a preview world is alive: A <= this, B <= previewCost. */
  currentCostWhilePreview: 80,
  previewCost: 40,
  /** A layer below this share of its target spawns inside the field (initial fill). */
  fieldFillShare: 0.6,
  /** Burst size for burst(kind). */
  burstCount: 22,
} as const;

/** Adaptive quality tiers (spec 7). */
export interface Tier {
  hz: number;
  dprCap: number;
  cost: number;
  reserve: number;
  responseScale: number;
  emits: boolean;
  pop: number;
}

export const tiers: readonly Tier[] = [
  { hz: 60, dprCap: 2, cost: 120, reserve: 24, responseScale: 1, emits: true, pop: 1 },
  { hz: 60, dprCap: 1.5, cost: 90, reserve: 16, responseScale: 1, emits: true, pop: 1 },
  { hz: 30, dprCap: 1, cost: 60, reserve: 8, responseScale: 0.6, emits: false, pop: 1 },
];

/** T3 (battery): applied on top of the current tier after this long without input. */
export const battery = {
  afterMs: 90_000,
  hz: 30,
  pop: 0.6,
} as const;

export const tierRules = {
  /** Frame interval EMA above this for downHoldMs moves down a tier. */
  slowFrameMs: 20,
  /** In T1, still above this for downHoldMs moves to T2. */
  slowerFrameMs: 24,
  /** Engine (update + draw) EMA above this moves T0 to T1. */
  engineMs: 5,
  downHoldMs: 1500,
  /** Moving up needs this long stable below upFrameMs. */
  upHoldMs: 20_000,
  upFrameMs: 14,
  /** EMA weight per frame. */
  ema: 0.08,
  storageKey: 'reverie:atm-tier',
  /** Frame intervals above this (ms) are a pause, not a slow frame. */
  ignoreGapMs: 250,
} as const;

/** Overlay opacity writes: at most this often (Hz), only on a change of at least `step`. */
export const writes = {
  overlayHz: 30,
  step: 0.01,
  maxPerFrame: 8,
} as const;

/** Reduced motion: redraw the still frame when affinity moves this far, after this delay. */
export const still = {
  affinityStep: 0.15,
  redrawDelayMs: 400,
  fadeMs: 150,
  /** Deterministic seed for the still frame. */
  seed: 1337,
} as const;

/** Glow wash: a radial light from the top of the frame. */
export const wash = {
  glowCenterX: 0.5,
  glowCenterY: 0.12,
  glowRadius: 0.95,
  /** Light schemes dim with ink at this share of the dark-scheme alpha. */
  lightDimScale: 0.7,
} as const;

/** Bloom emit origin (frame fractions) and burst origin. */
export const origins = {
  bloomX: 0.5,
  bloomY: 0.26,
  burstX: 0.5,
  burstY: 0.5,
} as const;
