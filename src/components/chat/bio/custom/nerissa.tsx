/* Nerissa: one bespoke beat per charged word, played by painted sprites
   (public/fx/nerissa). The word is picked from its text:
   - you: a pearl glows, rolls beneath the word and settles with a glint;
   - pull you nearer: a wave gathers, curls under the phrase and tugs it;
   - breathless: the word takes a breath and bubbles stream up in two bursts;
   - keep herself: a scallop opens, a pearl rises, the shell snaps shut over it.
   Anything else gets her signature: caustic light and two rising bubbles. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import { asset } from '../../../../lib/asset';
import './nerissa.css';

function Sprite(props: { name: string; className?: string }): JSX.Element {
  return <img className={`ne-sprite${props.className ? ` ${props.className}` : ''}`} src={asset(`/fx/nerissa/${props.name}.png`)} alt="" draggable={false} />;
}

/* x = where along the word, s = size, sx = sideways wobble, d = start of its burst */
const BUBBLES = [
  { x: '10%', s: '1.1em', sx: '0.14em', d: '0.8s' },
  { x: '34%', s: '1.5em', sx: '-0.18em', d: '0.87s' },
  { x: '58%', s: '0.9em', sx: '0.12em', d: '0.95s' },
  { x: '82%', s: '1.3em', sx: '-0.14em', d: '1.04s' },
  { x: '22%', s: '1.0em', sx: '-0.12em', d: '3.1s' },
  { x: '51%', s: '1.6em', sx: '0.2em', d: '3.18s' },
  { x: '76%', s: '1.2em', sx: '-0.16em', d: '3.27s' },
] as const;

function You(): JSX.Element {
  return (
    <span className="ne-scene ne-you">
      <span className="ne-actor ne-roll">
        <span className="ne-glow" />
        <span className="ne-spin">
          <Sprite name="pearl" />
        </span>
        <i className="ne-glint" />
      </span>
    </span>
  );
}

function Pull(): JSX.Element {
  return (
    <span className="ne-scene ne-pull">
      <span className="ne-back" />
      <span className="ne-trail" />
      <span className="ne-actor ne-wave">
        <Sprite name="wave" className="ne-flip" />
      </span>
    </span>
  );
}

function Breathless(): JSX.Element {
  return (
    <span className="ne-scene ne-breath">
      <span className="ne-back" />
      {BUBBLES.map((b, i) => (
        <span key={i} className="ne-bub" style={v({ '--x': b.x, '--s': b.s, '--sx': b.sx, '--d': b.d })}>
          <Sprite name="bubble" />
        </span>
      ))}
    </span>
  );
}

function Keep(): JSX.Element {
  return (
    <span className="ne-scene ne-keep">
      <span className="ne-actor ne-shell">
        <span className="ne-glow" />
        <span className="ne-shell-lo">
          <Sprite name="shell" />
        </span>
        <span className="ne-pearl-in">
          <Sprite name="pearl" />
        </span>
        <span className="ne-shell-hi">
          <Sprite name="shell" />
        </span>
        <i className="ne-glint" />
      </span>
    </span>
  );
}

function Signature(): JSX.Element {
  return (
    <span className="ne-scene ne-sig">
      <span className="ne-bub ne-sig-bub" style={v({ '--x': '18%', '--s': '1.1em', '--sx': '0.14em', '--d': '0s' })}>
        <Sprite name="bubble" />
      </span>
      <span className="ne-bub ne-sig-bub" style={v({ '--x': '66%', '--s': '1.4em', '--sx': '-0.16em', '--d': '-2.4s' })}>
        <Sprite name="bubble" />
      </span>
    </span>
  );
}

export default function NerissaFx(props: FxProps): JSX.Element {
  const word = props.text.trim().toLowerCase();
  return (
    <FxWord kind="nerissa" text={props.text}>
      {word === 'you' ? (
        <You />
      ) : word === 'pull you nearer' ? (
        <Pull />
      ) : word === 'breathless' ? (
        <Breathless />
      ) : word === 'keep herself' ? (
        <Keep />
      ) : (
        <Signature />
      )}
    </FxWord>
  );
}
