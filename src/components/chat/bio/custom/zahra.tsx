/* Zahra: one spell per charged word, each a four-beat loop (a gathering glow,
   the cast, a linger of glitter, a dissipating fade) built around painted
   sprites in /fx/zahra/. The frame mirrors FxWord (same classes, so bio.css's
   word layer and forced-colors rules still apply) and adds data-word, which
   the CSS keys each word's fill treatment on.
     "wants":      gold coins spill from above and land under the word
     "smoke curl": ribbons of golden smoke curl up through the phrase
     "desire":     a magic lamp is rubbed to life, blooms, and breathes smoke */
import type { JSX, ReactNode } from 'react';
import { v, type FxProps } from '../FxWord';
import './zahra.css';

type Word = 'wants' | 'smoke' | 'desire';

function wordOf(text: string): Word {
  const t = text.toLowerCase();
  if (t.includes('want')) return 'wants';
  if (t.includes('desire')) return 'desire';
  return 'smoke';
}

const SRC = {
  coin: '/fx/zahra/coin.png',
  smoke: '/fx/zahra/smoke.png',
  lamp: '/fx/zahra/lamp.png',
  glitter: '/fx/zahra/glitter.png',
} as const;

function Frame(props: { word: Word; text: string; children: ReactNode }): JSX.Element {
  return (
    <span className="fx" data-fx="zahra" data-word={props.word} style={v({ '--fx-n': props.text.length })}>
      <span className="fx-text" data-w={props.text}>
        {props.text}
      </span>
      <span className="fx-layer" aria-hidden="true">
        {props.children}
      </span>
    </span>
  );
}

/** A sprite actor: the outer span places it and runs the beat, the middle one
    sways, the img carries its own small motion (flip, rub, turn). */
function Actor(props: { src: string; cls: string; style: ReturnType<typeof v>; mid?: string; img?: string }): JSX.Element {
  return (
    <span className={`zh-actor ${props.cls}`} style={props.style}>
      <span className={`zh-mid ${props.mid ?? ''}`}>
        <img className={`zh-img ${props.img ?? ''}`} src={props.src} alt="" draggable={false} decoding="async" />
      </span>
    </span>
  );
}

/* Four-point gold glints (front detail): linger beat, each on its own offset. */
const GLINTS = [
  { x: '10%', y: '-0.35em', s: '0.34em', k: 0 },
  { x: '34%', y: '1.55em', s: '0.26em', k: 3 },
  { x: '58%', y: '-0.55em', s: '0.3em', k: 1 },
  { x: '80%', y: '1.45em', s: '0.36em', k: 4 },
  { x: '96%', y: '0.2em', s: '0.24em', k: 2 },
  { x: '46%', y: '0.6em', s: '0.2em', k: 5 },
] as const;

function Glints(): JSX.Element {
  return (
    <>
      {GLINTS.map((g, i) => (
        <span key={i} className="zh-glint" style={v({ '--x': g.x, '--y': g.y, '--s': g.s, '--k': g.k })} />
      ))}
    </>
  );
}

const COINS = [
  { dx: '-0.2em', y1: '1.45em', s: '1.35em', k: 0 },
  { dx: '-0.7em', y1: '1.6em', s: '1.15em', k: 1 },
  { dx: '-1.2em', y1: '1.4em', s: '1.4em', k: 2 },
  { dx: '-1.75em', y1: '1.62em', s: '1.2em', k: 3 },
  { dx: '-2.2em', y1: '1.45em', s: '1.3em', k: 4 },
] as const;

function Wants(props: { text: string }): JSX.Element {
  return (
    <Frame word="wants" text={props.text}>
      <span className="zh-haze zh-haze-corner" />
      {COINS.map((c, i) => (
        <Actor
          key={i}
          src={SRC.coin}
          cls="zh-coin"
          mid="zh-flip"
          img="zh-coin-img"
          style={v({ '--x': '86%', '--y': '-0.7em', '--dx': c.dx, '--y1': c.y1, '--s': c.s, '--k': c.k })}
        />
      ))}
      <Glints />
    </Frame>
  );
}

const RIBBONS = [
  { x: '14%', s: '2.3em', k: 0, dx: '0.35em', rot: '-12deg' },
  { x: '42%', s: '2.7em', k: 1, dx: '-0.3em', rot: '10deg' },
  { x: '70%', s: '2.4em', k: 2, dx: '0.4em', rot: '-8deg' },
  { x: '92%', s: '2.1em', k: 3, dx: '-0.35em', rot: '14deg' },
] as const;

function SmokeCurl(props: { text: string }): JSX.Element {
  return (
    <Frame word="smoke" text={props.text}>
      <span className="zh-haze" />
      {RIBBONS.map((r, i) => (
        <Actor
          key={i}
          src={SRC.smoke}
          cls="zh-ribbon"
          mid="zh-curl"
          style={v({ '--x': r.x, '--y': '55%', '--s': r.s, '--k': r.k, '--dx': r.dx, '--rot': r.rot })}
        />
      ))}
      <Glints />
    </Frame>
  );
}

function Desire(props: { text: string }): JSX.Element {
  return (
    <Frame word="desire" text={props.text}>
      <span className="zh-haze zh-haze-lamp" />
      <Actor src={SRC.smoke} cls="zh-spout" mid="zh-curl" style={v({ '--x': 'calc(28% + 0.72em)', '--y': '1.4em', '--s': '2em', '--k': 0, '--dx': '0.25em', '--rot': '-10deg' })} />
      <Actor src={SRC.lamp} cls="zh-lamp" img="zh-rub" style={v({ '--x': '28%', '--y': '1.85em', '--s': '1.7em' })} />
      <Actor src={SRC.glitter} cls="zh-burst" img="zh-twirl" style={v({ '--x': 'calc(28% + 0.72em)', '--y': '1.3em', '--s': '1.6em' })} />
      <Glints />
    </Frame>
  );
}

export default function ZahraFx(props: FxProps): JSX.Element {
  switch (wordOf(props.text)) {
    case 'wants':
      return <Wants text={props.text} />;
    case 'desire':
      return <Desire text={props.text} />;
    default:
      return <SmokeCurl text={props.text} />;
  }
}
