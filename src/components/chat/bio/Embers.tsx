/* Embers: sparks rise off the word; the word itself wears a flame gradient
   that flickers. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const EMBERS = [
  { x: '12%', d: '0s', t: '2.8s', s: 0.2, dx: '0.3em' },
  { x: '36%', d: '-0.9s', t: '3.2s', s: 0.16, dx: '-0.25em' },
  { x: '58%', d: '-1.9s', t: '2.6s', s: 0.22, dx: '0.2em' },
  { x: '80%', d: '-0.4s', t: '3.4s', s: 0.15, dx: '-0.3em' },
  { x: '94%', d: '-2.3s', t: '3s', s: 0.18, dx: '0.25em' },
] as const;

export function Embers(props: FxProps): JSX.Element {
  return (
    <FxWord kind="embers" text={props.text}>
      {EMBERS.map((e, i) => (
        <span key={i} className="fx-p fx-spark-rise" data-alt={i % 2} style={v({ '--x': e.x, '--d': e.d, '--t': e.t, '--s': `${e.s}em`, '--dx': e.dx })}>
          <span className="fx-ember" />
        </span>
      ))}
    </FxWord>
  );
}
