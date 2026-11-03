/* Foxfire: blue ghost-flame wisps curl up around the word. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const WISPS = [
  { x: '10%', d: '0s', t: '3.6s', dx: '0.45em', r: '40deg' },
  { x: '40%', d: '-1.2s', t: '4.2s', dx: '-0.4em', r: '-50deg' },
  { x: '70%', d: '-2.2s', t: '3.8s', dx: '0.4em', r: '45deg' },
  { x: '94%', d: '-0.6s', t: '4.4s', dx: '-0.45em', r: '-40deg' },
] as const;

export function Foxfire(props: FxProps): JSX.Element {
  return (
    <FxWord kind="foxfire" text={props.text}>
      {WISPS.map((w, i) => (
        <span key={i} className="fx-p fx-curl" style={v({ '--x': w.x, '--d': w.d, '--t': w.t, '--dx': w.dx, '--rot': w.r })}>
          <span className="fx-wisp" />
        </span>
      ))}
    </FxWord>
  );
}
