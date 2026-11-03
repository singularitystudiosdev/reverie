/* Bokeh: soft warm light orbs breathe behind the word. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const ORBS = [
  { x: '10%', y: '40%', s: 1.5, d: '0s', t: '3.6s' },
  { x: '48%', y: '70%', s: 1.2, d: '-1.4s', t: '4.2s' },
  { x: '86%', y: '30%', s: 1.7, d: '-2.4s', t: '3.9s' },
] as const;

export function Bokeh(props: FxProps): JSX.Element {
  return (
    <FxWord kind="bokeh" text={props.text}>
      {ORBS.map((o, i) => (
        <span key={i} className="fx-p fx-breathe" data-alt={i % 2} style={v({ '--x': o.x, '--y': o.y, '--s': `${o.s}em`, '--d': o.d, '--t': o.t })}>
          <span className="fx-orb" />
        </span>
      ))}
    </FxWord>
  );
}
