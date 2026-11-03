import type { CharacterFx } from '../types';

/**
 * Nerissa, rendered motion (v6). Clips are stacked-alpha H.264 (colour on top, alpha as luma below)
 * made from fal Kling image-to-video renders of painted plates:
 *   intro  a wave sheet crashes across the frame and withdraws, one shot, keyed on flat magenta.
 *   loop   caustic light, rising bubbles, drifting kelp, seamless, luma-keyed (emissive).
 *   frame  a foaming water border with pearls over an empty middle, seamless, magenta key.
 *   ring   a pearl-studded water ring around the avatar (empty circular centre), seamless, magenta key.
 *   words  2x2 atlas, seamless, magenta key, motifs sit in the middle of each cell with a gutter:
 *          [0,0] a pearl rolling and glowing      [1,0] a wave curling and tugging
 *          [0,1] bubbles bursting upward          [1,1] a shell opening on a pearl
 * `gutter` is the fraction of one cell left empty between motifs. Durations are in milliseconds.
 */
export const nerissa: CharacterFx = {
  id: 'nerissa',
  intro: { src: '/fx/nerissa/intro.mp4', loop: false, duration: 4208, zIndex: 110 },
  loop: { src: '/fx/nerissa/loop.mp4', loop: true, duration: 4542, loopDelay: 0, zIndex: 100 },
  frame: { src: '/fx/nerissa/frame.mp4', loop: true, duration: 4542, loopDelay: 0, zIndex: 90 },
  ring: { src: '/fx/nerissa/ring.mp4', loop: true, duration: 4542, loopDelay: 0, zIndex: 95 },
  words: {
    src: '/fx/nerissa/words.mp4',
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 120,
    cols: 2,
    rows: 2,
    gutter: 0.1,
    cells: {
      you: [0, 0],
      'pull you nearer': [1, 0],
      breathless: [0, 1],
      'keep herself': [1, 1],
    },
  },
};

export default nerissa;
