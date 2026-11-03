/*
  Hanami (Shrine maiden, sakura world): every charged word of her bio has its
  own small scene, painted from her sprites (public/fx/hanami/*.png) and
  stitched with CSS/SVG light and thread.

    "ask for"  a paper wish slip on a red string flutters in a breath of wind
    "blush"    cherry blossoms open around the word, which flushes pink
    "fate"     a red thread winds around the word and ties a bow
    anything else: a lantern glow and drifting petals

  The scene is picked from the word's own text; hanami.css owns the motion.
*/
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import { asset } from '../../../../lib/asset';
import './hanami.css';

function Sprite(props: { name: string; className?: string }): JSX.Element {
  return (
    <img
      className={props.className ? `hn-sprite ${props.className}` : 'hn-sprite'}
      src={asset(`/fx/hanami/${props.name}.png`)}
      alt=""
      draggable={false}
      decoding="async"
    />
  );
}

/** A four-point glint: two crossed hairlines and a core, animated by CSS. */
function Glint(props: { className?: string }): JSX.Element {
  return <span className={props.className ? `hn-glint ${props.className}` : 'hn-glint'} />;
}

/* ---- "ask for": a wish slip on red string -------------------------------- */
function AskFor(): JSX.Element {
  return (
    <>
      <span className="hn-ask-halo" />
      <svg className="hn-string" viewBox="0 0 100 12" preserveAspectRatio="none" focusable="false">
        <path className="hn-string-line" d="M0 2.4 Q48 13 100 3.2" vectorEffect="non-scaling-stroke" />
        <path className="hn-string-hi" d="M0 1.6 Q48 12 100 2.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="hn-slip">
        <Sprite name="wish" className="hn-slip-img" />
        <Glint className="hn-slip-glint" />
      </span>
      <span className="hn-ask-knot" />
    </>
  );
}

/* ---- "blush": blossoms open around the word ------------------------------ */
const BLOSSOMS = [
  { k: -0.14, y: -0.35, size: 2.5, d: 0, rot: -24, sway: 3.6, tilt: -9 },
  { k: 0.26, y: -1.3, size: 1.9, d: 0.55, rot: 18, sway: 4.4, tilt: 7 },
  { k: 0.58, y: -1.8, size: 2.9, d: 1.05, rot: -10, sway: 3.9, tilt: -5 },
  { k: 1.02, y: -0.55, size: 2.3, d: 1.6, rot: 30, sway: 4.8, tilt: 8 },
  { k: 0.74, y: 1.15, size: 1.7, d: 2.1, rot: -34, sway: 3.3, tilt: -7 },
] as const;

const PETALS = [
  { k: 0.3, d: 3.1, dx: 0.5, spin: 200 },
  { k: 0.62, d: 3.5, dx: -0.4, spin: -160 },
  { k: 0.9, d: 3.9, dx: 0.35, spin: 240 },
] as const;

function Blush(): JSX.Element {
  return (
    <>
      <span className="hn-blush-glow" />
      {BLOSSOMS.map((b, i) => (
        <span
          key={i}
          className="hn-bloom"
          style={v({ '--k': b.k, '--y': `${b.y}em`, '--sz': `${b.size}em`, '--d': `${b.d}s`, '--rot': `${b.rot}deg`, '--sway': `${b.sway}s`, '--tilt': `${b.tilt}deg` })}
        >
          <span className="hn-bloom-sway">
            <Sprite name="blossom" className="hn-bloom-img" />
          </span>
        </span>
      ))}
      {PETALS.map((p, i) => (
        <span
          key={i}
          className="hn-shed"
          style={v({ '--k': p.k, '--d': `${p.d}s`, '--dx': `${p.dx}em`, '--spin': `${p.spin}deg` })}
        >
          <span className="hn-petal" />
        </span>
      ))}
    </>
  );
}

/* ---- "fate": a red thread winds round the word and ties a bow ------------ */
function Fate(props: { text: string }): JSX.Element {
  // 1 svg unit = 0.04em; the loops hug the word's estimated width
  const w = Math.round((props.text.length * 0.54 + 0.9) / 0.04);
  const h = 56;
  const rx = w / 2 - 2;
  const ry = 21;
  const cy = h / 2 - 3;
  const rx2 = rx * 0.9;
  const ry2 = ry * 0.8;
  const x2 = 2 + 2 * rx2;
  const ex = x2 - 5;
  const ey = cy + 23;
  // loop one: over the top, under the bottom, back to the left; loop two: a
  // tighter turn over the top, then a loose tail down to where the bow sits
  const path =
    `M2 ${cy} A${rx} ${ry} 0 0 1 ${w - 2} ${cy} A${rx} ${ry} 0 0 1 2 ${cy} ` +
    `A${rx2} ${ry2} 0 0 1 ${x2} ${cy} Q${x2 + 3} ${cy + 13} ${ex} ${ey}`;
  return (
    <>
      <span className="hn-fate-glow" />
      <svg className="hn-thread" viewBox={`0 0 ${w} ${h}`} style={v({ '--hn-w': w, '--hn-h': h })} focusable="false" overflow="visible">
        <path className="hn-thread-back" pathLength={1} d={path} />
        <path className="hn-thread-line" pathLength={1} d={path} />
        <path className="hn-thread-hi" pathLength={1} d={path} />
      </svg>
      <span className="hn-bow" style={v({ '--ex': ex, '--ey': ey })}>
        <Sprite name="thread" className="hn-bow-img" />
        <Glint className="hn-bow-glint" />
      </span>
    </>
  );
}

/* ---- fallback: lantern glow and drifting petals --------------------------- */
const DRIFT = [
  { k: 0.15, d: 0, dx: 0.5, spin: 180 },
  { k: 0.5, d: 1.8, dx: -0.45, spin: -210 },
  { k: 0.85, d: 3.4, dx: 0.4, spin: 160 },
] as const;

function Drift(): JSX.Element {
  return (
    <>
      <span className="hn-lantern-glow" />
      <span className="hn-lantern">
        <Sprite name="lantern" className="hn-lantern-img" />
      </span>
      {DRIFT.map((p, i) => (
        <span key={i} className="hn-fall" style={v({ '--k': p.k, '--d': `${p.d}s`, '--dx': `${p.dx}em`, '--spin': `${p.spin}deg` })}>
          <span className="hn-petal" />
        </span>
      ))}
    </>
  );
}

export default function HanamiFx(props: FxProps): JSX.Element {
  const word = props.text.trim().toLowerCase();
  return (
    <FxWord kind="hanami" text={props.text}>
      {word === 'ask for' ? (
        <AskFor />
      ) : word === 'blush' ? (
        <Blush />
      ) : word === 'fate' ? (
        <Fate text={word} />
      ) : (
        <Drift />
      )}
    </FxWord>
  );
}
