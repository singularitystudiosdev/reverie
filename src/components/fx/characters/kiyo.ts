/*
  Kiyo's rendered effects (FX-V3 v6). Each clip is a painted still animated by
  Kling v2.1 and shipped as stacked-alpha H.264: colour in the top half, alpha
  as luma in the bottom half. Foxfire, embers and mist are keyed by brightness
  on black; the leaves, mask, tail, torii and ring are painted on flat magenta
  and chroma keyed, so they stay solid instead of ghosting.

  Reference: Discord Shop "Void Pumpkins" (fire-trailed bodies orbiting the
  avatar) and the "Dark Moon Crows" profile intro (a vortex spilling outward).

  The shapes are FX-V3 UPDATE 2's; src/components/fx/types.ts does not exist in
  this tree yet, so they are declared here and the integrator swaps the import.
*/

type FxLayer = { src: string; poster?: string; loop: boolean; duration: number; loopDelay?: number; zIndex?: number };
type CharacterFx = {
  id: string;
  intro?: FxLayer;
  loop?: FxLayer;
  frame?: FxLayer;
  ring?: FxLayer;
  words?: FxLayer & { cols: number; rows: number; gutter: number; cells: Record<string, [col: number, row: number]> };
};

const BASE = '/fx/kiyo';

function clip(name: string, loop: boolean, duration: number, zIndex: number): FxLayer {
  return { src: `${BASE}/${name}.mp4`, poster: `${BASE}/${name}.poster.png`, loop, duration, loopDelay: 0, zIndex };
}

const kiyo: CharacterFx = {
  id: 'kiyo',
  // Nine foxfire wisps whirl out of the centre and rush past with a burst of maple, then clear.
  intro: clip('intro', false, 5000, 110),
  // Wisps drifting and flickering, embers rising, low mist; maples fall down the sides only.
  loop: clip('loop', true, 4542, 100),
  // A torii whose lintel spans the top and pillars frame the sides; foxfire at its feet.
  frame: clip('frame', true, 4542, 90),
  // Square avatar decoration: a vine wreath of maples and two white tails, empty centre.
  ring: clip('ring', true, 4542, 100),
  // 2x2 atlas. Each cell keeps 5% of its width and height empty on every side,
  // so `gutter` (the empty share of a cell between two neighbours' motifs) is 0.1.
  words: {
    ...clip('words', true, 4500, 80),
    cols: 2,
    rows: 2,
    gutter: 0.1,
    cells: {
      foxfire: [0, 0], // a wisp igniting
      'falling maples': [1, 0], // a maple leaf spinning
      'forget the riddle': [0, 1], // a kitsune mask grinning
      'steal a kiss': [1, 1], // a tail sweeping
    },
  },
};

export default kiyo;
