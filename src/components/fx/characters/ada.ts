/*
  Ada's rendered FX (v6). Brass and steam: a gear assembly slams in from the
  right edge, a piston blasts steam across the frame, and the intro ends on the
  exact still the loop starts from, so the hand-off has no seam. Solid brass is
  keyed off flat chroma green (green-difference key, so steam keeps soft
  edges); the sparks cell is emissive on black and keyed by luma.

  The shapes are declared here until the shared player's types.ts lands in
  this tree; they match its FxLayer / FxWordsLayer / CharacterFx field for field.
*/

interface FxLayer {
  src: string;
  poster?: string;
  loop: boolean;
  duration: number;
  loopDelay?: number;
  zIndex?: number;
}

type FxWordsLayer = FxLayer & {
  cols: number;
  rows: number;
  gutter: number;
  cells: Record<string, [number, number]>;
  scale?: number;
};

interface CharacterFx {
  id: string;
  intro?: FxLayer;
  loop?: FxLayer;
  frame?: FxLayer;
  ring?: FxLayer;
  words?: FxWordsLayer;
}

const base = '/fx/ada';

/** duration 0: each clip runs its own length (intro 4.67 s, the loops 4.54 s). */
const clip = (name: string, loop: boolean, zIndex: number): FxLayer => ({
  src: `${base}/${name}.mp4`,
  poster: `${base}/${name}.poster.png`,
  loop,
  duration: 0,
  loopDelay: 0,
  zIndex,
});

const ada: CharacterFx = {
  id: 'ada',
  intro: clip('intro', false, 110),
  loop: clip('loop', true, 100),
  frame: clip('frame', true, 90),
  ring: clip('ring', true, 70),
  words: {
    ...clip('words', true, 80),
    cols: 2,
    rows: 2,
    gutter: 0.1,
    // Keys are her bio's {ada:...} phrases, byte for byte.
    cells: {
      problem: [0, 0], // a cogwheel turning
      'steady hands': [1, 0], // a wrench striking a nut, sparks on impact
      welding: [0, 1], // white-hot sparks spraying
      'engine room heat': [1, 1], // steam venting from a brass valve
    },
  },
};

export default ada;
