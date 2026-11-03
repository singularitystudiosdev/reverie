import type { CharacterFx } from '../types'

/* Vesper, v6 rendered effects. Black velvet, guttering candles, crimson blood, a bat swarm.
   Palette: velvet #12060A, blood #D12C48, candle gold #F2B66B.

   Reference: Discord Shop "Dark Moon" profile effect (intro: a smoke wipe that opens on a
   vortex of crows and a moon, then a loop of drifting feathers and mist; 450x880 APNG,
   12 fps, two layers, intro zIndex 110 / loop zIndex 100). Vesper keeps that two-layer
   rhythm and the "a flock comes at you out of the dark" intro, with bats, and swaps
   the moon for a candle flare.

   Every clip is a stacked-alpha H.264 (colour on top, alpha as luma below, 24 fps).
   Her subjects are dark solids (bats, lace, a jet button, wax), so nothing here is keyed
   by brightness. Each plate was painted and animated on a flat chroma green and keyed:
     still     openai/gpt-image-2, flat #00B140 background, 1024x1792 (ring and words 1024x1024)
     motion    fal-ai/kling-video/v2.1/standard/image-to-video, 5 s, cfg 0.6, "background stays flat"
     encode    .tmp/reverie-research/proof/encode.sh, mode key:00B140, gain 1.6
   Three of the five clips needed their own tail of ffmpeg on top of encode.sh (same
   chromakey and despill, same stacked-alpha and H.264 settings): the intro is one-shot
   (no head/tail crossfade) with a procedural crimson and gold flare composited under the
   bats and a 0.7 s alpha fade-out; the frame has a feathered mask that keeps its middle
   empty; the words atlas is assembled from five separately keyed cells.

   intro.mp4  540x946, 121 frames, 121 distinct, solid 83.5%. About thirty bats burst out
              of the dark straight at the lens, wings beating, the nearest one filling the
              frame as a crimson and gold flare blooms behind the swarm, then the picture
              fades to nothing. One-shot, zIndex 110.
   loop.mp4   540x946, 109 frames, 109 distinct, solid 95.8%. A band of blood runs slowly down
              the top edge in long drips, a cluster of black candles gutters along the
              bottom with wax running and embers and crimson smoke rising. Centre empty.
              Seamless, zIndex 100.
   frame.mp4  540x946, 109 frames, 109 distinct, solid 82.4%. A black lace and thorn
              border with roses and a candle flame in each corner, embers drifting off the
              flames and a crimson light pulse running along the vines. Empty middle. Seamless.
   ring.mp4   384x384, 109 frames, 109 distinct, solid 91.7%. A square avatar decoration:
              a ring of black lace, thorns and roses with three candles on top, bats and
              thorn tips breaking out past the circle, and an empty circular centre.
   words.mp4  768x504, 109 frames, 109 distinct, solid 95.3%. A 3 columns by 2 rows atlas,
              240 px cells with a 24 px transparent gutter (gutter 0.1 of a cell):
                [0,0] "unbuttoned"         a jet button pops, spins and glints on velvet
                [1,0] "hungry"             a blood drop swells on its strand and falls
                [2,0] "whisper your name"  a bat swoops across the cell
                [0,1] "stays"              a candle catches a spark and ignites
                [1,1] "ask"                a fang pair with a blood drop that swells and falls
                [2,1] unused, left empty
              The keys are her {vesper:...} tags in src/data/characters.ts, byte for byte.
*/

export const vesper: CharacterFx = {
  id: 'vesper',
  intro: {
    src: '/fx/vesper/intro.mp4',
    loop: false,
    duration: 5042,
    loopDelay: 0,
    zIndex: 110,
  },
  loop: {
    src: '/fx/vesper/loop.mp4',
    loop: true,
    duration: 4542,
    loopDelay: 3000,
    zIndex: 100,
  },
  frame: {
    src: '/fx/vesper/frame.mp4',
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 90,
  },
  ring: {
    src: '/fx/vesper/ring.mp4',
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 100,
  },
  words: {
    src: '/fx/vesper/words.mp4',
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 100,
    cols: 3,
    rows: 2,
    gutter: 0.1,
    cells: {
      unbuttoned: [0, 0],
      hungry: [1, 0],
      'whisper your name': [2, 0],
      stays: [0, 1],
      ask: [1, 1],
    },
  },
}

export default vesper
