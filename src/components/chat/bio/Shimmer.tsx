/* Shimmer: a single light band crosses the word every few seconds. */
import type { JSX } from 'react';
import { FxWord, type FxProps } from './FxWord';

export function Shimmer(props: FxProps): JSX.Element {
  return <FxWord kind="shimmer" text={props.text} />;
}
