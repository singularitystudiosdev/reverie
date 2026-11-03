/* Petals: cherry petals drift down past the word, swaying as they fall. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const PETALS = [
  { x: '14%', d: '0s', t: '5.2s', dx: '0.5em', r: '200deg' },
  { x: '42%', d: '-1.8s', t: '6s', dx: '-0.4em', r: '-160deg' },
  { x: '68%', d: '-3.4s', t: '5.6s', dx: '0.35em', r: '240deg' },
  { x: '90%', d: '-4.4s', t: '6.4s', dx: '-0.5em', r: '-210deg' },
] as const;

export function Petals(props: FxProps): JSX.Element {
  return (
    <FxWord kind="petals" text={props.text}>
      {PETALS.map((p, i) => (
        <span key={i} className="fx-p fx-fall" style={v({ '--x': p.x, '--d': p.d, '--t': p.t, '--dx': p.dx, '--rot': p.r })}>
          <span className="fx-sway">
            <span className="fx-petal" />
          </span>
        </span>
      ))}
    </FxWord>
  );
}
