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

   Not rendered yet, so not declared here (the player falls back to the v5
   sprite scenes for her bio words, and has no ring for her avatar):
     words  one column by three rows of her tagged phrases, painted at
            public/fx/nova/plates/words.jpg:
              "noticed"         -> middle row, an ECG heartbeat line drawing
              "stay jacked in"  -> top row, glyph noise decoding with a neon
                                   tube flickering on beneath it
              "always wins"     -> bottom row, a hologram coin flipping
     ring   a circuit ring with an empty centre and glitch fragments breaking
            out past its edge, painted at public/fx/nova/plates/ring.jpg.
   The fal balance was exhausted before those two clips could be generated.
   Once it is topped up, run kling on each plate with the same settings as
   above and encode with encode.sh (mode luma), then add:
     words: { src: '/fx/nova/words.mp4', loop: true, duration, loopDelay: 0,
              zIndex: 100, cols: 1, rows: 3, gutter: 0.1,
              cells: { 'stay jacked in': [0, 0], noticed: [0, 1], 'always wins': [0, 2] } }
     ring:  { src: '/fx/nova/ring.mp4', loop: true, duration, loopDelay: 0, zIndex: 100 }
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
}

export default nova
