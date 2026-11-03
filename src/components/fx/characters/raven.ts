/* Raven (goth bassist): a scythe, stage smoke, a black feather, magenta stage light.
   Five rendered stacked-alpha clips in public/fx/raven/, every one painted and animated on flat
   chroma green and keyed (her steel, feathers and wire are dark solids, so brightness keying would
   ghost them). Each poster is the clip's first frame as a transparent WebP (not stacked); the
   intro's is empty because the intro fades in from nothing. Durations are milliseconds, as in
   Discord's layer schema.
     intro   a 3D scythe slashes down across the frame on a diagonal and leaves it, its magenta arc
             hangs in the air, the smoke band it cut splits and drifts apart
     loop    stage smoke rolling along the bottom, dust in a slanting spotlight, a feather tumbling
     frame   barbed wire and crow feathers round the edges, empty middle
     ring    barbed-wire and crow-feather avatar ring, a scythe blade over the top, magenta smoke
     words   2x2 atlas, each motif inset 0.083 of its cell from every edge, edges feathered clear:
               [0,0] blade arc cutting (spare: no tagged phrase uses it)
               [1,0] feather rocking down   <- soft she gets
               [0,1] smoke curling          <- cigarette smoke
               [1,1] lipstick kiss mark     <- show you
   The phrase keys are the {raven:...} tags in src/data/characters.ts, byte for byte.
   The shapes mirror src/components/fx/types.ts (the shared player), declared here until it lands. */

type FxLayer = {
  src: string;
  poster?: string;
  loop: boolean;
  duration: number;
  loopDelay?: number;
  zIndex?: number;
};

type FxWordsLayer = FxLayer & {
  cols: number;
  rows: number;
  /** Fraction of a cell left empty at every edge of it. */
  gutter: number;
  cells: Record<string, [col: number, row: number]>;
};

type CharacterFx = {
  id: string;
  intro?: FxLayer;
  loop?: FxLayer;
  frame?: FxLayer;
  ring?: FxLayer;
  words?: FxWordsLayer;
};

const BASE = '/fx/raven/';

function clip(name: string, loop: boolean, duration: number, zIndex: number): FxLayer {
  return { src: `${BASE}${name}.mp4`, poster: `${BASE}${name}.poster.webp`, loop, duration, loopDelay: 0, zIndex };
}

const raven: CharacterFx = {
  id: 'raven',
  intro: clip('intro', false, 5042, 110),
  loop: clip('loop', true, 4542, 100),
  frame: clip('frame', true, 4542, 90),
  ring: clip('ring', true, 4542, 70),
  words: {
    ...clip('words', true, 4542, 80),
    cols: 2,
    rows: 2,
    gutter: 0.08,
    cells: {
      'soft she gets': [1, 0],
      'cigarette smoke': [0, 1],
      'show you': [1, 1],
    },
  },
};

export default raven;
