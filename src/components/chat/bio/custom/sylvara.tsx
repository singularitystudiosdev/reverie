/*
  Sylvara (Elk dryad, Elderwood grove). One bespoke scene per charged word,
  built from the painted sprites in /fx/sylvara/ and a little SVG/CSS glue:

    "stay the night"         cold open on the dark word, a crescent moon rises
                             behind it, ivy draws itself along the baseline,
                             white blossoms open, a firefly blooms at the tip.
    "barefoot and unhurried" moss tufts sprout under the phrase one after the
                             other like slow footsteps while a warm light band
                             walks across the letters.
    "listening hard"         fireflies drift in from the dark and pulse in a
                             heartbeat rhythm; the word's glow beats with them.

  Unknown text falls back to the ivy-and-firefly baseline of the first scene.
  All motion lives in sylvara.css (keyframes prefixed sylvara-).
*/
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import { asset } from '../../../../lib/asset';
import './sylvara.css';

const SPR = asset('/fx/sylvara/');
const src = (name: string): string => `${SPR}${name}.png`;

const f = (n: number): string => n.toFixed(3);

function Spr(props: { name: string; cls: string; style?: Record<string, string | number> }): JSX.Element {
  return <img className={`sy-spr ${props.cls}`} src={src(props.name)} alt="" draggable={false} decoding="async" style={props.style ? v(props.style) : undefined} />;
}

/* ---- "stay the night": moon, ivy along the baseline, blossoms, firefly ---- */

const H = 3.6;
const BASE = 2.62; // y of the ivy stem (just under the word's box)

/** A gently waving baseline stem from x0 to x1: [path d, tip x, tip y]. */
function stem(x0: number, x1: number): { d: string; pts: [number, number][] } {
  const steps = Math.max(3, Math.round((x1 - x0) / 1.5));
  const dx = (x1 - x0) / steps;
  const pts: [number, number][] = [];
  let d = `M${f(x0)} ${f(BASE)}`;
  let py = BASE;
  for (let i = 1; i <= steps; i += 1) {
    const x = x0 + dx * i;
    const y = BASE + (i % 2 === 0 ? -0.1 : 0.12);
    d += ` C${f(x - dx * 0.55)} ${f(py)} ${f(x - dx * 0.45)} ${f(y)} ${f(x)} ${f(y)}`;
    pts.push([x, y]);
    py = y;
  }
  return { d, pts };
}

function StayNight(props: { text: string; moon: boolean }): JSX.Element {
  const W = props.text.length * 0.54 + 1.6;
  const { d, pts } = stem(0.5, W - 0.5);
  const tip = pts[pts.length - 1];
  const moonX = W * 0.74;
  return (
    <FxWord kind="sylvara" text={props.text}>
      <span className="sy-halo" />
      <svg className="sy-scene" viewBox={`0 0 ${f(W)} ${H}`} style={{ width: `${f(W)}em`, height: `${H}em` }} focusable="false">
        {props.moon ? (
          <g transform={`translate(${f(moonX)} 0.95)`}>
            <g className="sy-moon">
              <image href={src('moon')} x={-1.3} y={-1.3} width={2.6} height={2.6} />
            </g>
          </g>
        ) : null}
        <path className="sy-stem" d={d} pathLength={1} />
        {pts.map(([x, y], i) => {
          const up = i % 2 === 0;
          return (
            <g key={i} transform={`translate(${f(x)} ${f(y)}) rotate(${up ? -28 : 150}) `}>
              <g className="sy-sprig" style={v({ '--ld': `${(0.8 + i * 0.32).toFixed(2)}s` })}>
                <image href={src('ivy')} x={-0.2} y={-2} width={2} height={2} />
              </g>
            </g>
          );
        })}
        {[0.2, 0.52, 0.8].map((k, i) => (
          <g key={k} transform={`translate(${f(W * k)} ${f(BASE + 0.62)})`}>
            <g className="sy-bloom" style={v({ '--ld': `${(1.9 + i * 0.55).toFixed(2)}s` })}>
              <image href={src('blossom')} x={-0.85} y={-0.85} width={1.7} height={1.7} />
            </g>
          </g>
        ))}
        <g transform={`translate(${f(tip[0] + 0.15)} ${f(tip[1] - 0.45)})`}>
          <g className="sy-tipfly">
            <image href={src('firefly')} x={-0.65} y={-0.65} width={1.3} height={1.3} />
          </g>
        </g>
      </svg>
    </FxWord>
  );
}

/* ---- "barefoot and unhurried": moss footsteps ---- */

const STEPS = [
  { x: 9, y: 0.02 },
  { x: 29, y: 0.2 },
  { x: 49, y: 0.02 },
  { x: 69, y: 0.2 },
  { x: 90, y: 0.02 },
] as const;

function Barefoot(props: { text: string }): JSX.Element {
  return (
    <FxWord kind="sylvara" text={props.text}>
      <span className="sy-halo sy-halo-soft" />
      {STEPS.map((s, i) => (
        <span key={i} className="sy-step" style={v({ '--x': `${s.x}%`, '--dy': `${s.y}em`, '--sd': `${(i * 0.85).toFixed(2)}s`, '--tilt': `${i % 2 === 0 ? -5 : 6}deg` })}>
          <span className="sy-print" />
          <span className="sy-mound" />
          <Spr name="ivy" cls="sy-moss" />
          <span className="sy-spore sy-spore-a" />
          <span className="sy-spore sy-spore-b" />
        </span>
      ))}
    </FxWord>
  );
}

/* ---- "listening hard": fireflies drift in and beat like a heart ---- */

const FLIES = [
  { x: 6, y: -0.95, fx: -2.6, fy: -0.6, s: 1.81, bob: 3.6 },
  { x: 33, y: -1.15, fx: -1.4, fy: -1.6, s: 1.52, bob: 4.2 },
  { x: 66, y: -1.0, fx: 1.6, fy: -1.7, s: 1.89, bob: 3.9 },
  { x: 95, y: -0.8, fx: 2.8, fy: -0.5, s: 1.59, bob: 3.3 },
  { x: 18, y: 1.05, fx: -2.2, fy: 1.5, s: 1.59, bob: 4.5 },
  { x: 50, y: 1.2, fx: 0.4, fy: 2.0, s: 1.74, bob: 3.7 },
  { x: 82, y: 1.05, fx: 2.4, fy: 1.6, s: 1.45, bob: 4.1 },
] as const;

function Listening(props: { text: string }): JSX.Element {
  return (
    <FxWord kind="sylvara" text={props.text}>
      <span className="sy-halo sy-halo-beat" />
      {FLIES.map((p, i) => (
        <span
          key={i}
          className="sy-fly"
          style={v({ '--x': `${p.x}%`, '--y': `${p.y}em`, '--fx': `${p.fx}em`, '--fy': `${p.fy}em`, '--s': `${p.s}em`, '--bob': `${p.bob}s`, '--fd': `${(i * 0.22).toFixed(2)}s` })}
        >
          <span className="sy-fly-bob">
            <Spr name="firefly" cls="sy-fly-img" />
          </span>
        </span>
      ))}
    </FxWord>
  );
}

export default function SylvaraFx(props: FxProps): JSX.Element {
  const key = props.text.trim().toLowerCase();
  if (key === 'barefoot and unhurried') return <Barefoot text={props.text} />;
  if (key === 'listening hard') return <Listening text={props.text} />;
  return <StayNight text={props.text} moon={key === 'stay the night'} />;
}
