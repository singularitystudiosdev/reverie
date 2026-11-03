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

/** Chats list rows stagger in once on first mount. */
export const stagger = {
  step: 0.04,
  maxRows: 8,
} as const;

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

/** The chat push moves the outgoing list this far to the left. */
export const pushBackX = '-25%';

/** The match-moment avatar pops in from this scale (playful spring). */
export const matchPopFrom = 0.6;
