/* Fireflies: glowing dots orbit the word and pulse. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const FLIES = [
  { d: '0s', t: '3.2s', s: 1, rx: 0, ry: 0, p: '1.8s' },
  { d: '-1.6s', t: '3.8s', s: 0.8, rx: 0.15, ry: 0.15, p: '2.3s' },
  { d: '-2.4s', t: '4.4s', s: 0.9, rx: -0.12, ry: -0.1, p: '1.5s' },
  { d: '-0.8s', t: '3.6s', s: 0.7, rx: 0.25, ry: 0.2, p: '2.7s' },
  { d: '-3s', t: '4s', s: 0.8, rx: -0.2, ry: 0.25, p: '2s' },
] as const;

export function Fireflies(props: FxProps): JSX.Element {
  return (
    <FxWord kind="fireflies" text={props.text}>
      {FLIES.map((f, i) => (
        <span key={i} className="fx-p fx-orbit" style={v({ '--d': f.d, '--t': f.t, '--s': f.s, '--rx-k': f.rx, '--ry-k': f.ry, '--ow': '0.3em', '--oh': '0.3em' })}>
          <span className="fx-orbit-y">
            <span className="fx-fly" style={v({ '--pulse': f.p })} />
          </span>
        </span>
      ))}
    </FxWord>
  );
}
