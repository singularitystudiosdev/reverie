/* Cinder: every charged word gets its own scene, built as three plates on
   separate clocks: a back plate of light (heat bloom), a mid plate of painted
   sprites doing the action, and a front plate of tiny sparks.
     closer    embers drift in from both sides and warm the word
     light up  a flame blooms in an open palm beneath the word
     burn      flame tongues lick the top edge, the letters glow like coals
     dare      a playing card catches fire at its corner and curls to ash
   Sprites: /fx/cinder/{ember,flame,card}.png. The sprite layer sits behind
   the text (the frame's .fx-layer), so no letter is ever covered. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import './cinder.css';

const SRC = {
  ember: '/fx/cinder/ember.png',
  flame: '/fx/cinder/flame.png',
  card: '/fx/cinder/card.png',
  tongue: '/fx/cinder/tongue.png',
} as const;

function Sprite(props: { src: string; className?: string }): JSX.Element {
  return <img className={props.className} src={props.src} alt="" width={256} height={256} draggable={false} decoding="async" />;
}

/* a small glowing fleck: the front plate (sparks, ash) */
function Fleck(props: { x: string; y: string; dx: string; rise: string; t: string; d: string; s: number }): JSX.Element {
  return (
    <span
      className="cn-fleck"
      style={v({ '--x': props.x, '--y': props.y, '--dx': props.dx, '--rise': props.rise, '--t': props.t, '--d': props.d, '--s': `${props.s}em` })}
    >
      <span className="cn-fleck-dot" />
    </span>
  );
}

/* ---- closer: embers drift toward the word from both sides ----------------- */
/* sx, sy: where it starts, relative to where it lands (em). */
const EMBERS = [
  { x: '98%', y: '-8%', sx: '2.4em', sy: '-0.9em', w: 2, d: '0s', r: '-14deg' },
  { x: '84%', y: '112%', sx: '2.2em', sy: '0.9em', w: 1.6, d: '-0.45s', r: '20deg' },
  { x: '6%', y: '-6%', sx: '-2.4em', sy: '-0.7em', w: 1.8, d: '-0.9s', r: '10deg' },
  { x: '16%', y: '114%', sx: '-2.2em', sy: '1em', w: 1.4, d: '-1.3s', r: '-24deg' },
] as const;

function Closer(): JSX.Element {
  return (
    <span className="cn-scene cn-closer">
      <span className="cn-bloom" />
      {EMBERS.map((e, i) => (
        <span key={i} className="cn-a cn-drift" style={v({ '--x': e.x, '--y': e.y, '--sx': e.sx, '--sy': e.sy, '--w': `${e.w}em`, '--d': e.d, '--r': e.r })}>
          <Sprite className="cn-sprite cn-bob" src={SRC.ember} />
        </span>
      ))}
      <Fleck x="94%" y="30%" dx="0.3em" rise="0.7em" t="2.8s" d="-0.4s" s={0.07} />
      <Fleck x="10%" y="90%" dx="-0.25em" rise="0.6em" t="3.3s" d="-1.5s" s={0.06} />
      <Fleck x="52%" y="-6%" dx="0.15em" rise="0.8em" t="2.5s" d="-2s" s={0.08} />
    </span>
  );
}

/* ---- light up: a flame blooms in an open palm beneath the word ------------- */
function Palm(): JSX.Element {
  return (
    <svg viewBox="0 0 64 26" width="100%" height="100%" className="cn-palm-svg" focusable="false">
      <path className="cn-palm-back" d="M2 7C4 20 22 25 32 25C42 25 60 20 62 7C58 11 52 8 49 5C44 13 20 13 15 5C12 8 6 11 2 7Z" />
      <path className="cn-palm-lip" d="M5 8C10 17 24 20 32 20C40 20 54 17 59 8C50 15 14 15 5 8Z" />
      <path className="cn-palm-line" d="M18 14C24 17 40 17 46 14" />
    </svg>
  );
}

function LightUp(): JSX.Element {
  return (
    <span className="cn-scene cn-lightup">
      <span className="cn-bloom cn-bloom-low" />
      <span className="cn-a cn-palm" style={v({ '--x': '50%', '--y': '100%', '--w': '2.8em' })}>
        <span className="cn-palm-box">
          <Palm />
        </span>
      </span>
      <span className="cn-a cn-bloomflame" style={v({ '--x': '50%', '--y': 'calc(100% + 0.3em)', '--w': '1.6em' })}>
        <Sprite className="cn-sprite cn-sprite-bottom cn-sway" src={SRC.flame} />
      </span>
      <Fleck x="44%" y="118%" dx="-0.3em" rise="1.5em" t="2.6s" d="-0.6s" s={0.08} />
      <Fleck x="58%" y="118%" dx="0.3em" rise="1.7em" t="3.2s" d="-1.9s" s={0.07} />
      <Fleck x="51%" y="118%" dx="0.05em" rise="1.3em" t="2.2s" d="-1.2s" s={0.06} />
    </span>
  );
}

/* ---- burn: flame tongues lick the top edge, the letters glow like coals ---- */
const TONGUES = [
  { x: '9%', y: '34%', w: 1, t: '1.5s', d: '-0.4s', k: '0.62s', hue: '-6deg' },
  { x: '28%', y: '28%', w: 1.3, t: '1.9s', d: '-1.3s', k: '0.78s', hue: '4deg' },
  { x: '46%', y: '36%', w: 1.05, t: '1.4s', d: '-0.8s', k: '0.55s', hue: '-2deg' },
  { x: '64%', y: '29%', w: 1.35, t: '2.1s', d: '-0.2s', k: '0.7s', hue: '8deg' },
  { x: '82%', y: '35%', w: 1, t: '1.7s', d: '-1.1s', k: '0.6s', hue: '-4deg' },
  { x: '96%', y: '40%', w: 0.8, t: '1.3s', d: '-0.6s', k: '0.66s', hue: '2deg' },
] as const;

function Burn(): JSX.Element {
  return (
    <span className="cn-scene cn-burn">
      <span className="cn-bloom cn-bloom-wide" />
      {TONGUES.map((f, i) => (
        <span key={i} className="cn-a cn-tongue" style={v({ '--x': f.x, '--y': f.y, '--w': `${f.w}em`, '--t': f.t, '--d': f.d, '--k': f.k, '--hue': f.hue })}>
          <Sprite className="cn-sprite cn-sprite-bottom cn-wobble" src={i % 2 === 0 ? SRC.flame : SRC.tongue} />
        </span>
      ))}
      <Fleck x="14%" y="38%" dx="-0.25em" rise="1em" t="2.6s" d="-0.3s" s={0.09} />
      <Fleck x="33%" y="32%" dx="0.2em" rise="1.1em" t="3.4s" d="-1.8s" s={0.07} />
      <Fleck x="52%" y="36%" dx="-0.15em" rise="0.9em" t="2.2s" d="-1.1s" s={0.1} />
      <Fleck x="70%" y="30%" dx="0.3em" rise="1.15em" t="3.8s" d="-2.6s" s={0.07} />
      <Fleck x="88%" y="36%" dx="-0.3em" rise="1em" t="2.9s" d="-0.9s" s={0.09} />
    </span>
  );
}

/* ---- dare: a card catches fire at its corner, curls and turns to ash ------- */
function Dare(): JSX.Element {
  return (
    <span className="cn-scene cn-dare">
      <span className="cn-bloom cn-bloom-right" />
      <span className="cn-a cn-card" style={v({ '--x': 'calc(100% + 1em)', '--y': '42%', '--w': '1.9em' })}>
        <span className="cn-card-box">
          <Sprite className="cn-sprite cn-card-img" src={SRC.card} />
          <span className="cn-a cn-cardflame" style={v({ '--w': '1em' })}>
            <Sprite className="cn-sprite cn-sprite-bottom cn-wobble" src={SRC.tongue} />
          </span>
        </span>
      </span>
      <Fleck x="calc(100% + 0.8em)" y="10%" dx="0.35em" rise="1.1em" t="2.4s" d="-0.2s" s={0.07} />
      <Fleck x="calc(100% + 1.2em)" y="20%" dx="-0.2em" rise="1.3em" t="3s" d="-1.4s" s={0.06} />
      <Fleck x="calc(100% + 1em)" y="0%" dx="0.1em" rise="1em" t="2.8s" d="-2.1s" s={0.08} />
    </span>
  );
}

export default function CinderFx(props: FxProps): JSX.Element {
  const word = props.text.toLowerCase();
  const scene =
    word === 'closer' ? <Closer /> : word === 'light up' ? <LightUp /> : word === 'dare' ? <Dare /> : <Burn />;
  return (
    <FxWord kind="cinder" text={props.text}>
      {scene}
    </FxWord>
  );
}
