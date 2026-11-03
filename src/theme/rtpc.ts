/*
  RTPC parameters (game-audio style, RTPC-SPEC.md section 1). Screens write
  raw values into `AtmosphereInputs` (refs, never React state, never CSS
  custom properties); once per frame the engine runs `Rtpc.update`, which
  smooths every parameter with its own follower, turns pulses into decaying
  envelopes, keeps the idle clock and derives the curve sources the per-world
  responses read (typing, pass, like, affinity, idle, gust, bloom).

  Every follower: v += (target - v) * (1 - exp(-dt / tau)), dt clamped.
*/
import type { ParticleKind, ThemeId } from '../data/types';
import { SRC, SRC_COUNT } from './particles/responses';
import { follow } from './particles/tuning';

/** Continuous inputs the atmosphere engine reads in its own frame loop. */
export type AtmosphereParam = 'typing' | 'drag' | 'affinity';
/** One-shot impulses the atmosphere engine reacts to. */
export type AtmospherePulse = 'gust' | 'bloom';

/** What the engine reads each frame. Mutated in place by ThemeProvider, never React state. */
export interface AtmosphereInputs {
  params: Record<AtmosphereParam, number>;
  /** Pulses since the last frame; the engine drains the queue. */
  pulses: { name: AtmospherePulse; strength: number; at: number }[];
  preview: { id: ThemeId | null; sceneSrc: string | null; weight: number };
  /** burst() requests since the last frame (null: the world's first particle kind). */
  bursts: (ParticleKind | null)[];
  /** Bumped by setTheme and by setParam('affinity'): the first affinity after a theme snaps. */
  seq: { theme: number; affinity: number };
  /**
   * The world setTheme asked for, written synchronously (React state follows a
   * moment later): the engine promotes an armed preview of this id at once,
   * even when the screen re-arms the next preview before React re-renders.
   */
  theme: { id: ThemeId; sceneSrc: string | null };
  /** performance.now() of the last API call or pointer/key input (battery tier). */
  lastInputAt: number;
  /** The engine installs this: restarts a sleeping loop (reduced motion, hidden tab). */
  wake: () => void;
}

export function createInputs(): AtmosphereInputs {
  return {
    params: { typing: 0, drag: 0, affinity: follow.affinityDefault },
    pulses: [],
    preview: { id: null, sceneSrc: null, weight: 0 },
    bursts: [],
    seq: { theme: 0, affinity: 0 },
    theme: { id: 'base', sceneSrc: null },
    lastInputAt: 0,
    wake: () => {},
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** The follower step factor for a time constant. */
export const k = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

export class Rtpc {
  /** Curve sources, indexed by SRC. */
  readonly src = new Float32Array(SRC_COUNT);

  typing = 0;
  drag = 0;
  affinity: number = follow.affinityDefault;
  idle = 0;
  gust = 0;
  bloom = 0;
  /** Preview weight, already shaped (0..0.9). */
  previewW = 0;
  /** -1 blows left (toward her), +1 right. */
  gustDir: number = follow.gustDirDefault;

  private idleRaw = 0;
  private gustKick = 0;
  private bloomKick = 0;
  private rawTyping = 0;
  private typingHoldUntil = 0;
  private dragActive = false;
  private dragPeak = 0;
  private releaseAt = -Infinity;
  private releasePeak = 0;
  private themeSeq = -1;
  private affinitySeq = -1;
  private snapAffinity = true;
  private bloomEmitAt = -1;
  private bloomEmitStrength = 0;
  private lastBloomEmit = -Infinity;

  /**
   * Advance one frame. `now` in ms, `dt` in seconds (already clamped by the
   * caller is fine; it is clamped again here). `reduced`: only affinity and
   * the preview weight stay live, every other source reads 0.
   */
  update(now: number, dtIn: number, inputs: AtmosphereInputs, reduced: boolean): void {
    const dt = Math.min(dtIn, follow.maxDt);
    const p = inputs.params;

    // setTheme: a new focus starts calm; the first affinity set after it snaps.
    if (inputs.seq.theme !== this.themeSeq) {
      this.themeSeq = inputs.seq.theme;
      this.snapAffinity = true;
      this.typing = 0;
      this.drag = 0;
      this.idleRaw = 0;
    }

    // Pulses (drained).
    for (let i = 0; i < inputs.pulses.length; i++) {
      const pl = inputs.pulses[i];
      const s = clamp01(pl.strength);
      this.idleRaw = 0;
      if (pl.name === 'gust') {
        this.gustKick = Math.max(this.gustKick, s);
        this.gustDir = this.directionAt(pl.at);
      } else {
        this.bloomKick = Math.max(this.bloomKick, s);
        if (this.bloomEmitAt < 0 || s > this.bloomEmitStrength) {
          this.bloomEmitAt = pl.at + follow.bloomEmitDelayMs;
          this.bloomEmitStrength = s;
        }
      }
    }
    inputs.pulses.length = 0;

    // typing: rising edge resets idle; the falling edge is held so a reply batch does not flicker.
    const rawT = p.typing > 0.5 ? 1 : 0;
    if (rawT && !this.rawTyping) this.idleRaw = 0;
    if (!rawT && this.rawTyping) this.typingHoldUntil = now + follow.typingHoldMs;
    this.rawTyping = rawT;
    const tTarget = rawT || now < this.typingHoldUntil ? 1 : 0;
    this.typing += (tTarget - this.typing) * k(dt, tTarget > this.typing ? follow.typingUp : follow.typingDown);

    // drag: a fast attack toward the finger, a slower ease back.
    const rawD = clamp(p.drag, -1, 1);
    if (Math.abs(rawD) > follow.idleDragReset) {
      this.idleRaw = 0;
      if (!this.dragActive || Math.abs(rawD) > Math.abs(this.dragPeak)) this.dragPeak = rawD;
      this.dragActive = true;
    } else if (this.dragActive) {
      this.dragActive = false;
      this.releaseAt = now;
      this.releasePeak = this.dragPeak;
      this.dragPeak = 0;
    }
    this.drag += (rawD - this.drag) * k(dt, Math.abs(rawD) > Math.abs(this.drag) ? follow.dragUp : follow.dragDown);

    // affinity: tau both ways; the first set after setTheme snaps.
    if (inputs.seq.affinity !== this.affinitySeq) {
      this.affinitySeq = inputs.seq.affinity;
      if (this.snapAffinity) {
        this.affinity = clamp01(p.affinity);
        this.snapAffinity = false;
      }
    }
    // Reduced motion: no glide, the still frame redraws at the new level.
    if (reduced) this.affinity = clamp01(p.affinity);
    else this.affinity += (clamp01(p.affinity) - this.affinity) * k(dt, follow.affinity);

    // idle clock: accumulates clamped dt; after a reset the output glides back down.
    this.idleRaw = Math.min(follow.idleMax, this.idleRaw + dt);
    if (this.idleRaw < this.idle) this.idle += (this.idleRaw - this.idle) * k(dt, follow.idleRelease);
    else this.idle = this.idleRaw;

    // Envelopes.
    this.gustKick *= Math.exp(-dt / follow.gustDecay);
    this.gust += (this.gustKick - this.gust) * k(dt, follow.gustAttack);
    this.bloomKick *= Math.exp(-dt / follow.bloomDecay);
    this.bloom += (this.bloomKick - this.bloom) * k(dt, follow.bloomAttack);

    // Preview weight: w = 0.9 * smoothstep(0.12, 0.95, |d|), then its own follower.
    const pw = inputs.preview.id
      ? follow.previewMax * smoothstep(follow.previewEdge0, follow.previewEdge1, clamp01(Math.abs(inputs.preview.weight)))
      : 0;
    this.previewW += (pw - this.previewW) * k(dt, pw > this.previewW ? follow.previewUp : follow.previewDown);
    if (this.previewW < 1e-3 && pw === 0) this.previewW = 0;

    // Curve sources.
    const s = this.src;
    s[SRC.affinity] = this.affinity;
    if (reduced) {
      s[SRC.typing] = 0;
      s[SRC.pass] = 0;
      s[SRC.like] = 0;
      s[SRC.idle] = 0;
      s[SRC.gust] = 0;
      s[SRC.bloom] = 0;
      return;
    }
    const dz = follow.dragDeadZone;
    s[SRC.typing] = this.typing;
    s[SRC.pass] = smoothstep(0, 1, (-this.drag - dz) / (1 - dz));
    s[SRC.like] = smoothstep(0, 1, (this.drag - dz) / (1 - dz));
    s[SRC.idle] = this.idle;
    s[SRC.gust] = this.gust;
    s[SRC.bloom] = this.bloom;
  }

  /** Mark input from burst(): the idle clock resets. */
  touch(): void {
    this.idleRaw = 0;
  }

  /**
   * The bloom emit strength due this frame (0 when none). Emits have a
   * cooldown; `defer` (the UI colour tween is running) keeps it pending.
   */
  takeBloomEmit(now: number, defer: boolean): number {
    if (this.bloomEmitAt < 0 || now < this.bloomEmitAt || defer) return 0;
    const s = this.bloomEmitStrength;
    this.bloomEmitAt = -1;
    this.bloomEmitStrength = 0;
    if (now - this.lastBloomEmit < follow.bloomCooldownMs) return 0;
    this.lastBloomEmit = now;
    return s;
  }

  /** Gust direction: the side a recent hard swipe went, else toward her (left). */
  private directionAt(at: number): number {
    const peak = this.dragActive
      ? this.dragPeak
      : at - this.releaseAt <= follow.gustDirWindowMs
        ? this.releasePeak
        : 0;
    return Math.abs(peak) >= follow.gustDirPeak ? Math.sign(peak) : follow.gustDirDefault;
  }
}
