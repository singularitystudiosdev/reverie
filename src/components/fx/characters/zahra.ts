/*
  Zahra, djinn of the Glass Dunes: rendered FX (v6). Five stacked-alpha clips,
  each built from Kling v2.1 renders of painted stills: glow passes on black
  keyed by luma (smoke, glitter, sand, light) and solid passes on flat green
  keyed by chroma (coins, lanterns, the arch, the crescents), composited into
  one clip per layer; the word atlas tiles four renders.
  Reference: Discord's Void Pumpkins decoration (objects orbiting on comet
  trails) and The Entity profile effect (an intro bursting in from the edges,
  embers hanging in haze), retold in gold smoke, coins and lanterns.

  intro  gold smoke ribbons pour in and coil, coins spin out through the frame
  loop   lanterns swaying on chains, glitter hanging, sand drifting low
  frame  a Moorish gold arch with a coin border and glints, empty middle
  ring   two gold crescents with hanging coins over a glowing smoke ring
  words  2x2 atlas: coins spilling | smoke curling into a heart
                    lantern igniting | glitter bursting (spare cell)
*/

// Inline until src/components/fx/types.ts lands; the FX-V3 UPDATE 2 shape.
type FxLayer = {
  src: string;
  poster?: string;
  loop: boolean;
  duration: number;
  loopDelay?: number;
  zIndex?: number;
};

type CharacterFx = {
  id: string;
  intro?: FxLayer;
  loop?: FxLayer;
  frame?: FxLayer;
  ring?: FxLayer;
  words?: FxLayer & {
    cols: number;
    rows: number;
    gutter: number;
    cells: Record<string, [col: number, row: number]>;
  };
};

const base = '/fx/zahra';

export const zahraFx: CharacterFx = {
  id: 'zahra',
  intro: {
    src: `${base}/intro.mp4`,
    poster: `${base}/intro.poster.png`,
    loop: false,
    duration: 5042,
    loopDelay: 0,
    zIndex: 110,
  },
  loop: {
    src: `${base}/loop.mp4`,
    poster: `${base}/loop.poster.png`,
    loop: true,
    duration: 4000,
    loopDelay: 0,
    zIndex: 100,
  },
  frame: {
    src: `${base}/frame.mp4`,
    poster: `${base}/frame.poster.png`,
    loop: true,
    duration: 4500,
    loopDelay: 0,
    zIndex: 90,
  },
  ring: {
    src: `${base}/ring.mp4`,
    poster: `${base}/ring.poster.png`,
    loop: true,
    duration: 4500,
    loopDelay: 0,
  },
  words: {
    src: `${base}/words.mp4`,
    poster: `${base}/words.poster.png`,
    loop: true,
    duration: 4500,
    loopDelay: 0,
    cols: 2,
    rows: 2,
    // Share of a cell's edge left transparent between neighbours: each 320 px
    // cell holds a 280 px motif with 20 px clear on every side.
    gutter: 0.125,
    // Keys are the {zahra:...} phrases in src/data/characters.ts, byte for byte.
    cells: {
      wants: [0, 0],
      'smoke curl': [1, 0],
      desire: [0, 1],
    },
  },
};

export default zahraFx;
