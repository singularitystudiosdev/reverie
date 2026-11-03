/* Sparks: brass sparks pop off the word in short bursts. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from './FxWord';

const SPARKS = [
  { x: '88%', y: '30%', a: '-35deg', d: '0s' },
  { x: '88%', y: '60%', a: '20deg', d: '-0.08s' },
  { x: '12%', y: '28%', a: '-148deg', d: '-1.6s' },
  { x: '14%', y: '64%', a: '160deg', d: '-1.7s' },
  { x: '60%', y: '0%', a: '-85deg', d: '-3.1s' },
] as const;

export function Sparks(props: FxProps): JSX.Element {
  return (
    <FxWord kind="sparks" text={props.text}>
      {SPARKS.map((s, i) => (
        <span key={i} className="fx-p fx-spark-aim" style={v({ '--x': s.x, '--y': s.y, '--a': s.a, '--d': s.d })}>
          <span className="fx-spark" />
        </span>
      ))}
    </FxWord>
  );
}
