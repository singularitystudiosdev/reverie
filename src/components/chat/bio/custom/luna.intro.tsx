/* Luna's opening cinematic (about 2.6s, once per open): the black cat crouches
   at the frame's edge, pounces in an arc across the bio, and every star it
   passes lights while a thin gold line draws to the next one behind it, so the
   cat's own flight writes the constellation over the text. As the cat leaves,
   the last star closes the figure, the whole constellation flares together and
   the bio catches the light (a brightness and gold glow pulse on the real
   paragraph). A crescent moon, with a sparkle trail, sweeps across the top the
   whole time, under a soft midnight wash that makes the gold pop. */
import { useEffect, useLayoutEffect, useState, type CSSProperties, type JSX } from 'react';
import './luna.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const SPRITE = '/fx/luna';
const TOTAL = 2650;
const LEAP_AT = 0.32;
const LEAP_FOR = 1.25;
const CAT = 104;
const STAR = 28;

/* the figure, as fractions of the bio box: x across, y down (a zig-zag crown) */
const FIGURE = [
  { x: 0.02, y: 0.72 },
  { x: 0.17, y: 0.16 },
  { x: 0.33, y: 0.58 },
  { x: 0.49, y: 0.04 },
  { x: 0.64, y: 0.78 },
  { x: 0.8, y: 0.28 },
  { x: 0.97, y: 0.62 },
] as const;

const TRAIL = [0, 1, 2, 3] as const;

interface Geo {
  w: number;
  h: number;
  pts: { x: number; y: number; t: number }[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  y2: number;
  flare: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function measure(bio: HTMLElement, frame: HTMLElement): Geo {
  const f = frame.getBoundingClientRect();
  const b = bio.getBoundingClientRect();
  const bx = b.left - f.left;
  const by = b.top - f.top;
  const x0 = -CAT * 0.4;
  const x1 = f.width + 30;
  const pts = FIGURE.map((p) => {
    const x = bx + p.x * b.width;
    const y = by + p.y * b.height;
    /* the cat's centre passes x at this moment of the leap */
    const t = LEAP_AT + clamp((x - (x0 + CAT / 2)) / (x1 - x0), 0, 1) * LEAP_FOR;
    return { x, y, t };
  });
  const y0 = clamp(by + b.height - CAT * 0.7, 24, f.height - CAT - 16);
  const y1 = clamp(by - CAT * 0.45, 8, y0 - 56);
  const y2 = clamp(by + b.height * 0.35, 8, f.height - CAT - 16);
  return {
    w: f.width,
    h: f.height,
    pts,
    x0,
    x1,
    y0,
    y1,
    y2,
    flare: pts[pts.length - 1].t + 0.06,
  };
}

export default function LunaIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [done, setDone] = useState(false);

  useLayoutEffect(() => {
    setGeo(measure(bio, frame));
  }, [bio, frame]);

  /* the bio catches the light when the figure closes */
  useEffect(() => {
    if (!geo) return undefined;
    const gold = getComputedStyle(frame).getPropertyValue('--t-accent').trim() || 'gold';
    const flash = bio.animate(
      [
        { filter: 'brightness(1) drop-shadow(0 0 0 transparent)', offset: 0 },
        {
          filter: `brightness(1.55) drop-shadow(0 0 10px ${gold})`,
          offset: 0.28,
        },
        { filter: 'brightness(1) drop-shadow(0 0 0 transparent)', offset: 1 },
      ],
      {
        duration: 820,
        delay: geo.flare * 1000,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    );
    return () => flash.cancel();
  }, [geo, bio, frame]);

  useEffect(() => {
    const end = window.setTimeout(() => setDone(true), TOTAL);
    return () => window.clearTimeout(end);
  }, []);

  if (done || !geo) return done ? null : <div className="luna-in" aria-hidden="true" />;

  const { pts } = geo;
  const vars = {
    '--w': `${geo.w}px`,
    '--h': `${geo.h}px`,
    '--x0': `${geo.x0}px`,
    '--x1': `${geo.x1}px`,
    '--y0': `${geo.y0}px`,
    '--y1': `${geo.y1}px`,
    '--y2': `${geo.y2}px`,
    '--leap-at': `${LEAP_AT}s`,
    '--leap-for': `${LEAP_FOR}s`,
    '--flare': `${geo.flare}s`,
    '--cat': `${CAT}px`,
    '--star': `${STAR}px`,
  } as CSSProperties;

  return (
    <div className="luna-in" aria-hidden="true" style={vars}>
      <div className="luna-in-wash" />

      <div className="luna-in-fig">
        <svg className="luna-in-lines" width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} focusable="false">
          {pts.slice(0, -1).map((p, i) => {
            const n = pts[i + 1];
            return (
              <g key={i}>
                <line
                  className="luna-in-line-glow"
                  x1={p.x}
                  y1={p.y}
                  x2={n.x}
                  y2={n.y}
                  pathLength={1}
                  style={
                    {
                      '--d': `${p.t}s`,
                      '--l': `${n.t - p.t}s`,
                    } as CSSProperties
                  }
                />
                <line
                  className="luna-in-line"
                  x1={p.x}
                  y1={p.y}
                  x2={n.x}
                  y2={n.y}
                  pathLength={1}
                  style={
                    {
                      '--d': `${p.t}s`,
                      '--l': `${n.t - p.t}s`,
                    } as CSSProperties
                  }
                />
              </g>
            );
          })}
        </svg>

        {pts.map((p, i) => (
          <span
            key={i}
            className="luna-in-star"
            style={
              {
                left: p.x,
                top: p.y,
                '--d': `${p.t}s`,
                '--k': i % 3,
              } as CSSProperties
            }
          >
            <img src={`${SPRITE}/star.png`} alt="" draggable={false} decoding="async" />
          </span>
        ))}
      </div>

      {TRAIL.map((k) => (
        <span key={k} className="luna-in-moon-x" style={{ '--k': k } as CSSProperties}>
          <span className="luna-in-moon-y">
            <span className="luna-in-moon-r">
              <img src={`${SPRITE}/${k === 0 ? 'moon' : 'star'}.png`} alt="" draggable={false} decoding="async" />
            </span>
          </span>
        </span>
      ))}

      <span className="luna-in-cat-x">
        <span className="luna-in-cat-y">
          <span className="luna-in-cat-r">
            <span className="luna-in-cat-s">
              <img src={`${SPRITE}/cat.png`} alt="" draggable={false} decoding="async" />
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}
