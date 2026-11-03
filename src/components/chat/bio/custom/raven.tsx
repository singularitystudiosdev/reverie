/* Raven: one deliberate gesture per charged word, built on painted sprites
   (public/fx/raven/*.png) with CSS only for haze, glints and word fills.
     "cigarette smoke"  an ember glows, grey wisps curl up from it lazily
     "show you"         a black lipstick kiss presses on beside the word, with a smear
     "soft she gets"    a black feather sways down, damping, and settles at rest
     anything else      a guitar pick tossed and caught, violet glow
   Each word's beat is its own loop with its own length, so they never fire together. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import './raven.css';

const SPRITE = (name: string): string => `/fx/raven/${name}.png`;

function Sprite(props: { name: string; className: string; style?: Record<string, string | number> }): JSX.Element {
  return <img className={`raven-sp ${props.className}`} src={SPRITE(props.name)} alt="" draggable={false} style={props.style ? v(props.style) : undefined} />;
}

/** One wisp: x is its start along the word; a sprite inside a drift wrapper. */
const WISPS = [
  { d: '0s', x: '0.1em', r: '-18deg', dx: '0.45em', k: 1 },
  { d: '-2.4s', x: '-0.25em', r: '14deg', dx: '-0.15em', k: 0.82 },
  { d: '-4.7s', x: '0.35em', r: '30deg', dx: '0.7em', k: 0.92 },
] as const;

function Smoke(): JSX.Element {
  return (
    <>
      <span className="raven-haze raven-haze-smoke" />
      <span className="raven-ember">
        <span className="raven-ember-core" />
      </span>
      {WISPS.map((w, i) => (
        <span key={i} className="raven-wisp" style={v({ '--d': w.d, '--x': w.x, '--r': w.r, '--dx': w.dx, '--k': w.k })}>
          <Sprite name="smoke" className="raven-wisp-sp" />
        </span>
      ))}
    </>
  );
}

function Kiss(): JSX.Element {
  return (
    <>
      <span className="raven-haze raven-haze-kiss" />
      <span className="raven-kiss">
        <Sprite name="kiss" className="raven-smear" />
        <Sprite name="kiss" className="raven-print" />
        <span className="raven-glint" />
      </span>
    </>
  );
}

function Feather(): JSX.Element {
  return (
    <>
      <span className="raven-haze raven-haze-feather" />
      <span className="raven-rest-shadow" />
      <span className="raven-drift">
        <span className="raven-settle">
          <Sprite name="feather" className="raven-feather-sp" />
        </span>
      </span>
    </>
  );
}

function Pick(): JSX.Element {
  return (
    <>
      <span className="raven-haze raven-haze-pick" />
      <span className="raven-toss">
        <span className="raven-flip">
          <Sprite name="pick" className="raven-pick-sp" />
        </span>
      </span>
    </>
  );
}

export default function RavenFx(props: FxProps): JSX.Element {
  const word = props.text.toLowerCase();
  const which = word.includes('smoke') ? 'smoke' : word.includes('show you') ? 'kiss' : word.includes('soft') ? 'feather' : 'pick';
  return (
    <FxWord kind="raven" text={props.text}>
      <span className="raven-stage" data-word={which}>
        {which === 'smoke' ? <Smoke /> : which === 'kiss' ? <Kiss /> : which === 'feather' ? <Feather /> : <Pick />}
      </span>
    </FxWord>
  );
}
