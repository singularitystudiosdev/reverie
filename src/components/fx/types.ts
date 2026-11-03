/*
  FX types: the config every character unit fills in, and the few shapes the
  renderer shares with its callers. The layer list follows Discord's profile
  effect schema (src, loop, duration, loopDelay, zIndex); see fx.css for the
  contract in prose.
*/

/** Discord's two-layer stacking (intro 110 over loop 100), then the decorations beneath. */
export const FX_Z = { intro: 110, loop: 100, frame: 90, words: 80, ring: 70 } as const;

/**
 * One rendered clip. `src` is a stacked-alpha MP4 (colour in the top half,
 * alpha as luma in the bottom half; scripts/fx/render.mjs makes it).
 */
export interface FxLayer {
  /** Stacked-alpha H.264 MP4, e.g. /fx/cinder/intro.mp4. */
  src: string;
  /**
   * Transparent still of the clip's first frame (PNG with alpha, NOT stacked).
   * Shown by a full-frame surface until the first video frame is presented.
   */
  poster?: string;
  /** false: play once and stop (the intro). true: repeat (the loop). */
  loop: boolean;
  /**
   * Milliseconds the layer is on screen per pass. A clip that runs longer is cut
   * at this point; a shorter clip ends on its own. 0 means the clip's own length.
   */
  duration: number;
  /**
   * Milliseconds of blank between two passes of a looping layer (Discord's
   * loopDelay). Default 0: repeat seamlessly with the browser's native loop.
   */
  loopDelay?: number;
  /** Paint order, higher in front. Defaults: intro 110, loop 100, frame 90, words 80, ring 70. */
  zIndex?: number;
  /** Atlas cell [col, row] a whole-frame layer shows, when its clip is a cols x rows grid. */
  cell?: [number, number];
  cols?: number;
  rows?: number;
}

/**
 * The words atlas: ONE seamless stacked-alpha clip whose colour half is a
 * cols x rows grid of cells (different effects, not successive frames). Each
 * tagged word of the bio names its cell, and the player draws that cell,
 * aspect-preserved and centred, at the word's rect from the one video texture.
 */
export type FxWordsLayer = FxLayer & {
  cols: number;
  rows: number;
  /**
   * Fraction of a cell (0 to 0.5) left empty at every edge of it. The sampler
   * trims that much, so motion never reads across a cell edge. Paint at least 0.08.
   */
  gutter: number;
  /** Lower-cased bio word -> [col, row]. A word without an entry keeps v5's CSS effect. */
  cells: Record<string, [number, number]>;
  /**
   * How tall the cell is drawn, in line heights of the word. Default 3: paint each
   * motif to read at roughly 2 to 4 times the word's height.
   */
  scale?: number;
};

export interface CharacterFx {
  id: string;
  /** Full-frame, plays once (zIndex 110). */
  intro?: FxLayer;
  /** Full-frame, seamless ambient (zIndex 100), starts when the intro ends. */
  loop?: FxLayer;
  /** Transparent border decoration around the 9:16 frame (zIndex 90). */
  frame?: FxLayer;
  /** Square, seamless avatar decoration around her circular avatar (centre empty). */
  ring?: FxLayer;
  /** The word atlas for her tagged bio words. */
  words?: FxWordsLayer;
}

/** A rectangle in colour-half UV space: [u0, v0, du, dv], v pointing down. */
export type FxUv = readonly [number, number, number, number];

/** One sprite the renderer draws: a destination rect and the UV rect it samples. */
export interface FxQuad {
  /** Destination in the frame's CSS pixels, top-left origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  uv: FxUv;
}

export type FxClip = 'intro' | 'loop' | 'frame' | 'ring' | 'words';

export interface DefineFxOptions {
  /** Which clips this character has rendered. Default: all five. */
  clips?: ReadonlyArray<FxClip>;
  /** Milliseconds per pass for the clips. Default 5000. */
  duration?: number;
  /** Blank gap between loop passes. Default 0 (seamless). */
  loopDelay?: number;
  /** Words: cell height in word line heights. Default 3. */
  scale?: number;
}

/**
 * The one call a character unit makes. It points at the files scripts/fx/render.mjs
 * writes (public/fx/<id>/{intro,loop,frame,ring,words}.mp4 and <clip>.poster.png):
 *
 *   export default defineCharacterFx('cinder', {
 *     cols: 2, rows: 2, gutter: 0.1,
 *     cells: { closer: [0, 0], 'light up': [1, 0], burn: [0, 1], dare: [1, 1] },
 *   });
 */
export function defineCharacterFx(
  id: string,
  atlas: { cols: number; rows: number; gutter: number; cells: Record<string, [number, number]> },
  opts: DefineFxOptions = {}
): CharacterFx {
  const clips = opts.clips ?? ['intro', 'loop', 'frame', 'ring', 'words'];
  const duration = opts.duration ?? 5000;
  const loopDelay = opts.loopDelay ?? 0;
  const base = `/fx/${id}`;
  const layer = (name: FxClip, loop: boolean): FxLayer => ({
    src: `${base}/${name}.mp4`,
    poster: `${base}/${name}.poster.png`,
    loop,
    duration,
    loopDelay: loop ? loopDelay : 0,
    zIndex: FX_Z[name],
  });
  const fx: CharacterFx = { id };
  if (clips.includes('intro')) fx.intro = layer('intro', false);
  if (clips.includes('loop')) fx.loop = layer('loop', true);
  if (clips.includes('frame')) fx.frame = layer('frame', true);
  if (clips.includes('ring')) fx.ring = layer('ring', true);
  if (clips.includes('words')) {
    fx.words = {
      ...layer('words', true),
      cols: atlas.cols,
      rows: atlas.rows,
      gutter: atlas.gutter,
      cells: Object.fromEntries(Object.entries(atlas.cells).map(([k, v]) => [k.toLowerCase(), v])),
      scale: opts.scale,
    };
  }
  return fx;
}
