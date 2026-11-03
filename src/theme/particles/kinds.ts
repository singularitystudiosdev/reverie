/*
  Particle kinds: the constant table (cost, wind susceptibility, inertia,
  sprite size, variants, animation frames) and the per-kind natural motion.
  Simulation numbers (brief exemption for src/theme/particles/**).

  Units: CSS px and seconds. Each particle stores its OWN motion at speed 1;
  the layer's speed multiplier scales it per frame, wind is added on top
  through a per-particle velocity that relaxes toward the wind target with
  the kind's inertia (RTPC-SPEC section 2, "Engine constant tables").
*/
import type { ParticleKind } from '../../data/types';

export type Motion = 'fall' | 'rise' | 'float' | 'cross' | 'streak';

export interface KindDef {
  kind: ParticleKind;
  code: number;
  /** Cost units (spec 7): sprite 1; bokeh, steam 2; sparkle 0.7; star 0.5; rain 0.4. */
  cost: number;
  /** Wind susceptibility (spec 2). */
  sus: number;
  /** Wind applies on x only (bubble). */
  windXOnly: boolean;
  /** Velocity inertia toward the wind target, seconds. */
  tau: number;
  /** Sprite box in CSS px at size 1 (longest side). Bokeh may reach 90, the rest stay <= 64. */
  px: number;
  /** Sprite aspect (height / width); the streak and the rain are wide or tall. */
  aspect: number;
  variants: number;
  frames: number;
  /** Where new particles enter in steady state. */
  motion: Motion;
  /** Drawn with additive light. */
  additive: boolean;
  /** Lifetime range (s); Infinity-like for kinds that only die off-frame. */
  life: readonly [number, number];
  /** Dormant time before (re)appearing (s): sparse kinds such as bats and shooting stars. */
  delay: readonly [number, number];
  /** Base alpha range. */
  alpha: readonly [number, number];
}

const FOREVER = [1e9, 1e9] as const;
const NONE = [0, 0] as const;

function def(kind: ParticleKind, code: number, d: Omit<KindDef, 'kind' | 'code'>): KindDef {
  return { kind, code, ...d };
}

export const K = {
  leaf: 0, maple: 1, petal: 2, rose: 3, ember: 4, snow: 5, bubble: 6, star: 7,
  shootingStar: 8, bat: 9, rain: 10, firefly: 11, sand: 12, wisp: 13, bokeh: 14,
  butterfly: 15, glyph: 16, pollen: 17, feather: 18, gear: 19, steam: 20, sparkle: 21,
} as const satisfies Record<ParticleKind, number>;

export const kinds: Record<ParticleKind, KindDef> = {
  leaf: def('leaf', K.leaf, { cost: 1, sus: 1, windXOnly: false, tau: 0.35, px: 32, aspect: 1, variants: 3, frames: 1, motion: 'fall', additive: false, life: FOREVER, delay: NONE, alpha: [0.75, 1] }),
  maple: def('maple', K.maple, { cost: 1, sus: 1, windXOnly: false, tau: 0.35, px: 34, aspect: 1, variants: 2, frames: 1, motion: 'fall', additive: false, life: FOREVER, delay: NONE, alpha: [0.8, 1] }),
  petal: def('petal', K.petal, { cost: 1, sus: 1, windXOnly: false, tau: 0.35, px: 18, aspect: 1, variants: 2, frames: 1, motion: 'fall', additive: false, life: FOREVER, delay: NONE, alpha: [0.75, 1] }),
  rose: def('rose', K.rose, { cost: 1, sus: 0.9, windXOnly: false, tau: 0.35, px: 22, aspect: 1, variants: 2, frames: 1, motion: 'fall', additive: false, life: FOREVER, delay: NONE, alpha: [0.8, 1] }),
  ember: def('ember', K.ember, { cost: 1, sus: 0.5, windXOnly: false, tau: 0.35, px: 18, aspect: 1, variants: 1, frames: 1, motion: 'rise', additive: true, life: [3, 6.5], delay: NONE, alpha: [0.7, 1] }),
  snow: def('snow', K.snow, { cost: 1, sus: 0.7, windXOnly: false, tau: 0.35, px: 14, aspect: 1, variants: 3, frames: 1, motion: 'fall', additive: false, life: FOREVER, delay: NONE, alpha: [0.6, 1] }),
  bubble: def('bubble', K.bubble, { cost: 1, sus: 0.35, windXOnly: true, tau: 0.5, px: 22, aspect: 1, variants: 1, frames: 1, motion: 'rise', additive: false, life: FOREVER, delay: NONE, alpha: [0.6, 0.95] }),
  star: def('star', K.star, { cost: 0.5, sus: 0, windXOnly: false, tau: 0.35, px: 12, aspect: 1, variants: 2, frames: 1, motion: 'float', additive: true, life: FOREVER, delay: NONE, alpha: [0.55, 1] }),
  shootingStar: def('shootingStar', K.shootingStar, { cost: 1, sus: 0, windXOnly: false, tau: 0.35, px: 64, aspect: 0.125, variants: 1, frames: 1, motion: 'streak', additive: true, life: [0.7, 1.1], delay: [2.5, 9], alpha: [0.85, 1] }),
  bat: def('bat', K.bat, { cost: 1, sus: 0.3, windXOnly: false, tau: 0.35, px: 42, aspect: 0.6, variants: 1, frames: 2, motion: 'cross', additive: false, life: FOREVER, delay: [0.5, 5], alpha: [0.85, 1] }),
  rain: def('rain', K.rain, { cost: 0.4, sus: 0.2, windXOnly: false, tau: 0.1, px: 0, aspect: 1, variants: 1, frames: 1, motion: 'fall', additive: false, life: FOREVER, delay: NONE, alpha: [0.25, 0.6] }),
  firefly: def('firefly', K.firefly, { cost: 1, sus: 0.4, windXOnly: false, tau: 0.35, px: 22, aspect: 1, variants: 1, frames: 1, motion: 'float', additive: true, life: [8, 16], delay: NONE, alpha: [0.75, 1] }),
  sand: def('sand', K.sand, { cost: 1, sus: 1.2, windXOnly: false, tau: 0.35, px: 6, aspect: 1, variants: 1, frames: 1, motion: 'cross', additive: false, life: FOREVER, delay: NONE, alpha: [0.5, 0.95] }),
  wisp: def('wisp', K.wisp, { cost: 1, sus: 0.6, windXOnly: false, tau: 0.35, px: 34, aspect: 1.4, variants: 1, frames: 1, motion: 'rise', additive: true, life: [4, 8], delay: NONE, alpha: [0.7, 1] }),
  bokeh: def('bokeh', K.bokeh, { cost: 2, sus: 0.1, windXOnly: false, tau: 0.35, px: 64, aspect: 1, variants: 1, frames: 1, motion: 'float', additive: false, life: [10, 20], delay: NONE, alpha: [0.35, 0.75] }),
  butterfly: def('butterfly', K.butterfly, { cost: 1, sus: 0.5, windXOnly: false, tau: 0.35, px: 28, aspect: 0.85, variants: 1, frames: 2, motion: 'float', additive: false, life: [12, 22], delay: NONE, alpha: [0.9, 1] }),
  glyph: def('glyph', K.glyph, { cost: 1, sus: 0.05, windXOnly: false, tau: 0.35, px: 20, aspect: 1, variants: 10, frames: 1, motion: 'fall', additive: true, life: [6, 12], delay: NONE, alpha: [0.5, 0.9] }),
  pollen: def('pollen', K.pollen, { cost: 1, sus: 0.8, windXOnly: false, tau: 0.35, px: 8, aspect: 1, variants: 1, frames: 1, motion: 'float', additive: true, life: [6, 12], delay: NONE, alpha: [0.5, 0.95] }),
  feather: def('feather', K.feather, { cost: 1, sus: 1.1, windXOnly: false, tau: 0.35, px: 46, aspect: 1, variants: 2, frames: 1, motion: 'fall', additive: false, life: FOREVER, delay: NONE, alpha: [0.8, 1] }),
  gear: def('gear', K.gear, { cost: 1, sus: 0.15, windXOnly: false, tau: 0.35, px: 56, aspect: 1, variants: 2, frames: 1, motion: 'float', additive: false, life: [14, 26], delay: NONE, alpha: [0.3, 0.55] }),
  steam: def('steam', K.steam, { cost: 2, sus: 0.9, windXOnly: false, tau: 0.35, px: 60, aspect: 1, variants: 2, frames: 1, motion: 'rise', additive: false, life: [4, 7.5], delay: NONE, alpha: [0.3, 0.55] }),
  sparkle: def('sparkle', K.sparkle, { cost: 0.7, sus: 0.1, windXOnly: false, tau: 0.35, px: 18, aspect: 1, variants: 1, frames: 1, motion: 'float', additive: true, life: [1.2, 2.8], delay: NONE, alpha: [0.75, 1] }),
};

export const kindByCode: KindDef[] = Object.values(kinds).sort((a, b) => a.code - b.code);
