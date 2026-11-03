/*
  Luna's rendered effect set (public/fx/luna/): night sky, a constellation, a crescent moon,
  a black cat, a potion. Five stacked-alpha H.264 clips at 24 fps, celestial palette
  (#0A0F2C midnight, #F2C75C gold, #F3F1FF moonlight).

    intro  a constellation draws itself star to star across the frame (a pen of light
           travels the chain and each star ignites as it arrives), then the moon rises
           behind it and everything fades to the loop (134 frames, plays once)
    loop   twinkling stars, drifting gold dust, the moon's halo breathing (109 frames)
    frame  a constellation and crescent border with three small black cats perched on it,
           empty middle (109 frames)
    ring   a golden constellation ring around her avatar, a spark orbiting it, the crescent
           breaking out past the circle, centre empty (109 frames)
    words  2x2 atlas, each motif kept inside its cell (gutter 0.03, the measured minimum
           margin is 0.031):
             [0,0] five gold stars leaning toward the word      <- lean in
             [1,0] a potion tipping and spilling sparks         <- sweet and dangerous
             [0,1] a crescent moon cradling the word, a black cat
                   peeking over its horn                        <- kept
             [1,1] empty (spare: only three phrases are tagged)

  Alpha per layer: intro, loop, ring and the stars cell are emissive (luma on black).
  The frame's cats are solid navy bodies painted on black and filled by hue plus hole
  closing, so they do not ghost; the potion and moon/cat cells were rendered on flat
  chroma green (00B140) and keyed.

  The phrase keys are the {luna:...} tags in src/data/characters.ts, byte for byte.
  Clip lengths are in milliseconds: the intro is 134 frames, the seamless clips 109.
*/
import { defineCharacterFx } from '../types';

const fx = defineCharacterFx('luna', {
  cols: 2,
  rows: 2,
  gutter: 0.03,
  cells: {
    'lean in': [0, 0],
    'sweet and dangerous': [1, 0],
    kept: [0, 1],
  },
}, { duration: 4542 });

if (fx.intro) fx.intro.duration = 5583;

export default fx;
