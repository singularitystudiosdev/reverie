import type { CharacterFx } from '../types'

/* Nova, v6 rendered effects. Neon, scanlines, holograms, rain.
   Palette: night #06121A, cyan #35E8E0, magenta #FF3FA4.

   Reference: Discord Shop "Split blue and orange digital distortion" avatar
   decoration (a_6eb50e191f4dc26e8df7a6f1c0440567, 288x288 APNG, 12 fps): a
   chromatic two-colour split with vertical glitch streaks. Nova keeps that
   split (cyan against magenta) and the sliced-band motion, and adds the rain.

   Every clip is a stacked-alpha H.264 (colour on top, alpha as luma below,
   450x788 CSS px, 24 fps), rendered like this:
     still     openai/gpt-image-2.5/flare/text-to-image, 1024x1792, painted neon
               on flat pure black (the plates are emissive, so alpha is luma)
     motion    fal-ai/kling-video/v2.1/standard/image-to-video, 5 s, cfg 0.6
     encode    .tmp/reverie-research/proof/encode.sh, 450 wide, 24 fps, gain 1.6,
               mode luma (intro is one-shot: no head/tail crossfade; crf 34)

   intro.mp4  121 frames, 121 distinct. The frame is torn by horizontal scan
              bands, glyph columns cascade, then the noise clears band by band
              from the top until only faint scanline traces and glyph rain
              remain. One-shot, zIndex 110.
   loop.mp4   109 frames, 109 distinct. Neon signs pulsing down both edges,
              diagonal cyan rain, holographic shimmer. Centre left empty for
              her art. Seamless head/tail crossfade, zIndex 100.
   frame.mp4  109 frames, 105 of 108 consecutive pairs move. A neon circuit
              border with light running along the traces and flickering
              magenta tubes, empty middle. Seamless.

   words.mp4  109 frames, 109 distinct, solid 41.4% (luma; the hologram coin
              is translucent but stayed above the 40% ghost line). 640x640
              square atlas, one column by three rows with a 0.1 gutter, so
              motion never crosses a row edge. Re-rendered once: the first take
              grew a cyan V that crossed from the top row into the ECG row, so
              the prompt now pins the bands and negates diagonals.
                "stay jacked in"  top row, glyph noise decoding with a magenta
                                  neon tube flickering on beneath it
                "noticed"         middle row, an ECG heartbeat line with pulses
                                  travelling along it
                "always wins"     bottom row, a hologram coin spinning
              Seamless, zIndex 100. Plate: plates/words.jpg.
   ring.mp4   109 frames, 109 distinct, solid 49.0% (luma, emissive). 384x384
              square avatar decoration: a circuit ring with an empty centre,
              pulsing traces, flickering magenta tubes and glitch fragments
              tearing out past its edge. Seamless. Plate: plates/ring.jpg.
   words and ring use the same Kling settings as above (5 s, cfg 0.6), encoded
   with encode.sh at gain 1.6, mode luma, crf 32.
*/

export const nova: CharacterFx = {
  id: 'nova',
  intro: {
    src: '/fx/nova/intro.mp4',
    loop: false,
    duration: 5042,
    loopDelay: 0,
    zIndex: 110,
  },
  loop: {
    src: '/fx/nova/loop.mp4',
    loop: true,
    duration: 4542,
    loopDelay: 3000,
    zIndex: 100,
  },
  frame: {
    src: '/fx/nova/frame.mp4',
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 90,
  },
  words: {
    src: '/fx/nova/words.mp4',
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 100,
    cols: 1,
    rows: 3,
    gutter: 0.1,
    cells: { 'stay jacked in': [0, 0], noticed: [0, 1], 'always wins': [0, 2] },
  },
  ring: {
    src: '/fx/nova/ring.mp4',
    loop: true,
    duration: 4542,
    loopDelay: 0,
    zIndex: 100,
  },
}

export default nova
