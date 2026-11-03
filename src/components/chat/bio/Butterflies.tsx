/* Butterflies: one or two tiny butterflies flutter around the word. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const FLUTTERS = [
  { d: '0s', t: '3.4s', s: 1, rx: 0, ry: 0 },
  { d: '-1.9s', t: '4.1s', s: 0.8, rx: 0.2, ry: 0.2 },
] as const;

function ButterflyShape(): JSX.Element {
  return (
    <svg viewBox="0 0 20 14" width="0.9em" height="0.63em" focusable="false">
      <g className="fx-wings">
        <path d="M10 7 C8 1 2 0 1 3 C0.4 5.6 4.6 7.2 10 7Z" />
        <path d="M10 7 C12 1 18 0 19 3 C19.6 5.6 15.4 7.2 10 7Z" />
        <path d="M10 7 C6 8 3 10.4 4.4 12.6 C6 14 9 10.6 10 7Z" className="fx-wing-low" />
        <path d="M10 7 C14 8 17 10.4 15.6 12.6 C14 14 11 10.6 10 7Z" className="fx-wing-low" />
      </g>
    </svg>
  );
}

export function Butterflies(props: FxProps): JSX.Element {
  return (
    <FxWord kind="butterflies" text={props.text}>
      {FLUTTERS.map((f, i) => (
        <span key={i} className="fx-p fx-orbit" data-alt={i} style={v({ '--d': f.d, '--t': f.t, '--s': f.s, '--rx-k': f.rx, '--ry-k': f.ry, '--ow': '0.9em', '--oh': '0.63em' })}>
          <span className="fx-orbit-y">
            <ButterflyShape />
          </span>
        </span>
      ))}
    </FxWord>
  );
}
