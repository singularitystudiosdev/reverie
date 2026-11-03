/* Neon: the word is a lit tube, magenta over cyan, with an occasional
   flicker. No particles; the glow halo is the layer. */
import type { JSX } from 'react';
import { FxWord, type FxProps } from './FxWord';

export function Neon(props: FxProps): JSX.Element {
  return (
    <FxWord kind="neon" text={props.text}>
      <span className="fx-halo" />
    </FxWord>
  );
}
