/* Sand: glittering gold grains drift sideways past the word, which has a warm
   gold gradient. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const GRAINS = [
  { y: '20%', d: '0s', t: '3.4s', s: 0.1 },
  { y: '46%', d: '-1.1s', t: '4s', s: 0.13 },
  { y: '70%', d: '-2.1s', t: '3.6s', s: 0.09 },
  { y: '34%', d: '-2.9s', t: '4.4s', s: 0.12 },
  { y: '84%', d: '-0.5s', t: '3.8s', s: 0.1 },
  { y: '58%', d: '-1.7s', t: '4.2s', s: 0.08 },
] as const;

export function Sand(props: FxProps): JSX.Element {
  return (
    <FxWord kind="sand" text={props.text}>
      {GRAINS.map((g, i) => (
        <span key={i} className="fx-p fx-drift" style={v({ '--y': g.y, '--d': g.d, '--t': g.t, '--s': `${g.s}em` })}>
          <span className="fx-grain" />
        </span>
      ))}
    </FxWord>
  );
}
