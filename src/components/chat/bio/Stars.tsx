/* Stars: tiny four-point stars twinkle around the word, which has a gold
   gradient fill. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const STARS = [
  { x: '4%', y: '6%', d: '0s', t: '2.4s', s: 0.71 },
  { x: '30%', y: '96%', d: '-1.1s', t: '3s', s: 0.51 },
  { x: '58%', y: '2%', d: '-0.5s', t: '2.8s', s: 0.61 },
  { x: '84%', y: '90%', d: '-1.8s', t: '2.6s', s: 0.48 },
  { x: '100%', y: '26%', d: '-2.2s', t: '3.2s', s: 0.68 },
] as const;

export function Stars(props: FxProps): JSX.Element {
  return (
    <FxWord kind="stars" text={props.text}>
      {STARS.map((s, i) => (
        <span key={i} className="fx-p fx-twinkle" style={v({ '--x': s.x, '--y': s.y, '--d': s.d, '--t': s.t, '--s': `${s.s}em` })}>
          <span className="fx-star" />
        </span>
      ))}
    </FxWord>
  );
}
