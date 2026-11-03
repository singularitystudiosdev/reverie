/* Bubbles: small bubbles rise from the word and fade. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const BUBBLES = [
  { x: '16%', d: '0s', t: '4s', s: 0.38, dx: '0.2em' },
  { x: '48%', d: '-1.4s', t: '4.8s', s: 0.28, dx: '-0.25em' },
  { x: '76%', d: '-2.6s', t: '4.4s', s: 0.42, dx: '0.3em' },
  { x: '32%', d: '-3.4s', t: '5.2s', s: 0.24, dx: '-0.15em' },
  { x: '92%', d: '-0.8s', t: '5s', s: 0.3, dx: '-0.2em' },
] as const;

export function Bubbles(props: FxProps): JSX.Element {
  return (
    <FxWord kind="bubbles" text={props.text}>
      {BUBBLES.map((b, i) => (
        <span key={i} className="fx-p fx-rise" style={v({ '--x': b.x, '--d': b.d, '--t': b.t, '--s': `${b.s}em`, '--dx': b.dx })}>
          <span className="fx-sway">
            <span className="fx-bubble" />
          </span>
        </span>
      ))}
    </FxWord>
  );
}
