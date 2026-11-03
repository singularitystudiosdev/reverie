/* Smoke: soft dark wisps rise off the word and spread. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const PUFFS = [
  { x: '20%', d: '0s', t: '5s', s: 0.9, dx: '0.3em' },
  { x: '52%', d: '-1.7s', t: '5.8s', s: 1.1, dx: '-0.3em' },
  { x: '82%', d: '-3.3s', t: '5.4s', s: 0.8, dx: '0.2em' },
] as const;

export function Smoke(props: FxProps): JSX.Element {
  return (
    <FxWord kind="smoke" text={props.text}>
      {PUFFS.map((p, i) => (
        <span key={i} className="fx-p fx-puff" style={v({ '--x': p.x, '--d': p.d, '--t': p.t, '--s': `${p.s}em`, '--dx': p.dx })}>
          <span className="fx-smoke" />
        </span>
      ))}
    </FxWord>
  );
}
