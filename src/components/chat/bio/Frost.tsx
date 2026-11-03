/* Frost: ice-crystal sparkles twinkle around the word, which wears an icy
   blue-white gradient with a shimmer. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const CRYSTALS = [
  { x: '8%', y: '12%', d: '0s', t: '2.6s', s: 0.69 },
  { x: '38%', y: '92%', d: '-0.9s', t: '3s', s: 0.51 },
  { x: '66%', y: '4%', d: '-1.7s', t: '2.8s', s: 0.6 },
  { x: '96%', y: '78%', d: '-2.2s', t: '3.2s', s: 0.75 },
] as const;

export function Frost(props: FxProps): JSX.Element {
  return (
    <FxWord kind="frost" text={props.text}>
      {CRYSTALS.map((c, i) => (
        <span key={i} className="fx-p fx-twinkle" style={v({ '--x': c.x, '--y': c.y, '--d': c.d, '--t': c.t, '--s': `${c.s}em` })}>
          <span className="fx-star" />
        </span>
      ))}
    </FxWord>
  );
}
