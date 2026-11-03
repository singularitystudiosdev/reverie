/*
  Swipe physics for the Explore deck: gesture numbers, not design values, so
  like src/lib/motion.ts they may live as numeric constants. Fold into
  motion.ts when that file is next touched.
*/

export type SwipeDir = 'pass' | 'like';

export const deckConfig = {
  /** A release past this share of the card width commits. */
  commitShare: 0.3,
  /** A release faster than this (px/s), in the direction of travel, commits. */
  flickVelocity: 500,
  /** A flick still needs this much travel (px) so a twitch is not a swipe. */
  flickMinTravel: 24,
  /** Card tilt at one full card width of travel (degrees). */
  maxRotateDeg: 12,
  /** The next card behind the top one, before the top card's drag lifts it. */
  nextScale: 0.94,
  /** The spring aims this many card widths away; the card is gone at `goneShare`. */
  flyTargetShare: 1.7,
  goneShare: 1.2,
  /** Stamps are fully visible this share of the way to the commit point. */
  stampFullAt: 0.9,
  /** Stamps start to show after this share (a tap-sized wobble shows nothing). */
  stampStartAt: 0.12,
  /** Top card entrance (first visit only): rise from this many px. */
  riseY: 24,
  /** The instant-match modal enters from this scale (snappy spring). */
  matchModalFrom: 0.92,
} as const;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
