/*
  Motion constants (the one place besides tokens.css that may hold motion
  numbers). Durations are in SECONDS, the unit `motion` takes; `durMs` mirrors
  them in milliseconds for timers. Anything above 300ms is marked deliberate.

  Bands: quick 150ms (press, chips), base 250ms (bubbles, sheets in), slow
  300ms (tab cross-fade), deliberate 500ms (chat push, shared avatar morph,
  match entrance), theme 700ms (atmosphere cross-fade, color tween).
  Springs only on transform (x, y, scale, rotate), never opacity or color.
*/
import type { BezierDefinition, Transition } from 'motion/react';

export const ease = {
  /** Entrances: emphasized decelerate. */
  enter: [0.05, 0.7, 0.1, 1] as BezierDefinition,
  /** Exits: standard accelerate. */
  exit: [0.3, 0, 1, 1] as BezierDefinition,
  /** Continuous, non-directional movement: standard. */
  continuous: [0.2, 0, 0, 1] as BezierDefinition,
} as const;

export const dur = {
  quick: 0.15,
  base: 0.25,
  slow: 0.3,
  deliberate: 0.5 /* deliberate */,
  theme: 0.7 /* deliberate */,
} as const;

export const durMs = {
  quick: 150,
  base: 250,
  slow: 300,
  deliberate: 500 /* deliberate */,
  theme: 700 /* deliberate */,
} as const;

/** Reduced motion: theme changes may still fade, for at most this long. */
export const reducedFade = dur.quick;

export const spring = {
  snappy: { type: 'spring', stiffness: 320, damping: 30 },
  gentle: { type: 'spring', stiffness: 170, damping: 26 },
  /** Only for the match-moment avatar pop. */
  playful: { type: 'spring', stiffness: 220, damping: 14 },
} as const satisfies Record<string, Transition>;

/** No movement at all: what every moving animation becomes under reduced motion. */
export const instant: Transition = { duration: 0 };

/**
 * How long she "types" before a reply lands (randomised between the two).
 * At least 1200ms so the atmosphere's typing response is visible (RTPC rules).
 */
export const typingDelayMs = {
  min: 1200 /* deliberate */,
  max: 2200 /* deliberate */,
} as const;

/**
 * Atmosphere impulse strengths (BRIEF "RTPC integration rules"). Screens own
 * WHEN to pulse; the theme engine owns how each world responds.
 * - send: gust 0.5 + min(0.5, chars / 120), capped at 0.6 when more than
 *   2 sends land within 3s
 * - her reply: bloom 1 for the first message of a batch, 0.4 for later ones,
 *   0.6 when the message has 3 words or fewer
 * - a card committed off the deck: gust 0.6..1
 * - leaving a chat parks affinity at 0.55
 */
export const pulseStrength = {
  sendBase: 0.5,
  sendMaxExtra: 0.5,
  sendCharsForMax: 120,
  sendBurstCap: 0.6,
  sendBurstCount: 2,
  sendBurstWindowMs: 3000,
  bloomFirst: 1,
  bloomLater: 0.4,
  bloomShort: 0.6,
  bloomShortWords: 3,
  cardCommit: 0.8,
  affinityAtRest: 0.55,
  affinityMessagesForMax: 40,
} as const;

/** The match-moment avatar pops in from this scale (playful spring). */
export const matchPopFrom = 0.6;

/**
 * The chance a right swipe is an INSTANT match (her opener is already in the
 * chat and the "You Matched!" modal shows). Otherwise the like becomes a
 * pending match that resolves after `matchDelayMs`. The very first like ever
 * is always instant; the `?instant=1|0` URL hook overrides the roll.
 */
export const instantMatchChance = 0.3;

/** How long a non-instant like waits before the match resolves (randomised). */
export const matchDelayMs = {
  min: 5000 /* deliberate */,
  max: 30000 /* deliberate */,
} as const;

/** How long after her reply the clip video message arrives. */
export const clipDelayMs = 1500 /* deliberate */;

/** How long "<Name> matched with you" stays up (one at a time). */
export const matchToastMs = 5000 /* deliberate */;

/** The locked Chats tab: a short horizontal nudge, then a hint bubble. */
export const lockedTab = {
  nudgeX: 6,
  nudgeS: dur.quick,
  hintMs: 2000 /* deliberate */,
} as const;

/**
 * The tab bar's liquid lens: it stretches along its direction of travel by
 * its own speed (px/s), up to `maxStretch`, and squashes a little across it.
 */
export const lens = {
  speedForMax: 1800,
  maxStretch: 0.32,
  squash: 0.35,
  pressScale: 0.96,
} as const;
