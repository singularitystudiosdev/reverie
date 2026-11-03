/* Kiyo: one spell per charged word, each a four-beat loop (a gathering glow,
   the cast, a linger of sparks, a dissipating puff) built around painted
   sprites in /fx/kiyo/. The frame mirrors FxWord (same classes, so bio.css's
   word layer and forced-colors rules still apply) and adds data-word, which
   the CSS keys each word's fill treatment on.
     "forget the riddle": a foxfire wisp circles the phrase and the riddle dims
     "foxfire":           blue flames ignite along the letter tips, left to right
     "falling maples":    maple leaves spiral down and settle under the phrase
     "steal a kiss":      a kitsune mask tilts up while a tail swishes behind */
import type { JSX, ReactNode } from 'react';
import { v, type FxProps } from '../FxWord';
import './kiyo.css';

type Word = 'riddle' | 'foxfire' | 'maples' | 'kiss';

function wordOf(text: string): Word {
  const t = text.toLowerCase();
  if (t.includes('riddle')) return 'riddle';
  if (t.includes('maple')) return 'maples';
  if (t.includes('kiss')) return 'kiss';
  return 'foxfire';
}

const SRC = {
  wisp: '/fx/kiyo/wisp.png',
  maple: '/fx/kiyo/maple.png',
  mask: '/fx/kiyo/mask.png',
  tail: '/fx/kiyo/tail.png',
} as const;

function Frame(props: { word: Word; text: string; children: ReactNode }): JSX.Element {
  return (
    <span className="fx" data-fx="kiyo" data-word={props.word} style={v({ '--fx-n': props.text.length })}>
      <span className="fx-text" data-w={props.text}>
        {props.text}
      </span>
      <span className="fx-layer" aria-hidden="true">
        {props.children}
      </span>
    </span>
  );
}

/** A sprite actor: the outer span places and runs the beat, the middle one
    sways, the img carries its own small motion (flicker, spin, swish). */
function Actor(props: { src: string; cls: string; style: ReturnType<typeof v>; mid?: string; img?: string }): JSX.Element {
  return (
    <span className={`ky-actor ${props.cls}`} style={props.style}>
      <span className={`ky-mid ${props.mid ?? ''}`}>
        <img className={`ky-img ${props.img ?? ''}`} src={props.src} alt="" draggable={false} decoding="async" />
      </span>
    </span>
  );
}

const SPARKS = [
  { x: '14%', y: '88%', dx: '-0.15em', s: '0.14em', k: 0 },
  { x: '38%', y: '96%', dx: '0.2em', s: '0.1em', k: 1 },
  { x: '62%', y: '90%', dx: '-0.18em', s: '0.13em', k: 2 },
  { x: '86%', y: '98%', dx: '0.15em', s: '0.1em', k: 3 },
  { x: '50%', y: '10%', dx: '0.12em', s: '0.09em', k: 4 },
] as const;

function Sparks(): JSX.Element {
  return (
    <>
      {SPARKS.map((p, i) => (
        <span key={i} className="ky-spark" style={v({ '--x': p.x, '--y': p.y, '--dx': p.dx, '--s': p.s, '--k': p.k })} />
      ))}
    </>
  );
}

function Puffs(): JSX.Element {
  return (
    <>
      <span className="ky-puff" style={v({ '--x': '30%', '--k': 0 })} />
      <span className="ky-puff" style={v({ '--x': '70%', '--k': 1 })} />
    </>
  );
}

function Riddle(props: { text: string }): JSX.Element {
  return (
    <Frame word="riddle" text={props.text}>
      <span className="ky-haze" />
      <span className="ky-beat">
        <span className="ky-ring">
          <span className="ky-ring-y">
            <Actor src={SRC.wisp} cls="ky-wisp" mid="" img="ky-flick" style={v({ '--s': '1.5em' })} />
          </span>
        </span>
      </span>
      <Sparks />
      <Puffs />
    </Frame>
  );
}

const FLAME_N = 7;

function Foxfire(props: { text: string }): JSX.Element {
  return (
    <Frame word="foxfire" text={props.text}>
      <span className="ky-haze ky-haze-low" />
      {Array.from({ length: FLAME_N }, (_, i) => (
        <Actor
          key={i}
          src={SRC.wisp}
          cls="ky-flame"
          img="ky-flick"
          style={v({ '--x': `${((i + 0.5) / FLAME_N) * 100}%`, '--y': '-0.05em', '--s': `${i % 2 ? 1.25 : 1.55}em`, '--k': i, '--fd': `${-0.13 * i}s` })}
        />
      ))}
      <Sparks />
    </Frame>
  );
}

const LEAVES = [
  { x: '8%', dx: '0.3em', y1: '1.35em', s: '1.45em', k: 0, rot: '-30deg' },
  { x: '28%', dx: '-0.4em', y1: '1.5em', s: '1.7em', k: 2, rot: '40deg' },
  { x: '50%', dx: '0.45em', y1: '1.3em', s: '1.4em', k: 1, rot: '-50deg' },
  { x: '72%', dx: '-0.3em', y1: '1.55em', s: '1.6em', k: 3, rot: '25deg' },
  { x: '92%', dx: '0.25em', y1: '1.4em', s: '1.45em', k: 4, rot: '-20deg' },
] as const;

function Maples(props: { text: string }): JSX.Element {
  return (
    <Frame word="maples" text={props.text}>
      <span className="ky-haze ky-haze-amber" />
      {LEAVES.map((l, i) => (
        <Actor
          key={i}
          src={SRC.maple}
          cls="ky-leaf"
          mid="ky-sway"
          img="ky-spin"
          style={v({ '--x': l.x, '--y': '-0.9em', '--dx': l.dx, '--y1': l.y1, '--s': l.s, '--k': l.k, '--rot': l.rot })}
        />
      ))}
      <Sparks />
    </Frame>
  );
}

function Kiss(props: { text: string }): JSX.Element {
  return (
    <Frame word="kiss" text={props.text}>
      <span className="ky-haze ky-haze-end" />
      <Actor src={SRC.tail} cls="ky-tail" img="ky-swish" style={v({ '--x': '100%', '--y': '58%', '--s': '2.1em' })} />
      <Actor src={SRC.mask} cls="ky-mask" img="ky-tilt" style={v({ '--x': '84%', '--y': '-0.7em', '--s': '1.75em' })} />
      <Sparks />
      <Puffs />
    </Frame>
  );
}

export default function KiyoFx(props: FxProps): JSX.Element {
  switch (wordOf(props.text)) {
    case 'riddle':
      return <Riddle text={props.text} />;
    case 'maples':
      return <Maples text={props.text} />;
    case 'kiss':
      return <Kiss text={props.text} />;
    default:
      return <Foxfire text={props.text} />;
  }
}
