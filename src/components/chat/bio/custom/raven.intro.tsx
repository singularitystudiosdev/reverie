/* Raven's opening cinematic (about 2.4 s, once per open).
   A reaper's scythe swings across the frame in perspective, tip first, along a
   diagonal that crosses her bio. A bright slash line draws along its edge, and
   at the moment the blade passes the bio is cut: two clones of the paragraph
   (clipped to each side of the line) slide apart, hold, then seal back with a
   hairline glow while black feathers scatter from the wound. The real bio is
   hidden only while the clones stand in for it, and restored on cleanup. */
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import './raven.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const TOTAL = 2500;
const SWING = 1300;
const CUT_AT = 520;

/** The scythe sprite is 768 x 512; its blade centre is about (300, 100) and the blade points 156deg. */
const SW = 600;
const SPRITE = { w: 768, h: 512, ox: 300, oy: 100, bladeDeg: 156 };

/** Feathers: angle (deg, 0 = right, 90 = down), reach in px, size in px, spin, delay, duration (ms). */
const FEATHERS = [
  { a: -150, r: 195, s: 78, spin: -260, d: 0, t: 1700 },
  { a: -120, r: 143, s: 65, spin: 200, d: 40, t: 1500 },
  { a: -80, r: 169, s: 88, spin: -180, d: 90, t: 1800 },
  { a: -40, r: 208, s: 68, spin: 300, d: 20, t: 1600 },
  { a: -10, r: 156, s: 82, spin: -220, d: 110, t: 1700 },
  { a: 25, r: 182, s: 61, spin: 240, d: 60, t: 1900 },
  { a: 60, r: 130, s: 75, spin: -300, d: 130, t: 1800 },
  { a: 100, r: 117, s: 85, spin: 160, d: 30, t: 2000 },
  { a: 140, r: 169, s: 65, spin: -200, d: 100, t: 1700 },
  { a: 175, r: 221, s: 78, spin: 280, d: 70, t: 1600 },
  { a: -170, r: 117, s: 58, spin: -240, d: 150, t: 1900 },
  { a: 160, r: 104, s: 71, spin: 190, d: 10, t: 1800 },
] as const;

interface Geo {
  fw: number;
  fh: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
  /** a point on the cut line and its direction, in frame px */
  tx: number;
  ty: number;
  ux: number;
  uy: number;
}

function measure(bio: HTMLElement, frame: HTMLElement): Geo {
  const f = frame.getBoundingClientRect();
  const b = bio.getBoundingClientRect();
  const bx = b.left - f.left;
  const by = b.top - f.top;
  return {
    fw: f.width,
    fh: f.height,
    bx,
    by,
    bw: b.width,
    bh: b.height,
    tx: bx + b.width * 0.74,
    ty: by,
    ux: -b.width * 0.46,
    uy: b.height,
  };
}

/** Frame-space point at parameter s along the cut line (s = 0 top of the bio, 1 bottom). */
function along(g: Geo, s: number): { x: number; y: number } {
  return { x: g.tx + g.ux * s, y: g.ty + g.uy * s };
}

/** Two clones of the bio, clipped to either side of the cut. They are stood in
    the intro's own overlay, so their coordinate space is the frame's: the bio's
    own ancestors are not a stable containing block (an ancestor that gains and
    then drops a transform re-resolves the top/left of absolute descendants). */
function makeHalves(bio: HTMLElement, g: Geo): { left: HTMLElement; right: HTMLElement } {
  const mk = (side: 'l' | 'r'): HTMLElement => {
    const c = bio.cloneNode(true) as HTMLElement;
    c.setAttribute('aria-hidden', 'true');
    c.removeAttribute('data-slot');
    c.style.position = 'absolute';
    c.style.margin = '0';
    c.style.left = `${g.bx}px`;
    c.style.top = `${g.by}px`;
    c.style.width = `${g.bw}px`;
    c.style.height = `${g.bh}px`;
    c.style.zIndex = '6';
    c.style.pointerEvents = 'none';
    c.style.visibility = 'visible';
    const ux = -g.bw * 0.46;
    const uy = g.bh;
    const p0 = { x: g.bw * 0.74 - ux * 0.4, y: -uy * 0.4 };
    const p1 = { x: g.bw * 0.74 + ux * 1.4, y: uy * 1.4 };
    const pts =
      side === 'l'
        ? [[-g.bw, p0.y], [p0.x, p0.y], [p1.x, p1.y], [-g.bw, p1.y]]
        : [[p0.x, p0.y], [g.bw * 2, p0.y], [g.bw * 2, p1.y], [p1.x, p1.y]];
    c.style.clipPath = `polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(',')})`;
    c.style.willChange = 'transform';
    // the cut shows only her text: the word effects' layers would show their own clipped edges
    c.querySelectorAll<HTMLElement>('.fx-layer').forEach((n) => {
      n.style.display = 'none';
    });
    return c;
  };
  return { left: mk('l'), right: mk('r') };
}

export default function RavenIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [done, setDone] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const g = measure(bio, frame);
    const anims: Animation[] = [];
    const play = (target: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): void => {
      anims.push(target.animate(frames, { fill: 'both', ...opts }));
    };

    const wasVisibility = bio.style.visibility;
    const halves = makeHalves(bio, g);
    halves.left.style.visibility = 'hidden';
    halves.right.style.visibility = 'hidden';
    el.append(halves.left, halves.right);

    /* The halves sit exactly over the bio at every frame: both rects are read in
       the frame's coordinate space and the clone is placed with the same numbers.
       That holds through a swipe, where the sheet and the bio move under the
       overlay. */
    let syncing = true;
    let syncRaf = 0;
    const sync = (): void => {
      const f = frame.getBoundingClientRect();
      const b = bio.getBoundingClientRect();
      const left = `${b.left - f.left}px`;
      const top = `${b.top - f.top}px`;
      const width = `${b.width}px`;
      const height = `${b.height}px`;
      for (const c of [halves.left, halves.right]) {
        if (c.style.left !== left) c.style.left = left;
        if (c.style.top !== top) c.style.top = top;
        if (c.style.width !== width) c.style.width = width;
        if (c.style.height !== height) c.style.height = height;
      }
      if (syncing) syncRaf = requestAnimationFrame(sync);
    };
    sync();

    // the cut's normal: the right half moves along +n, the left half along -n
    const len = Math.hypot(g.ux, g.uy);
    const nx = g.uy / len;
    const ny = -g.ux / len;
    const gap = 12;

    // the cut moment: the clones appear exactly where the bio was, then part
    const cutTimer = window.setTimeout(() => {
      bio.style.visibility = 'hidden';
      halves.left.style.visibility = 'visible';
      halves.right.style.visibility = 'visible';
    }, CUT_AT);
    const mkSlide = (sign: number): Keyframe[] => [
      { transform: 'translate(0px, 0px) rotate(0deg)', filter: 'brightness(1.5)', offset: 0 },
      { transform: `translate(${nx * gap * sign}px, ${ny * gap * sign}px) rotate(${0.5 * sign}deg)`, filter: 'brightness(1)', offset: 0.14 },
      { transform: `translate(${nx * (gap + 3) * sign}px, ${ny * (gap + 3) * sign}px) rotate(${0.6 * sign}deg)`, filter: 'brightness(1)', offset: 0.6 },
      { transform: `translate(${nx * 1.5 * sign}px, ${ny * 1.5 * sign}px) rotate(0deg)`, filter: 'brightness(1.1)', offset: 0.86, easing: 'cubic-bezier(0.5,0,0.9,0.4)' },
      { transform: 'translate(0px, 0px) rotate(0deg)', filter: 'brightness(1.8)', offset: 0.91 },
      { transform: 'translate(0px, 0px) rotate(0deg)', filter: 'brightness(1)', offset: 1 },
    ];
    play(halves.left, mkSlide(-1), { duration: 1500, delay: CUT_AT, easing: 'cubic-bezier(0.2,0.8,0.3,1)' });
    play(halves.right, mkSlide(1), { duration: 1500, delay: CUT_AT, easing: 'cubic-bezier(0.2,0.8,0.3,1)' });

    // the scythe: tip first along the cut line, in perspective, past the camera
    const phi = (Math.atan2(g.uy, g.ux) * 180) / Math.PI;
    const base = phi - SPRITE.bladeDeg;
    const at = (s: number, z: number, rot: number, rx: number, ry: number): string => {
      const p = along(g, s);
      return `translate3d(${p.x}px, ${p.y}px, ${z}px) rotate(${base + rot}deg) rotateX(${rx}deg) rotateY(${ry}deg)`;
    };
    const scythe = el.querySelector('.raven-scythe');
    if (scythe) {
      play(
        scythe,
        [
          { transform: at(-1.5, -500, -38, 28, -50), opacity: 0, filter: 'blur(7px)', offset: 0 },
          { transform: at(-0.9, -260, -28, 20, -34), opacity: 1, filter: 'blur(4px)', offset: 0.14 },
          { transform: at(-0.12, -30, -8, 6, -10), opacity: 1, filter: 'blur(1px)', offset: 0.34 },
          { transform: at(0.52, 90, 6, -4, 8), opacity: 1, filter: 'blur(0px)', offset: 0.4 },
          { transform: at(1.2, 220, 20, -14, 26), opacity: 1, filter: 'blur(3px)', offset: 0.5 },
          { transform: at(2.3, 520, 34, -26, 44), opacity: 0, filter: 'blur(9px)', offset: 1 },
        ],
        { duration: SWING, easing: 'cubic-bezier(0.4,0,0.6,1)' }
      );
    }

    // the slash: its drawn front follows the blade down the line (the blade's s runs
    // -1.5 .. 2.3 over the swing; the line spans s -3 .. 4), then it stays as a hairline
    // residue that flares once as the halves seal, and fades
    const line = el.querySelector('.raven-slash');
    if (line) {
      const reveal = (bottom: number, opacity: number, t: number): Keyframe => ({
        clipPath: `inset(0 0 ${bottom}% 0)`,
        opacity,
        offset: t / TOTAL,
      });
      play(
        line,
        [
          reveal(100, 1, 0),
          reveal(70, 1, 182),
          reveal(59, 1, 442),
          reveal(50, 1, 520),
          reveal(40, 1, 650),
          reveal(0, 0.85, 820),
          reveal(0, 0.4, 1500),
          reveal(0, 1, 1880),
          reveal(0, 0, TOTAL),
        ],
        { duration: TOTAL, easing: 'linear' }
      );
    }

    // the flash at the moment of the cut, and the dark that frames the whole beat
    const flash = el.querySelector('.raven-flash');
    if (flash) {
      play(flash, [{ opacity: 0 }, { opacity: 0.95, offset: 0.25 }, { opacity: 0 }], { duration: 340, delay: CUT_AT - 40, easing: 'ease-out' });
    }
    const dim = el.querySelector('.raven-dim');
    if (dim) {
      play(dim, [{ opacity: 0 }, { opacity: 0.5, offset: 0.2 }, { opacity: 0.4, offset: 0.7 }, { opacity: 0 }], { duration: TOTAL - 300, easing: 'ease-in-out' });
    }

    // feathers burst from the middle of the wound and fall as they fade
    const mid = along(g, 0.5);
    el.querySelectorAll<HTMLElement>('.raven-feather').forEach((node, i) => {
      const f = FEATHERS[i];
      if (!f) return;
      const rad = (f.a * Math.PI) / 180;
      const ex = Math.cos(rad) * f.r;
      const ey = Math.sin(rad) * f.r + 70;
      node.style.left = `${mid.x}px`;
      node.style.top = `${mid.y}px`;
      play(
        node,
        [
          { transform: 'translate(-50%,-50%) translate(0px,0px) rotate(0deg) scale(0.3)', opacity: 0, offset: 0 },
          { transform: `translate(-50%,-50%) translate(${ex * 0.7}px,${ey * 0.35}px) rotate(${f.spin * 0.4}deg) scale(1)`, opacity: 1, offset: 0.22 },
          { transform: `translate(-50%,-50%) translate(${ex}px,${ey}px) rotate(${f.spin}deg) scale(1.05)`, opacity: 0, offset: 1 },
        ],
        { duration: f.t, delay: CUT_AT + f.d, easing: 'cubic-bezier(0.2,0.7,0.4,1)' }
      );
    });

    /* The real bio is never left hidden: the cut hides it, and the end of the
       cinematic (or the sheet being swiped shut, which unmounts this) puts it
       back and drops the halves. */
    const restore = (): void => {
      window.clearTimeout(cutTimer);
      syncing = false;
      cancelAnimationFrame(syncRaf);
      bio.style.visibility = wasVisibility;
      halves.left.remove();
      halves.right.remove();
    };
    const end = window.setTimeout(() => {
      restore();
      setDone(true);
    }, TOTAL);
    return () => {
      window.clearTimeout(end);
      restore();
      anims.forEach((a) => a.cancel());
    };
  }, [bio, frame]);

  if (done) return null;

  const g = measure(bio, frame);
  const a = along(g, -3);
  const b = along(g, 4);
  const scale = SW / SPRITE.w;
  return (
    <div ref={root} className="raven-intro" aria-hidden="true">
      <div className="raven-dim" />
      <svg className="raven-slash-wrap" width={g.fw} height={g.fh} viewBox={`0 0 ${g.fw} ${g.fh}`} focusable="false">
        <defs>
          <linearGradient id="raven-slash-grad" gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="0.35" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="0.5" stopColor="white" />
            <stop offset="0.65" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="raven-slash">
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="raven-slash-glow" stroke="url(#raven-slash-grad)" />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="raven-slash-core" stroke="url(#raven-slash-grad)" />
        </g>
      </svg>
      <div className="raven-flash" style={{ left: along(g, 0.5).x, top: along(g, 0.5).y }} />
      <div className="raven-stage3d">
        <div className="raven-scythe">
          <img
            className="raven-scythe-img"
            src="/fx/raven/scythe-lg.png"
            alt=""
            draggable={false}
            style={{ width: SW, left: -SPRITE.ox * scale, top: -SPRITE.oy * scale }}
          />
        </div>
      </div>
      {FEATHERS.map((f, i) => (
        <img key={i} className="raven-feather" src="/fx/raven/feather.png" alt="" draggable={false} style={{ width: f.s }} />
      ))}
    </div>
  );
}
