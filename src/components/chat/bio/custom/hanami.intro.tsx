/*
  Hanami's opening: a gust sweeps in from the left and blows a storm of cherry
  petals across the whole frame (real perspective: near petals are big and
  soft, far ones small and sharp), full blossoms tumble past, three paper
  lanterns rise on the same wind, and the bio text itself sways in the gust
  and settles. About 2.4s, once per open, then it returns null.

  The petals are CSS shapes (no hex: colours are her theme tokens); the
  blossoms and lanterns are her painted sprites (public/fx/hanami).
*/
import { useEffect, useState, type JSX } from 'react';
import { v } from '../FxWord';
import './hanami.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const TOTAL_MS = 2500;
const PETAL_COUNT = 56;
const TONES = ['blush', 'rose', 'cream'] as const;

/** Deterministic 0..1 noise: the storm is loose but identical every open. */
function noise(i: number, k: number): number {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const PETALS = Array.from({ length: PETAL_COUNT }, (_, i) => {
  const near = noise(i, 1) > 0.78;
  const far = !near && noise(i, 2) > 0.55;
  return {
    i,
    tone: TONES[i % TONES.length],
    y: 4 + noise(i, 3) * 92, // cqh, where it enters
    dy: -18 + noise(i, 4) * 52, // cqh of net drift on the wind
    z: near ? 100 + noise(i, 5) * 120 : far ? -260 + noise(i, 6) * 160 : -60 + noise(i, 7) * 160,
    size: near ? 6.5 + noise(i, 8) * 3.5 : far ? 1.9 + noise(i, 9) * 1.2 : 3 + noise(i, 10) * 2.4, // cqw
    delay: noise(i, 11) * 0.62,
    dur: 1.25 + noise(i, 12) * 0.55,
    wob: 3 + noise(i, 13) * 5, // cqh of flutter
    wobT: 0.34 + noise(i, 14) * 0.3,
    turns: (noise(i, 15) > 0.5 ? 1 : -1) * (1.2 + noise(i, 16) * 2.2),
    ax: noise(i, 17) * 2 - 1,
    ay: noise(i, 18) * 2 - 1,
    blur: near ? 1.6 : 0,
  };
});

const BLOSSOMS = [
  { y: 22, dy: 20, z: 150, size: 18, delay: 0.1, dur: 1.7, turns: 0.8, wob: 5 },
  { y: 62, dy: -14, z: 100, size: 14, delay: 0.28, dur: 1.55, turns: -0.6, wob: 4 },
  { y: 40, dy: 30, z: 170, size: 22, delay: 0.42, dur: 1.45, turns: 0.5, wob: 6 },
  { y: 82, dy: -22, z: 40, size: 11, delay: 0.5, dur: 1.7, turns: -1, wob: 3 },
  { y: 12, dy: 38, z: 60, size: 10, delay: 0.62, dur: 1.6, turns: 0.9, wob: 4 },
] as const;

const LANTERNS = [
  { x: 13, size: 17, delay: 0.1, dur: 1.9, sway: 5 },
  { x: 50, size: 22, delay: 0.3, dur: 1.9, sway: -4 },
  { x: 82, size: 16, delay: 0.5, dur: 1.85, sway: 6 },
] as const;

const GUSTS = [
  { y: 18, w: 46, delay: 0.02, dur: 0.9, a: -4 },
  { y: 37, w: 62, delay: 0.1, dur: 0.82, a: -2 },
  { y: 55, w: 52, delay: 0.06, dur: 0.95, a: 1 },
  { y: 71, w: 66, delay: 0.16, dur: 0.85, a: 3 },
  { y: 86, w: 44, delay: 0.12, dur: 0.9, a: 5 },
] as const;

export default function HanamiIntro(props: IntroProps): JSX.Element | null {
  const { bio } = props;
  const [done, setDone] = useState(false);

  useEffect(() => {
    // the gust reaches the text: the whole paragraph leans and settles, each
    // charged word trailing it a beat later so the sway reads as wind, not a nudge
    const sway = bio.animate(
      [
        { transform: 'translateX(0) rotate(0deg)', transformOrigin: '0% 100%', offset: 0 },
        { transform: 'translateX(9px) rotate(0.7deg)', transformOrigin: '0% 100%', offset: 0.22 },
        { transform: 'translateX(-4px) rotate(-0.35deg)', transformOrigin: '0% 100%', offset: 0.46 },
        { transform: 'translateX(2.5px) rotate(0.18deg)', transformOrigin: '0% 100%', offset: 0.7 },
        { transform: 'translateX(0) rotate(0deg)', transformOrigin: '0% 100%', offset: 1 },
      ],
      { duration: 1700, delay: 420, easing: 'cubic-bezier(0.37, 0, 0.63, 1)' }
    );
    const words = Array.from(bio.querySelectorAll<HTMLElement>('.fx')).map((el, n) =>
      el.animate(
        [
          { transform: 'translateY(0) rotate(0deg)', offset: 0 },
          { transform: 'translateY(-3px) rotate(-1.6deg)', offset: 0.3 },
          { transform: 'translateY(1.5px) rotate(0.8deg)', offset: 0.62 },
          { transform: 'translateY(0) rotate(0deg)', offset: 1 },
        ],
        { duration: 1500, delay: 560 + n * 90, easing: 'cubic-bezier(0.37, 0, 0.63, 1)' }
      )
    );
    const timer = window.setTimeout(() => setDone(true), TOTAL_MS);
    return () => {
      window.clearTimeout(timer);
      sway.cancel();
      words.forEach((a) => a.cancel());
    };
  }, [bio]);

  if (done) return null;

  return (
    <div className="hanami-intro" aria-hidden="true">
      <span className="hanami-i-wash" />
      {GUSTS.map((g, n) => (
        <span key={n} className="hanami-i-gust" style={v({ '--y': `${g.y}cqh`, '--w': `${g.w}cqw`, '--d': `${g.delay}s`, '--t': `${g.dur}s`, '--a': `${g.a}deg` })} />
      ))}
      {LANTERNS.map((l, n) => (
        <span key={n} className="hanami-i-lantern" style={v({ '--x': `${l.x}cqw`, '--sz': `${l.size}cqw`, '--d': `${l.delay}s`, '--t': `${l.dur}s`, '--sw': `${l.sway}deg` })}>
          <span className="hanami-i-lantern-glow" />
          <img className="hanami-i-lantern-img" src="/fx/hanami/lantern.png" alt="" draggable={false} />
        </span>
      ))}
      {PETALS.map((p) => (
        <span
          key={p.i}
          className="hanami-i-p"
          style={v({ '--y': `${p.y.toFixed(1)}cqh`, '--dy': `${p.dy.toFixed(1)}cqh`, '--z': `${p.z.toFixed(0)}px`, '--sz': `${p.size.toFixed(2)}cqw`, '--d': `${p.delay.toFixed(2)}s`, '--t': `${p.dur.toFixed(2)}s`, '--blur': `${p.blur}px` })}
        >
          <span className="hanami-i-flutter" style={v({ '--wob': `${p.wob.toFixed(1)}cqh`, '--wt': `${p.wobT.toFixed(2)}s`, '--d': `${(-p.delay - p.i * 0.07).toFixed(2)}s` })}>
            <span className="hanami-i-petal" data-tone={p.tone} style={v({ '--turns': p.turns.toFixed(2), '--ax': p.ax.toFixed(2), '--ay': p.ay.toFixed(2), '--d': `${p.delay.toFixed(2)}s`, '--t': `${p.dur.toFixed(2)}s` })} />
          </span>
        </span>
      ))}
      {BLOSSOMS.map((b, n) => (
        <span
          key={n}
          className="hanami-i-p hanami-i-bloom"
          style={v({ '--y': `${b.y}cqh`, '--dy': `${b.dy}cqh`, '--z': `${b.z}px`, '--sz': `${b.size}cqw`, '--d': `${b.delay}s`, '--t': `${b.dur}s`, '--blur': b.z > 140 ? '1.4px' : '0px' })}
        >
          <span className="hanami-i-flutter" style={v({ '--wob': `${b.wob}cqh`, '--wt': `${0.55 + n * 0.07}s`, '--d': `${-b.delay}s` })}>
            <img
              className="hanami-i-bloom-img"
              src="/fx/hanami/blossom.png"
              alt=""
              draggable={false}
              style={v({ '--turns': b.turns, '--ax': 0.4 + n * 0.1, '--ay': 0.7 - n * 0.15, '--d': `${b.delay}s`, '--t': `${b.dur}s` })}
            />
          </span>
        </span>
      ))}
    </div>
  );
}
