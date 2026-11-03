/*
  Clementine's v6 rendered effect set. Signature: sunflowers, honey, butterflies, golden-hour dust.
  Palette: honey #2A1B08 / #F2B33D / butter yellow.

  Files (public/fx/clementine/, stacked-alpha H.264, colour top half, alpha-as-luma bottom half;
  each has a transparent first-frame <clip>.poster.png):
    intro.mp4   450x800, 5.04 s, plays once. A bouquet bursts and a flock of butterflies explodes
                outward to fill the whole frame, trailing golden pollen, while a sun flare blooms.
                Two composited passes: butterflies on flat magenta (chroma key), flare and pollen on
                black (luma). The last 0.6 s fades to empty.
    loop.mp4    450x800, 4.54 s seamless. A wheat field swaying strongly along the bottom edge,
                butterflies flitting (magenta key) under a drifting sunbeam with dust motes (luma).
    frame.mp4   450x800, 24 fps, 4.54 s seamless. Sunflower and vine border swaying in a breeze,
                butterflies flapping, empty middle (magenta key).
    ring.mp4    360x360, seamless. Sunflower and vine wreath with an empty circular centre for
                her avatar (magenta key).
    words.mp4   640x640 atlas, 2x2 cells of 320 px, seamless (magenta key). Each motif sits in
                about 55% of its cell, so the 0.1 gutter keeps motion inside its cell:
                  [0,0] a butterfly landing        <- {clementine:turn up}
                  [1,0] honey dripping and pooling <- {clementine:what you crave}
                  [0,1] flour dust puffing         <- {clementine:last slice}
                  [1,1] a sunflower turning        <- {clementine:fuss over you}

  The cell keys are her tagged phrases in src/data/characters.ts, byte for byte (the player
  lower-cases them, and they already are lower case). duration 0 = play each clip at its own
  length, because the seamless loops are 4.54 s after the head/tail crossfade.
*/
import { defineCharacterFx } from '../types';

export default defineCharacterFx(
  'clementine',
  {
    cols: 2,
    rows: 2,
    gutter: 0.1,
    cells: {
      'turn up': [0, 0],
      'what you crave': [1, 0],
      'last slice': [0, 1],
      'fuss over you': [1, 1],
    },
  },
  { duration: 0 }
);
