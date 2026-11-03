/*
  Sylvara's rendered effect set (public/fx/sylvara/): ivy with white blossoms, fireflies,
  a moon rising through the canopy. Five stacked-alpha clips at 24 fps.

    intro  ivy whips in from the edges and curls shut, blossoms open, fireflies rush the
           camera, the moon flares (120 frames, plays once)
    loop   drifting fireflies, breathing leaves, shifting ivy, moon glow at the top
    frame  ivy and blossoms around the 9:16 edge, nothing in the middle
    ring   an ivy and blossom wreath around her avatar, centre empty
    words  2x2 atlas, each motif kept inside its cell (gutter 0.1):
             [0,0] blossom burst         <- barefoot and unhurried
             [1,0] firefly swarm         <- listening hard
             [0,1] glowing rune          (spare: no tagged phrase uses it)
             [1,1] crescent moon         <- stay the night
  The phrase keys are the {sylvara:...} tags in src/data/characters.ts, byte for byte.
  Clip lengths are in milliseconds: the intro is 120 frames, the seamless clips 109.
*/
import { defineCharacterFx } from '../types';

const fx = defineCharacterFx('sylvara', {
  cols: 2,
  rows: 2,
  gutter: 0.1,
  cells: {
    'stay the night': [1, 1],
    'barefoot and unhurried': [0, 0],
    'listening hard': [1, 0],
  },
}, { duration: 4542 });

if (fx.intro) fx.intro.duration = 5000;

export default fx;
