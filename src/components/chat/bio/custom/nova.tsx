/* Nova (Netrunner, neon world): one bespoke effect per charged word, built on
   the generated sprites in /fx/nova/ (hud, plug, token, glyph).

   "noticed"        a HUD heart beats beside it while an ECG trace draws
                    under the word and the pulse climbs: every beat comes
                    quicker, the word flashes on each and the heart heats from cyan to magenta.
   "stay jacked in" the plug slides in from above, winds back, slams into a
                    port on the word's edge with sparks, and the power runs
                    through the letters from the port; then it unplugs.
   "always wins"    an arcade token is tossed, flips three times, lands on the
                    word's top edge, bounces, then spins down like a coin on a
                    table and settles face up as a white-hot seam passes.
   anything else    the neon glitch signature (cyan and magenta copies split,
                    a scanline passes, tiny glyphs flick up).

   The word-specific fills live in nova.css keyed on the .nova-m-* marker in
   the layer (:has), so one component can style the text it renders. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import { asset } from '../../../../lib/asset';
import './nova.css';

const SPRITE = asset('/fx/nova');

function Sprite(props: { name: string; className: string }): JSX.Element {
  return <img className={`nova-s ${props.className}`} src={`${SPRITE}/${props.name}.png`} alt="" draggable={false} decoding="async" />;
}

/* ---- noticed ---------------------------------------------------------- */

/* R peaks of the ECG across a 0..100 span; each beat is tighter than the last. */
const BEATS = [
  { c: 14, w: 9 },
  { c: 38, w: 8 },
  { c: 60, w: 7 },
  { c: 80, w: 6 },
] as const;

function ecgPath(): string {
  const f = (n: number): string => n.toFixed(2);
  let d = 'M0 10';
  for (const { c, w } of BEATS) {
    d +=
      ` L${f(c - w)} 10 L${f(c - w * 0.6)} 8.4 L${f(c - w * 0.3)} 10 L${f(c - w * 0.18)} 11.2` +
      ` L${f(c)} 0.6 L${f(c + w * 0.2)} 18.8 L${f(c + w * 0.42)} 10 L${f(c + w * 0.8)} 8.6 L${f(c + w * 1.1)} 10`;
  }
  return `${d} L100 10`;
}

const ECG_D = ecgPath();

function Noticed(): JSX.Element {
  return (
    <>
      <span className="nova-m-noticed" />
      <span className="nova-ecg">
        <svg viewBox="0 0 100 20" preserveAspectRatio="none" focusable="false">
          <path className="nova-ecg-glow" d={ECG_D} vectorEffect="non-scaling-stroke" />
          <path className="nova-ecg-line" d={ECG_D} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="nova-ecg-rail">
          <span className="nova-ecg-edge" />
        </span>
      </span>
      <span className="nova-heart">
        <Sprite name="hud" className="nova-heart-img" />
        <span className="nova-heart-ring" />
      </span>
    </>
  );
}

/* ---- stay jacked in --------------------------------------------------- */

const SPARKS = [
  { a: -168, l: 0.7, m: 0 },
  { a: -140, l: 1.0, m: 1 },
  { a: -112, l: 0.8, m: 0 },
  { a: -84, l: 1.1, m: 1 },
  { a: -58, l: 0.75, m: 0 },
  { a: -30, l: 0.95, m: 1 },
  { a: -8, l: 0.6, m: 0 },
] as const;

function JackedIn(): JSX.Element {
  return (
    <>
      <span className="nova-m-jack" />
      <span className="nova-port">
        <span className="nova-port-ring" />
        <span className="nova-port-core" />
        {SPARKS.map((s, i) => (
          <span key={i} className="nova-spark" data-m={s.m} style={v({ '--a': `${s.a}deg`, '--l': `${s.l}em` })} />
        ))}
        <Sprite name="glyph" className="nova-port-glyph" />
      </span>
      <span className="nova-plug">
        <Sprite name="plug" className="nova-plug-img" />
      </span>
    </>
  );
}

/* ---- always wins ------------------------------------------------------ */

const PIXELS = [
  { x: -1.1, y: -1.0, r: 20, m: 0 },
  { x: -0.55, y: -1.45, r: -35, m: 1 },
  { x: 0.1, y: -1.25, r: 50, m: 0 },
  { x: 0.7, y: -1.5, r: -20, m: 1 },
  { x: 1.2, y: -1.0, r: 65, m: 0 },
  { x: 0.4, y: -0.75, r: 10, m: 1 },
] as const;

function AlwaysWins(): JSX.Element {
  return (
    <>
      <span className="nova-m-wins" />
      <span className="nova-toss">
        <span className="nova-token-shadow" />
        <span className="nova-token-x">
          <span className="nova-token-lift">
            <span className="nova-token-spin">
              <Sprite name="token" className="nova-token-img" />
            </span>
          </span>
        </span>
        <span className="nova-land-ring" />
        {PIXELS.map((p, i) => (
          <span
            key={i}
            className="nova-pix"
            data-m={p.m}
            style={v({
              '--px': `${p.x}em`,
              '--py': `${p.y}em`,
              '--pr': `${p.r}deg`,
            })}
          />
        ))}
      </span>
    </>
  );
}

/* ---- fallback: the neon glitch ---------------------------------------- */

/* x: where along the word it leaves (%); d: stagger inside the burst (s);
   b: which burst fires it (0 = the big glitch, 1 = the small echo);
   m: magenta (1) or cyan (0); s: size (em); dx: sideways drift (em). */
const GLYPHS = [
  { g: '1', x: 8, d: 0, b: 0, m: 0, s: 0.46, dx: -0.12 },
  { g: '0', x: 21, d: 0.07, b: 0, m: 1, s: 0.4, dx: 0.1 },
  { g: '<', x: 35, d: 0.03, b: 0, m: 0, s: 0.5, dx: -0.06 },
  { g: '1', x: 49, d: 0.12, b: 0, m: 1, s: 0.42, dx: 0.14 },
  { g: '#', x: 63, d: 0.05, b: 0, m: 0, s: 0.44, dx: -0.1 },
  { g: '0', x: 77, d: 0.1, b: 0, m: 1, s: 0.38, dx: 0.08 },
  { g: '/', x: 91, d: 0.02, b: 0, m: 0, s: 0.46, dx: 0.12 },
  { g: '>', x: 28, d: 0.04, b: 1, m: 1, s: 0.42, dx: 0.1 },
  { g: '0', x: 56, d: 0.1, b: 1, m: 0, s: 0.4, dx: -0.12 },
  { g: '$', x: 84, d: 0, b: 1, m: 1, s: 0.44, dx: 0.06 },
] as const;

function Glitch(): JSX.Element {
  return (
    <>
      <span className="nova-m-glitch" />
      {GLYPHS.map((p, i) => (
        <span
          key={i}
          className="nova-g"
          data-m={p.m}
          data-b={p.b}
          style={v({
            '--x': `${p.x}%`,
            '--d': `${p.d}s`,
            '--gs': `${p.s}em`,
            '--dx': `${p.dx}em`,
          })}
        >
          {p.g}
        </span>
      ))}
    </>
  );
}

export default function NovaFx(props: FxProps): JSX.Element {
  const word = props.text.toLowerCase();
  return (
    <FxWord kind="nova" text={props.text}>
      {word === 'noticed' ? <Noticed /> : word === 'stay jacked in' ? <JackedIn /> : word === 'always wins' ? <AlwaysWins /> : <Glitch />}
    </FxWord>
  );
}
