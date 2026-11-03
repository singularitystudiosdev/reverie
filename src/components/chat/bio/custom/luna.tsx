/* Luna: one bespoke beat per charged word, played by painted sprites
   (public/fx/luna). The word is picked from its text:
   - lean in: three gold stars drift in, tilt toward the word and twinkle hard
     as the word takes a starlight sweep;
   - sweet and dangerous: a potion bottle rises beside the phrase, tips over
     it, throws up a ring of bubbles and spills a sparkle that scatters;
   - kept: a crescent moon slides under the word and cradles it, rocking, while
     the black cat peeks over the top edge, blinks, then ducks away.
   Anything else gets her signature: a slow gilded sweep with two distant
   twinkles. Everything sits above, below or beside the letters. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import './luna.css';

function Sprite(props: { name: string; className?: string }): JSX.Element {
  return <img className={`lu-sprite${props.className ? ` ${props.className}` : ''}`} src={`/fx/luna/${props.name}.png`} alt="" draggable={false} />;
}

const LEANERS = [
  { x: '4%', y: '-0.9em', s: '2em', d: '0s', r: '18deg', t: '2.1s' },
  { x: '46%', y: '-1.15em', s: '1.5em', d: '-0.7s', r: '-8deg', t: '1.7s' },
  { x: '86%', y: '-0.85em', s: '2.3em', d: '-1.3s', r: '-22deg', t: '2.4s' },
] as const;

const FIZZ = [
  { x: '14%', s: '0.3em', d: '1.05s', sx: '0.16em' },
  { x: '34%', s: '0.2em', d: '1.14s', sx: '-0.12em' },
  { x: '52%', s: '0.36em', d: '1.22s', sx: '0.18em' },
  { x: '72%', s: '0.24em', d: '1.3s', sx: '-0.16em' },
  { x: '88%', s: '0.3em', d: '1.38s', sx: '0.1em' },
] as const;

function LeanIn(): JSX.Element {
  return (
    <span className="lu-scene lu-lean">
      <span className="lu-back" />
      {LEANERS.map((s, i) => (
        <span key={i} className="lu-actor lu-star" style={v({ '--x': s.x, '--y': s.y, '--s': s.s, '--d': s.d, '--r': s.r })}>
          <Sprite name="star" />
          <i className="lu-twinkle" style={v({ '--t': s.t, '--d': s.d })} />
        </span>
      ))}
    </span>
  );
}

function Potion(): JSX.Element {
  return (
    <span className="lu-scene lu-potion">
      <span className="lu-back" />
      <span className="lu-actor lu-bottle">
        <span className="lu-halo" />
        <Sprite name="potion" />
      </span>
      {FIZZ.map((f, i) => (
        <span key={i} className="lu-bub" style={v({ '--x': f.x, '--s': f.s, '--d': f.d, '--sx': f.sx })} />
      ))}
      <span className="lu-spill" />
    </span>
  );
}

function Kept(): JSX.Element {
  return (
    <span className="lu-scene lu-kept">
      <span className="lu-back" />
      <span className="lu-actor lu-moon">
        <span className="lu-halo" />
        <Sprite name="moon" />
      </span>
      <span className="lu-actor lu-cat">
        <Sprite name="cat" />
        <i className="lu-blink" />
      </span>
    </span>
  );
}

function Signature(): JSX.Element {
  return (
    <span className="lu-scene lu-sig">
      <span className="lu-actor lu-sig-star" style={v({ '--x': '96%', '--y': '-0.75em', '--s': '1.5em', '--d': '0s' })}>
        <Sprite name="star" />
      </span>
      <span className="lu-actor lu-sig-star" style={v({ '--x': '-0.4em', '--y': '0.95em', '--s': '1.1em', '--d': '-2.1s' })}>
        <Sprite name="star" />
      </span>
    </span>
  );
}

export default function LunaFx(props: FxProps): JSX.Element {
  const word = props.text.trim().toLowerCase();
  return (
    <FxWord kind="luna" text={props.text}>
      {word === 'lean in' ? (
        <LeanIn />
      ) : word === 'sweet and dangerous' ? (
        <Potion />
      ) : word === 'kept' ? (
        <Kept />
      ) : (
        <Signature />
      )}
    </FxWord>
  );
}
