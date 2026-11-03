/* Isolde: every charged word gets its own scene, built as three plates on
   separate clocks: a back plate of cold haze or light, a mid plate of painted
   sprites, a front plate of tiny glints.
     warm her hands  warm breath steam curls up, the word takes a warm flush
     worth hearing   snowflakes settle on the word, glint, then melt away
     ice breaks      a crack runs under the word, ice shards fly apart
     melt            an icicle swells one droplet that falls; the frost thaws
   Sprites: /fx/isolde/{steam,snowflake,shard,icicle}.png. They live in the
   frame's .fx-layer, behind the text, so no letter is ever covered. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import { asset } from '../../../../lib/asset';
import './isolde.css';

const SRC = {
  steam: asset('/fx/isolde/steam.png'),
  snowflake: asset('/fx/isolde/snowflake.png'),
  shard: asset('/fx/isolde/shard.png'),
  icicle: asset('/fx/isolde/icicle.png'),
} as const;

function Sprite(props: { src: string; className?: string }): JSX.Element {
  return <img className={props.className} src={props.src} alt="" width={256} height={256} draggable={false} decoding="async" />;
}

/* a four-point glint: the front plate */
function Glint(props: { x?: string; y?: string; s: number; t: string; d: string; at: 'flake' | 'free' }): JSX.Element {
  return (
    <span className={`is-glint is-glint-${props.at}`} style={v({ '--x': props.x ?? '50%', '--y': props.y ?? '50%', '--s': `${props.s}em`, '--t': props.t, '--d': props.d })}>
      <svg viewBox="0 0 24 24" width="100%" height="100%" focusable="false">
        <path d="M12 0C12.9 7.2 16.8 11.1 24 12C16.8 12.9 12.9 16.8 12 24C11.1 16.8 7.2 12.9 0 12C7.2 11.1 11.1 7.2 12 0Z" />
      </svg>
    </span>
  );
}

/* ---- warm her hands: breath steam ------------------------------------------ */
const PUFFS = [
  { x: '16%', w: 1.8, dx: '-0.3em', r: '-16deg', d: '0s' },
  { x: '40%', w: 2.2, dx: '0.25em', r: '12deg', d: '-0.7s' },
  { x: '64%', w: 1.9, dx: '-0.2em', r: '-10deg', d: '-1.5s' },
  { x: '88%', w: 1.6, dx: '0.3em', r: '18deg', d: '-2.2s' },
] as const;

function Warm(): JSX.Element {
  return (
    <span className="is-scene is-warm">
      <span className="is-haze" />
      <span className="is-haze is-haze-warm" />
      {PUFFS.map((p, i) => (
        <span key={i} className="is-a is-puff" style={v({ '--x': p.x, '--y': '-8%', '--w': `${p.w}em`, '--dx': p.dx, '--r': p.r, '--d': p.d })}>
          <Sprite className="is-sprite is-curl" src={SRC.steam} />
        </span>
      ))}
      <Glint x="30%" y="-22%" s={0.4} t="3.4s" d="-0.4s" at="free" />
      <Glint x="74%" y="-34%" s={0.32} t="4.1s" d="-1.9s" at="free" />
      <Glint x="52%" y="-52%" s={0.36} t="3.7s" d="-2.8s" at="free" />
    </span>
  );
}

/* ---- worth hearing: snowflakes settle on the top edge ----------------------- */
const FLAKES = [
  { x: '10%', y: '-0.15em', w: 1.2, dx: '-0.35em', r0: '-70deg', r: '12deg', d: '0s' },
  { x: '31%', y: '-0.45em', w: 1.4, dx: '0.4em', r0: '60deg', r: '-8deg', d: '-0.45s' },
  { x: '54%', y: '-0.2em', w: 1.15, dx: '-0.3em', r0: '-40deg', r: '20deg', d: '-0.9s' },
  { x: '74%', y: '-0.4em', w: 1.35, dx: '0.35em', r0: '80deg', r: '-14deg', d: '-0.25s' },
  { x: '92%', y: '-0.1em', w: 1.1, dx: '-0.25em', r0: '-55deg', r: '6deg', d: '-0.7s' },
] as const;

function Worth(): JSX.Element {
  return (
    <span className="is-scene is-worth">
      <span className="is-haze" />
      {FLAKES.map((f, i) => (
        <span key={i} className="is-a is-flake" style={v({ '--x': f.x, '--y': f.y, '--w': `${f.w}em`, '--dx': f.dx, '--r0': f.r0, '--r': f.r, '--d': f.d })}>
          <Sprite className="is-sprite" src={SRC.snowflake} />
          <Glint s={0.5} t="6s" d={f.d} at="flake" />
        </span>
      ))}
    </span>
  );
}

/* ---- ice breaks: a crack runs under the word, shards fly apart --------------- */
/* ex, ey: where the shard drifts to (em), r: how far it tumbles. */
const SHARDS = [
  { x: '24%', ex: '-1.5em', ey: '-0.9em', w: 1.5, r: '-140deg', f: -1, d: '0s' },
  { x: '38%', ex: '-0.5em', ey: '1.3em', w: 1.2, r: '110deg', f: 1, d: '-0.04s' },
  { x: '50%', ex: '0.1em', ey: '-1.35em', w: 1.8, r: '90deg', f: 1, d: '-0.08s' },
  { x: '64%', ex: '0.7em', ey: '1.2em', w: 1.25, r: '-120deg', f: -1, d: '-0.02s' },
  { x: '78%', ex: '1.6em', ey: '-0.8em', w: 1.5, r: '150deg', f: 1, d: '-0.06s' },
  { x: '88%', ex: '1.2em', ey: '1.05em', w: 1.1, r: '-90deg', f: -1, d: '-0.1s' },
] as const;

function Breaks(): JSX.Element {
  return (
    <span className="is-scene is-breaks">
      <span className="is-haze" />
      <span className="is-haze is-haze-flash" />
      <svg className="is-crack" viewBox="0 0 100 10" preserveAspectRatio="none" focusable="false">
        <path pathLength={1} d="M0 5L9 3L17 7L26 2L35 8L44 4L53 7L62 3L71 8L80 4L90 6L100 4" />
      </svg>
      {SHARDS.map((s, i) => (
        <span key={i} className="is-a is-shard" style={v({ '--x': s.x, '--y': '104%', '--w': `${s.w}em`, '--ex': s.ex, '--ey': s.ey, '--r': s.r, '--f': s.f, '--d': s.d })}>
          <Sprite className="is-sprite is-flip" src={SRC.shard} />
        </span>
      ))}
      <Glint x="50%" y="104%" s={0.7} t="6.4s" d="0s" at="free" />
    </span>
  );
}

/* ---- melt: an icicle swells one droplet, it falls ----------------------------- */
function Melt(): JSX.Element {
  return (
    <span className="is-scene is-melt">
      <span className="is-haze" />
      <span className="is-a is-icicle" style={v({ '--x': 'calc(100% + 0.2em)', '--y': '-0.25em', '--w': '1.9em' })}>
        <Sprite className="is-sprite is-sprite-top" src={SRC.icicle} />
      </span>
      <span className="is-a is-drop-anchor" style={v({ '--x': 'calc(100% + 0.2em)', '--y': '1.38em' })}>
        <span className="is-drop" />
      </span>
      <span className="is-ripple" style={v({ '--x': 'calc(100% + 0.2em)', '--y': '2.9em' })} />
      <Glint x="calc(100% + 0.2em)" y="1.38em" s={0.45} t="7s" d="0s" at="free" />
    </span>
  );
}

export default function IsoldeFx(props: FxProps): JSX.Element {
  const word = props.text.toLowerCase();
  const scene =
    word === 'warm her hands' ? <Warm /> : word === 'worth hearing' ? <Worth /> : word === 'ice breaks' ? <Breaks /> : <Melt />;
  return (
    <FxWord kind="isolde" text={props.text}>
      {scene}
    </FxWord>
  );
}
