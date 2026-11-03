/* Isolde (Queen of the Frost March, frost world): frost ferns, ice crystals, cold light, snow.
   Palette glacier #06131C / #B8E4F2 / moon white. Five rendered stacked-alpha H.264 clips in
   public/fx/isolde/ (colour in the top half, alpha as luma in the bottom half), 24 fps, every
   frame freshly rendered by an AI image-to-video pass from a painted still. Her ice is solid and
   translucent, so every clip with ice in it was painted and animated on a flat chroma green and
   keyed (key 02A73F); only the cold glow, the snow and the breath steam stay on black with luma
   alpha. Each poster is the clip's first frame as a transparent PNG (not stacked); the intro's
   shows the first sliver of frost. `duration` and `loopDelay` are milliseconds, after Discord's
   profile-effect layer schema.
     intro   one-shot, 5.83 s: frost races in from every edge, ferns and crystals crawl faster
             until the whole frame is frozen under glacier ice, hairline cracks run out from the
             centre, then the ice shatters and the pieces fall away, leaving the frame clear.
     loop    seamless, 4.54 s: snow drifting at three depths, two wisps of breath steam curling up
             from the lower third, crystals glinting on and off. Empty centre.
     frame   seamless, 4.54 s: a frozen crystalline border, icicles along the top, crystal
             clusters in the corners, light travelling over the facets. Empty middle.
     ring    seamless, 4.54 s, square: a ring of frost ferns and crystals round an empty circle
             for her avatar, crystals and icicles breaking out past its edge.
     words   seamless, 4.54 s, 2x2 atlas of 16:9 tiles, each motif inset 0.083 of its tile from
             every edge with the edge feathered clear:
               [0,0] frost ferns crawling across    [1,0] ice shards growing up
               [0,1] a cold flare pulsing           [1,1] snowflakes drifting down and settling
   Her tagged phrases are the {isolde:...} tags in src/data/characters.ts, byte for byte:
     "warm her hands" -> the cold flare (light, not heat: the glow a hand throws on frost)
     "worth hearing"  -> frost crawling over the word (a hush settling)
     "ice breaks"     -> the shards forming
     "melt"           -> the snowflake settling (it lands, and is gone)
   The shapes are src/components/fx/types.ts (the shared player). */
import type { CharacterFx } from '../types';

const BASE = '/fx/isolde';

const isolde: CharacterFx = {
  id: 'isolde',
  intro: {
    src: `${BASE}/intro.mp4`,
    poster: `${BASE}/intro.poster.png`,
    loop: false,
    duration: 5833,
    zIndex: 110,
  },
  loop: {
    src: `${BASE}/loop.mp4`,
    poster: `${BASE}/loop.poster.png`,
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 100,
  },
  frame: {
    src: `${BASE}/frame.mp4`,
    poster: `${BASE}/frame.poster.png`,
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 90,
  },
  ring: {
    src: `${BASE}/ring.mp4`,
    poster: `${BASE}/ring.poster.png`,
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 70,
  },
  words: {
    src: `${BASE}/words.mp4`,
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 80,
    cols: 2,
    rows: 2,
    gutter: 0.1,
    cells: {
      'warm her hands': [0, 1],
      'worth hearing': [0, 0],
      'ice breaks': [1, 0],
      melt: [1, 1],
    },
  },
};

export default isolde;
