/*
  Hanami (shrine maiden, sakura world): rendered effect set, v6.

  Every clip is a stacked-alpha H.264 file (colour in the top half, alpha as luma in the
  bottom half) under public/fx/hanami/, made by AI image-to-video from painted stills on
  black and encoded with the luma alpha mode (all of it is emissive or lit: petals,
  lantern glow, a lit branch). Frame rate 24. `duration` and `loopDelay` are milliseconds,
  after Discord's profile-effect layer schema.

    intro   one-shot, 5.08 s: a storm of petals sweeps across the frame, the vortex slows
            and the petals settle into a cherry branch that blooms along the left edge and
            the top. Its last frame is the first frame of `frame`.
    loop    seamless, 4.54 s: petals drift down, paper lanterns sway and their light
            breathes.
    frame   seamless, 4.54 s: the cherry branch with blossoms around the border and an
            empty middle, swaying in a breeze, a wish slip fluttering on its red thread.
    ring    seamless, 4.54 s, square: a ring of whirling petals around an empty centre for
            the avatar.
    words   seamless, 4.54 s, 2x2 atlas, 400 px tiles with a 10% empty margin per tile:

              [0,0] a blossom bursting open       [1,0] a wish slip fluttering on red thread
              [0,1] a lantern bobbing, glowing    [1,1] petals swirling

  Her tagged phrases are the {hanami:...} tags in src/data/characters.ts, byte for byte:
    "ask for"  -> the wish slip on its thread
    "blush"    -> the blossom bursting open
    "fate"     -> the swirl of petals
  The lantern cell [0,1] is the atlas' fourth motif; no tag maps to it yet.
*/
import type { CharacterFx } from '../types';

const BASE = '/fx/hanami';

export const hanamiFx: CharacterFx = {
  id: 'hanami',
  intro: {
    src: `${BASE}/intro.mp4`,
    poster: `${BASE}/intro-poster.jpg`,
    loop: false,
    duration: 5083,
    zIndex: 110,
  },
  loop: {
    src: `${BASE}/loop.mp4`,
    poster: `${BASE}/loop-poster.jpg`,
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 100,
  },
  frame: {
    src: `${BASE}/frame.mp4`,
    poster: `${BASE}/frame-poster.jpg`,
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 105,
  },
  ring: {
    src: `${BASE}/ring.mp4`,
    poster: `${BASE}/ring-poster.jpg`,
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 100,
  },
  words: {
    src: `${BASE}/words.mp4`,
    poster: `${BASE}/words-poster.jpg`,
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 120,
    cols: 2,
    rows: 2,
    gutter: 0.1,
    cells: {
      blush: [0, 0],
      'ask for': [1, 0],
      fate: [1, 1],
    },
  },
};

export default hanamiFx;
