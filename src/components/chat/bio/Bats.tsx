/* Bats: four tiny bat silhouettes circle the word on elliptical paths, each
   flapping between two wing frames. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const BATS = [
  { d: '0s', t: '3s', s: 1, rx: 0.1, ry: 0.05, rev: 0 },
  { d: '-1.6s', t: '3.2s', s: 0.8, rx: 0.3, ry: 0.2, rev: 1 },
  { d: '-3.1s', t: '2.8s', s: 0.9, rx: -0.15, ry: -0.1, rev: 0 },
  { d: '-4.7s', t: '3.4s', s: 0.7, rx: 0.4, ry: 0.15, rev: 1 },
] as const;

function BatShape(): JSX.Element {
  return (
    <svg viewBox="0 0 24 12" width="1.3em" height="0.65em" className="fx-bat-svg" focusable="false">
      <g className="fx-wing-a">
        <path d="M12 6.5 C10.6 3.6 7 1 1 1.6 C2.7 3 3.1 4.7 4 6.4 C5.4 5.4 6.8 5.6 8 6.8 C9.2 6 10.8 6.2 12 7.8 C13.2 6.2 14.8 6 16 6.8 C17.2 5.6 18.6 5.4 20 6.4 C20.9 4.7 21.3 3 23 1.6 C17 1 13.4 3.6 12 6.5Z" />
        <path d="M10.6 5.2 L11 2.6 L12 4 L13 2.6 L13.4 5.2Z" />
      </g>
      <g className="fx-wing-b">
        <path d="M12 6.2 C10.4 7.4 7 9.2 1.4 9.6 C3.2 8.4 3.8 7.2 4.6 5.8 C5.6 6.6 7 6.8 8 6.4 C9 7.2 10.6 7.2 12 8.2 C13.4 7.2 15 7.2 16 6.4 C17 6.8 18.4 6.6 19.4 5.8 C20.2 7.2 20.8 8.4 22.6 9.6 C17 9.2 13.6 7.4 12 6.2Z" />
        <path d="M10.6 5.2 L11 2.6 L12 4 L13 2.6 L13.4 5.2Z" />
      </g>
    </svg>
  );
}

export function Bats(props: FxProps): JSX.Element {
  return (
    <FxWord kind="bats" text={props.text}>
      {BATS.map((b, i) => (
        <span key={i} className="fx-p fx-orbit" data-rev={b.rev} style={v({ '--d': b.d, '--t': b.t, '--s': b.s, '--rx-k': b.rx, '--ry-k': b.ry, '--ow': '1.3em', '--oh': '0.65em' })}>
          <span className="fx-orbit-y">
            <BatShape />
          </span>
        </span>
      ))}
    </FxWord>
  );
}
