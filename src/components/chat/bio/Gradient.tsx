/* Gradient: the word is filled with an animated gradient of her palette (the
   fill crosses between two gradients, opacity only). */
import type { JSX } from 'react';
import { FxWord, type FxProps } from './FxWord';

export function Gradient(props: FxProps): JSX.Element {
  return <FxWord kind="gradient" text={props.text} />;
}
