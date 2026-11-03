/* Maya (citylights): film grain, light leaks, bokeh and a shutter.
   Five rendered stacked-alpha clips in public/fx/maya/ (Kling i2v on gpt-image-2 plates, encoded by
   .tmp/reverie-research/proof/encode.sh). Durations are milliseconds, as in Discord's layer schema.
     intro   solid dark shutter blades (chroma-keyed pass on flat green) snap shut, hold, spring open;
             a luma flash pass floods the whole frame pure white for ~5 frames, then develops back
             in through a warm light leak (4.04s, no loop, last 0.9s fades to transparent)
     loop    bokeh orbs drifting and pulsing, grain crawling, a slow warm leak (luma, emissive)
     frame   film-strip and lens-flare border, empty middle (solid film on flat green, keyed)
     ring    focus-ring avatar decoration, empty circular centre, flares and bokeh outside it
     words   2x2 atlas (cells inset with a gutter, edges feathered to black):
               [0,0] flash popping (spare: no tagged phrase uses it)
               [1,0] light leak sweeping      <- stay in this light
               [0,1] bokeh orbs blooming      <- city blurring gold
               [1,1] focus ring hunting and locking <- hold that look
   The phrase keys are the {maya:...} tags in src/data/characters.ts, byte for byte.
   gutter is a fraction of one cell: 0.12 of empty space between neighbouring cells. */
import type { CharacterFx } from '../types';

const BASE = '/fx/maya/';

export const maya: CharacterFx = {
  id: 'maya',
  intro: { src: `${BASE}intro.mp4`, loop: false, duration: 4042, zIndex: 110 },
  loop: { src: `${BASE}loop.mp4`, loop: true, duration: 4542, loopDelay: 0, zIndex: 100 },
  frame: { src: `${BASE}frame.mp4`, loop: true, duration: 4542, zIndex: 90 },
  ring: { src: `${BASE}ring.mp4`, loop: true, duration: 4542, zIndex: 100 },
  words: {
    src: `${BASE}words.mp4`,
    loop: true,
    duration: 4542,
    zIndex: 120,
    cols: 2,
    rows: 2,
    gutter: 0.12,
    cells: {
      'stay in this light': [1, 0],
      'city blurring gold': [0, 1],
      'hold that look': [1, 1],
    },
  },
};

export default maya;
