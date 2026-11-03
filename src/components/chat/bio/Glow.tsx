/* Glow: the word glows in her accent, pulsing slowly. */
import type { JSX } from 'react';
import { FxWord, type FxProps } from './FxWord';

export function Glow(props: FxProps): JSX.Element {
  return (
    <FxWord kind="glow" text={props.text}>
      <span className="fx-halo" />
    </FxWord>
  );
}
