/* Feathers: a black feather or two drift past the word. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const FEATHERS = [
  { x: '24%', d: '0s', t: '7s', dx: '0.5em', r: '70deg' },
  { x: '74%', d: '-3.6s', t: '8s', dx: '-0.45em', r: '-80deg' },
] as const;

function FeatherShape(): JSX.Element {
  return (
    <svg viewBox="0 0 8 24" width="0.34em" height="1em" focusable="false">
      <path d="M4 0.5 C7.6 5 8 12 4.4 18.5 C4.2 20.6 4.1 22.4 4 23.5 C3.9 22.4 3.8 20.6 3.6 18.5 C0 12 0.4 5 4 0.5Z" />
    </svg>
  );
}

export function Feathers(props: FxProps): JSX.Element {
  return (
    <FxWord kind="feathers" text={props.text}>
      {FEATHERS.map((f, i) => (
        <span key={i} className="fx-p fx-fall fx-feather" style={v({ '--x': f.x, '--d': f.d, '--t': f.t, '--dx': f.dx, '--rot': f.r })}>
          <span className="fx-sway">
            <FeatherShape />
          </span>
        </span>
      ))}
    </FxWord>
  );
}
