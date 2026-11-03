/*
  Sylvara's opening cinematic. Painted over the whole frame when her profile
  opens, once, about 2.8 s:

    0.0 s  the frame darkens to forest green at the edges
    0.0 s  four ivy vines whip in from the corners, spiralling tighter until
           they wrap the bio text like a ribbon round a gift (stroke-dashoffset
           draw), ivy sprigs and blossoms unfurling along them
    0.8 s  the wrap tightens: the paragraph squeezes and glows gold
    1.2 s  a flare, and fireflies burst out of the wrapped text
    1.5 s  the vines unwind off their own tails, the leaves fold away
    2.8 s  the layer removes itself

  The bio paragraph itself is animated with the Web Animations API (glow and a
  little squeeze) and returns to normal when it ends. No reduced-motion
  handling: the user asked for it to always play.
*/
import { useLayoutEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import { asset } from '../../../../lib/asset';
import './sylvara.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const SPR = asset('/fx/sylvara/');
const TOTAL_MS = 2900;

type Pt = readonly [number, number];

interface Box {
  fw: number;
  fh: number;
  cx: number;
  cy: number;
  bw: number;
  bh: number;
}

interface Leaf {
  x: number;
  y: number;
  rot: number;
  size: number;
  delay: number;
  blossom: boolean;
}

interface Vine {
  d: string;
  delay: number;
  width: number;
  leaves: Leaf[];
}

function sv(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

/** Rounded-rectangle-ish "superellipse" unit point at angle a. */
function squircle(a: number): Pt {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [Math.sign(c) * Math.abs(c) ** 0.4, Math.sign(s) * Math.abs(s) ** 0.4];
}

const CORNERS = [-0.75, -0.25, 0.25, 0.75].map((k) => k * Math.PI);

function buildVines(box: Box): Vine[] {
  const a = Math.min(box.bw / 2 + 16, box.fw / 2 - 12);
  const b = box.bh / 2 + 14;
  return CORNERS.map((theta0, i) => {
    const dir = i % 2 === 0 ? 1 : -1;
    const turns = 1.05 + (i % 3) * 0.14;
    const grip = 1 + (i % 2) * 0.07;
    const N = 84;
    const pts: Pt[] = [];
    for (let k = 0; k <= N; k += 1) {
      const t = k / N;
      const th = theta0 + dir * turns * 2 * Math.PI * t;
      const s = (1 + 2.8 * (1 - t) ** 2.2) * grip * (1 + 0.022 * Math.sin(th * 6 + i * 1.7));
      const [ux, uy] = squircle(th);
      pts.push([box.cx + a * s * ux, box.cy + b * s * uy]);
    }
    const d = pts.map(([x, y], k) => `${k === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const leaves: Leaf[] = [];
    const marks = [0.34, 0.4, 0.46, 0.52, 0.58, 0.64, 0.7, 0.76, 0.82, 0.88, 0.94, 0.99];
    marks.forEach((t, m) => {
      const k = Math.min(N - 1, Math.round(t * N));
      const [x, y] = pts[k];
      const [nx, ny] = pts[k + 1];
      const tang = (Math.atan2(ny - y, nx - x) * 180) / Math.PI;
      const flip = m % 2 === 0 ? 0 : 180;
      const blossom = m % 5 === 3 && i % 2 === 0;
      leaves.push({
        x,
        y,
        rot: tang + 45 + flip + (m % 3) * 9 - 9,
        size: blossom ? 46 : 58 + (m % 3) * 9,
        delay: 0.1 + t * 0.62 + i * 0.07,
        blossom,
      });
    });
    return { d, delay: i * 0.07, width: 3 + (i % 2) * 0.8, leaves };
  });
}

/** Fireflies: a deterministic fan of directions so a re-render never reshuffles them. */
const FLIES = Array.from({ length: 20 }, (_, i) => {
  const ang = (i / 20) * Math.PI * 2 + (i % 3) * 0.21;
  const dist = 110 + ((i * 53) % 150);
  return {
    dx: Math.cos(ang) * dist * 1.25,
    dy: Math.sin(ang) * dist * 0.85 - 30,
    size: 18 + ((i * 7) % 12),
    delay: 1.15 + (i % 5) * 0.045,
    dur: 1.1 + (i % 4) * 0.16,
  };
});

export default function SylvaraIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [box, setBox] = useState<Box | null>(null);
  const [alive, setAlive] = useState(true);

  useLayoutEffect(() => {
    const fr = frame.getBoundingClientRect();
    const br = bio.getBoundingClientRect();
    setBox({
      fw: fr.width,
      fh: fr.height,
      cx: br.left - fr.left + br.width / 2,
      cy: br.top - fr.top + br.height / 2,
      bw: br.width,
      bh: br.height,
    });
  }, [bio, frame]);

  /* the paragraph: a gold glow and a squeeze while the vines grip, then home */
  useLayoutEffect(() => {
    const glow = (a: number, b: number): string => `drop-shadow(0 0 ${a}px color-mix(in oklab, var(--t-glow) ${b}%, transparent))`;
    const anim = bio.animate(
      [
        { transform: 'scale(1)', filter: glow(0, 0), offset: 0 },
        { transform: 'scale(1)', filter: glow(4, 20), offset: 0.2 },
        { transform: 'scale(0.982)', filter: glow(14, 70), offset: 0.34 },
        { transform: 'scale(1.006)', filter: glow(16, 60), offset: 0.46 },
        { transform: 'scale(1)', filter: glow(8, 36), offset: 0.62 },
        { transform: 'scale(1)', filter: glow(0, 0), offset: 1 },
      ],
      { duration: TOTAL_MS - 200, easing: 'cubic-bezier(0.37, 0, 0.63, 1)' }
    );
    return () => anim.cancel();
  }, [bio]);

  useLayoutEffect(() => {
    const id = window.setTimeout(() => setAlive(false), TOTAL_MS);
    return () => window.clearTimeout(id);
  }, []);

  const vines = useMemo(() => (box ? buildVines(box) : []), [box]);

  if (!box || !alive) return null;
  return (
    <div className="sy-intro" aria-hidden="true">
      <div className="sy-in-vignette" />
      <svg className="sy-in-svg" width={box.fw} height={box.fh} viewBox={`0 0 ${box.fw} ${box.fh}`} focusable="false">
        {vines.map((vine, i) => (
          <g key={i}>
            <path className="sy-in-under" d={vine.d} pathLength={1} strokeWidth={vine.width + 2.4} style={sv({ '--vd': `${vine.delay}s` })} />
            <path className="sy-in-stem" d={vine.d} pathLength={1} strokeWidth={vine.width} style={sv({ '--vd': `${vine.delay}s` })} />
            {vine.leaves.map((l, k) => (
              <g key={k} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.rot.toFixed(1)})`}>
                <g className="sy-in-leaf" style={sv({ '--ld': `${l.delay.toFixed(2)}s` })}>
                  <image
                    href={`${SPR}${l.blossom ? 'blossom' : 'ivy'}.png`}
                    x={-l.size / 2}
                    y={-l.size / 2}
                    width={l.size}
                    height={l.size}
                  />
                </g>
              </g>
            ))}
          </g>
        ))}
      </svg>
      <div className="sy-in-flare" style={sv({ '--cx': `${box.cx}px`, '--cy': `${box.cy}px`, '--fr': `${Math.max(box.bw, 200)}px` })} />
      {FLIES.map((p, i) => (
        <img
          key={i}
          className="sy-in-fly"
          src={`${SPR}firefly.png`}
          alt=""
          draggable={false}
          style={sv({ left: box.cx, top: box.cy, '--dx': `${p.dx.toFixed(0)}px`, '--dy': `${p.dy.toFixed(0)}px`, '--sz': `${p.size}px`, '--fd': `${p.delay.toFixed(2)}s`, '--fdur': `${p.dur.toFixed(2)}s` })}
        />
      ))}
    </div>
  );
}
