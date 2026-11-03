/*
  Cinder, rendered v6 effect set (stacked-alpha H.264 in public/fx/cinder/).

  Palette: ember #1A0805, orange #FF6A1A, white-hot #FFE08A. Every clip is an
  EMISSIVE plate (fire, embers, lava glow) painted on pure black, so all five
  use the `luma` alpha mode; there is no solid subject and nothing is keyed.

    intro  5.2 s, plays once. A wall of fire sweeps in from the left, engulfs
           the whole frame, then recedes to the edges and leaves the empty
           middle (it ends in the loop's pose, so the hand-off is seamless).
    loop   4.5 s, seamless. Flames licking up the edges, embers rising, molten
           cracks pulsing.
    frame  4.5 s, seamless. A thin border of fire and glowing lava veins hugging
           the 9:16 frame, empty middle.
    ring   4.5 s, seamless, square 480x480. A ring of fire around the avatar,
           empty circular centre, flames and sparks breaking out past the edge.
    words  4.5 s, seamless 2x2 atlas, 450x300 cells (900x600 colour half).
           Each motif is inset so a cell keeps a 10% empty margin on every side
           (`gutter` 0.1 of a cell), so motion never crosses a cell edge.
             closer    [0, 0]  heat shimmer
             light up  [1, 0]  a flame igniting
             burn      [0, 1]  a molten crack opening
             dare      [1, 1]  sparks scattering

  Word keys are the {cinder:...} tags in src/data/characters.ts, byte for byte.
  Loop and frame run 24 fps; durations are the clip lengths in milliseconds.
*/
import type { CharacterFx } from '../types';

const cinder: CharacterFx = {
  id: 'cinder',
  intro: {
    src: '/fx/cinder/intro.mp4',
    poster: '/fx/cinder/intro.poster.png',
    loop: false,
    duration: 5208,
    zIndex: 110,
  },
  loop: {
    src: '/fx/cinder/loop.mp4',
    poster: '/fx/cinder/loop.poster.png',
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 100,
  },
  frame: {
    src: '/fx/cinder/frame.mp4',
    poster: '/fx/cinder/frame.poster.png',
    loop: true,
    duration: 4500,
    loopDelay: 0,
    zIndex: 90,
  },
  ring: {
    src: '/fx/cinder/ring.mp4',
    poster: '/fx/cinder/ring.poster.png',
    loop: true,
    duration: 4500,
    loopDelay: 0,
    zIndex: 95,
  },
  words: {
    src: '/fx/cinder/words.mp4',
    loop: true,
    duration: 4500,
    loopDelay: 0,
    zIndex: 80,
    cols: 2,
    rows: 2,
    gutter: 0.1,
    cells: {
      closer: [0, 0],
      'light up': [1, 0],
      burn: [0, 1],
      dare: [1, 1],
    },
  },
};

export default cinder;
