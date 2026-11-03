/* Clementine's opening cinematic. When her profile opens: a gust of butterflies
   erupts out of the bio text (each pops with a squash, flaps, then arcs off past
   the frame, two flying straight toward the viewer), while a honey seam slides
   down the top edge and its drips stretch, thin, let go and fall. The bio
   itself gives a little hop and a golden glow, then returns to normal. Plays
   once (about 2.8 s), then removes itself. */
import { useLayoutEffect, useState, type JSX } from 'react';
import { v } from '../FxWord';
import './clementine.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

interface Geo {
  fw: number;
  fh: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

const SPRITE = '/fx/clementine/butterfly.png';
const TOTAL_MS = 3000;
const GOLDEN = 0.6180339887;

/** Deterministic spread in [0,1) so the swarm is the same every open. */
function frac(i: number, seed: number): number {
  return (i * GOLDEN + seed) % 1;
}

const BUTTERFLIES = Array.from({ length: 12 }, (_, i) => ({
  px: frac(i + 1, 0.13),
  py: frac(i + 3, 0.41),
  angle: (i / 12) * Math.PI * 2 + 0.4,
  size: i < 2 ? 96 : 30 + Math.round(frac(i, 0.27) * 30),
  delay: 0.08 + frac(i, 0.7) * 0.55,
  dur: 1.5 + frac(i, 0.2) * 0.6,
  flap: 0.12 + frac(i, 0.9) * 0.06,
  wob: (frac(i, 0.5) - 0.5) * 2,
  toward: i < 2,
}));

const DRIPS = [
  { x: 6, len: 0.2, w: 11, delay: 0.3, dur: 1.9 },
  { x: 19, len: 0.34, w: 9, delay: 0.52, dur: 2.1 },
  { x: 33, len: 0.14, w: 12, delay: 0.4, dur: 1.7 },
  { x: 47, len: 0.28, w: 10, delay: 0.7, dur: 2 },
  { x: 61, len: 0.4, w: 9, delay: 0.46, dur: 2.2 },
  { x: 74, len: 0.18, w: 12, delay: 0.62, dur: 1.8 },
  { x: 87, len: 0.3, w: 10, delay: 0.36, dur: 2 },
  { x: 95, len: 0.22, w: 8, delay: 0.8, dur: 1.9 },
] as const;

function measure(bio: HTMLElement, frame: HTMLElement): Geo {
  const f = frame.getBoundingClientRect();
  const b = bio.getBoundingClientRect();
  return { fw: f.width, fh: f.height, bx: b.left - f.left, by: b.top - f.top, bw: b.width, bh: b.height };
}

export default function ClementineIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [alive, setAlive] = useState(true);
  const [geo] = useState<Geo>(() => measure(bio, frame));

  useLayoutEffect(() => {
    // the bio hops, glows with honey light, and settles
    const hop = bio.animate(
      [
        { transform: 'translateY(0) scale(1, 1)', filter: 'brightness(1)', offset: 0 },
        { transform: 'translateY(2px) scale(1.01, 0.985)', filter: 'brightness(1.06)', offset: 0.1 },
        { transform: 'translateY(-7px) scale(0.995, 1.012)', filter: 'brightness(1.18) drop-shadow(0 0 14px color-mix(in oklab, var(--t-glow) 80%, orange))', offset: 0.24 },
        { transform: 'translateY(1.5px) scale(1.006, 0.994)', filter: 'brightness(1.1) drop-shadow(0 0 10px color-mix(in oklab, var(--t-glow) 60%, transparent))', offset: 0.4 },
        { transform: 'translateY(-1px) scale(1, 1)', filter: 'brightness(1.04)', offset: 0.55 },
        { transform: 'translateY(0) scale(1, 1)', filter: 'brightness(1)', offset: 1 },
      ],
      { duration: 1400, easing: 'ease-in-out', delay: 80 }
    );
    const timer = window.setTimeout(() => setAlive(false), TOTAL_MS);
    return () => {
      window.clearTimeout(timer);
      hop.cancel();
    };
  }, [bio, frame]);

  if (!alive) return null;

  const cx = geo.bx + geo.bw / 2;
  const cy = geo.by + geo.bh / 2;
  const reach = Math.hypot(geo.fw, geo.fh);

  return (
    <div className="clementine-intro" aria-hidden="true">
      <div className="clementine-intro-bloom" style={v({ '--cx': `${cx}px`, '--cy': `${cy}px` })} />
      {BUTTERFLIES.map((b, i) => {
        const sx = geo.bx + b.px * geo.bw;
        const sy = geo.by + b.py * geo.bh;
        const dist = reach * (b.toward ? 0.18 : 0.55 + frac(i, 0.33) * 0.3);
        const dx = Math.cos(b.angle) * dist;
        const dy = Math.sin(b.angle) * dist - (b.toward ? 0 : geo.fh * 0.08);
        const style = v({
          '--sx': `${sx}px`,
          '--sy': `${sy}px`,
          '--dx': `${dx}px`,
          '--dy': `${dy}px`,
          '--mx': `${dx * 0.42 + b.wob * 46}px`,
          '--my': `${dy * 0.4 - 38 - Math.abs(b.wob) * 24}px`,
          '--s': `${b.size}px`,
          '--rot': `${Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90) * 0.22}deg`,
          '--end': b.toward ? 4.2 : 1.7,
          '--delay': `${b.delay}s`,
          '--dur': `${b.dur}s`,
          '--flap': `${b.flap}s`,
        });
        return (
          <span key={i} className="clementine-intro-fly" data-toward={b.toward ? '1' : '0'} style={style}>
            <span className="clementine-intro-tilt">
              <img className="clementine-intro-wings" src={SPRITE} alt="" draggable={false} />
            </span>
          </span>
        );
      })}
      <div className="clementine-intro-honey">
        <svg className="clementine-intro-seam" viewBox="0 0 100 12" preserveAspectRatio="none" focusable="false">
          <path d="M0 0 H100 V5 C97 5 96 9 93 9 C90 9 89 5 86 5 C82 5 81 10 77 10 C73 10 72 5 68 5 C64 5 63 8 59 8 C55 8 54 4 50 4 C46 4 45 9 41 9 C37 9 36 5 32 5 C28 5 27 10 23 10 C19 10 18 5 14 5 C10 5 9 8 6 8 C3 8 2 5 0 5Z" />
        </svg>
        {DRIPS.map((d, i) => (
          <span
            key={i}
            className="clementine-intro-drip"
            style={v({ '--x': `${d.x}%`, '--len': `${Math.round(d.len * geo.fh * 0.7)}px`, '--w': `${d.w}px`, '--delay': `${d.delay}s`, '--dur': `${d.dur}s` })}
          >
            <span className="clementine-intro-strand" />
            <span className="clementine-intro-bead" />
          </span>
        ))}
      </div>
    </div>
  );
}
