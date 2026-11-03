/* Ada's opening cinematic (about 2.3 s, once per open).
   Brass gears slide in from the frame's edges and mesh (the same 18-tooth
   sprite, so a half-pitch offset and opposite spin keeps their teeth
   engaged), a steam blast rolls out from either side, and a brass press plate
   slams down on her bio: the text is hidden until the blow lands, then stamps
   in flat and hot as the plate lifts, with sparks, a shock ring and a flash.
   The real bio is only animated (never cloned) and returns to normal on cleanup. */
import { useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { v } from '../FxWord';
import { asset } from '../../../../lib/asset';
import './ada.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const TOTAL = 2300;
const SLAM_AT = 520;
const IMPACT = 900;

/** Where a gear sits (centre as a fraction of the frame), its width, spin time, direction, the way it enters. */
interface GearSpec {
  fx: number;
  fy: number;
  px: number;
  py: number;
  w: number;
  t: number;
  dir: 1 | -1;
  /** half-pitch offset so a meshed partner's teeth fall into this one's gaps */
  phase: number;
  from: [number, number];
  out: number;
}

/** Meshed pairs are spaced 0.71 widths apart (the sprite's pitch diameter). */
const PAIR = 0.71;
const pairB = (w: number, deg: number): { px: number; py: number } => ({
  px: Math.cos((deg * Math.PI) / 180) * w * PAIR,
  py: Math.sin((deg * Math.PI) / 180) * w * PAIR,
});

const GEARS: GearSpec[] = [
  { fx: 0, fy: 0.2, px: 0, py: 0, w: 190, t: 9, dir: 1, phase: 0, from: [-300, -40], out: 0 },
  { fx: 0, fy: 0.2, ...pairB(190, 68), w: 190, t: 9, dir: -1, phase: 10, from: [-300, 60], out: 0 },
  { fx: 1, fy: 0.62, px: 0, py: 0, w: 165, t: 8, dir: -1, phase: 0, from: [300, 40], out: 1 },
  { fx: 1, fy: 0.62, ...pairB(165, -112), w: 165, t: 8, dir: 1, phase: 10, from: [300, -60], out: 1 },
  { fx: 0.62, fy: 0, px: 0, py: 0, w: 120, t: 6, dir: 1, phase: 0, from: [40, -260], out: 2 },
  { fx: 0.3, fy: 1, px: 0, py: 0, w: 140, t: 7, dir: -1, phase: 0, from: [-30, 280], out: 3 },
];

/** Sparks off the press: where along the plate's bottom edge (0..1), the launch angle (deg), reach (px). */
const SPARKS = [
  { x: 0, a: 180, r: 70 },
  { x: 0.04, a: 200, r: 100 },
  { x: 0.08, a: 160, r: 60 },
  { x: 0.2, a: 100, r: 50 },
  { x: 0.34, a: 120, r: 70 },
  { x: 0.5, a: 90, r: 60 },
  { x: 0.64, a: 70, r: 80 },
  { x: 0.8, a: 80, r: 50 },
  { x: 0.92, a: 20, r: 60 },
  { x: 0.96, a: -20, r: 100 },
  { x: 1, a: 0, r: 70 },
  { x: 0.3, a: 140, r: 90 },
  { x: 0.7, a: 40, r: 90 },
  { x: 0.55, a: 110, r: 110 },
] as const;

/** Steam puffs: side (0 left, 1 right), vertical position (fraction of the frame), size (px), delay (ms). */
const STEAM = [
  { s: 0, y: 0.5, w: 120, d: 0 },
  { s: 1, y: 0.55, w: 140, d: 40 },
  { s: 0, y: 0.42, w: 90, d: 140 },
  { s: 1, y: 0.62, w: 100, d: 170 },
  { s: 0, y: 0.6, w: 150, d: 260 },
  { s: 1, y: 0.4, w: 120, d: 300 },
  { s: 0, y: 0.5, w: 110, d: 420 },
  { s: 1, y: 0.5, w: 130, d: 480 },
] as const;

interface Box {
  fw: number;
  fh: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

function measure(bio: HTMLElement, frame: HTMLElement): Box {
  const f = frame.getBoundingClientRect();
  const b = bio.getBoundingClientRect();
  return { fw: f.width, fh: f.height, bx: b.left - f.left, by: b.top - f.top, bw: b.width, bh: b.height };
}

export default function AdaIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [done, setDone] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const g = measure(bio, frame);
    const anims: Animation[] = [];
    const play = (target: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): void => {
      anims.push(target.animate(frames, { fill: 'both', ...opts }));
    };
    const lift = -(g.by + g.bh + 160);

    // the text: hidden until the blow, then stamped flat and hot, then it relaxes
    play(
      bio,
      [
        { opacity: 0, transform: 'scale(1)', filter: 'brightness(1)', offset: 0 },
        { opacity: 0, transform: 'scale(1)', filter: 'brightness(1)', offset: (IMPACT - 1) / TOTAL },
        { opacity: 1, transform: 'scale(1.03, 0.94)', filter: 'brightness(2.4)', offset: IMPACT / TOTAL },
        { opacity: 1, transform: 'scale(0.992, 1.012)', filter: 'brightness(1.6)', offset: (IMPACT + 160) / TOTAL },
        { opacity: 1, transform: 'scale(1)', filter: 'brightness(1)', offset: (IMPACT + 520) / TOTAL },
        { opacity: 1, transform: 'scale(1)', filter: 'brightness(1)', offset: 1 },
      ],
      { duration: TOTAL, easing: 'ease-out' }
    );

    // the press plate: down hard, a beat of weight, then up and away
    const plate = el.querySelector('.ada-plate');
    if (plate) {
      play(
        plate,
        [
          { transform: `translateY(${lift}px)`, opacity: 1, offset: 0, easing: 'cubic-bezier(0.55,0,0.9,0.5)' },
          { transform: 'translateY(0px) scale(1,1)', opacity: 1, offset: (IMPACT - SLAM_AT) / 1100 },
          { transform: 'translateY(5px) scale(1.025,0.965)', opacity: 1, offset: (IMPACT - SLAM_AT + 70) / 1100 },
          { transform: 'translateY(0px) scale(1,1)', opacity: 1, offset: (IMPACT - SLAM_AT + 150) / 1100, easing: 'cubic-bezier(0.3,0,0.2,1)' },
          { transform: `translateY(${lift}px)`, opacity: 1, offset: 1 },
        ],
        { duration: 1100, delay: SLAM_AT }
      );
    }

    // gears slide in from the edges, then out again when the stamp has landed
    el.querySelectorAll<HTMLElement>('.ada-gear').forEach((node, i) => {
      const spec = GEARS[i];
      if (!spec) return;
      const outX = spec.out === 0 ? -320 : spec.out === 1 ? 320 : 0;
      const outY = spec.out === 2 ? -300 : spec.out === 3 ? 300 : 0;
      play(
        node,
        [
          { transform: `translate(${spec.from[0]}px, ${spec.from[1]}px) scale(0.7)`, opacity: 0, offset: 0 },
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0.3 },
          { transform: 'translate(0px, 0px) scale(1.04)', opacity: 1, offset: (IMPACT + 60) / 2000 },
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0.64 },
          { transform: `translate(${outX}px, ${outY}px) scale(0.85)`, opacity: 0, offset: 1 },
        ],
        { duration: 2000, delay: i * 40, easing: 'cubic-bezier(0.2,0.8,0.3,1)' }
      );
    });

    // a steam blast from both sides, rolling inward and up
    el.querySelectorAll<HTMLElement>('.ada-steam').forEach((node, i) => {
      const spec = STEAM[i];
      if (!spec) return;
      const dir = spec.s === 0 ? 1 : -1;
      play(
        node,
        [
          { transform: 'translate(0px, 0px) scale(0.3)', opacity: 0, offset: 0 },
          { transform: `translate(${dir * 50}px, -20px) scale(1)`, opacity: 0.9, offset: 0.25 },
          { transform: `translate(${dir * 130}px, -70px) scale(2)`, opacity: 0.55, offset: 0.65 },
          { transform: `translate(${dir * 190}px, -130px) scale(2.8)`, opacity: 0, offset: 1 },
        ],
        { duration: 1200, delay: 560 + spec.d, easing: 'cubic-bezier(0.2,0.7,0.3,1)' }
      );
    });

    // the impact: sparks fly off the plate's lower edge, a ring rolls out, a warm flash
    el.querySelectorAll<HTMLElement>('.ada-streak').forEach((node, i) => {
      const spec = SPARKS[i];
      if (!spec) return;
      const rad = (spec.a * Math.PI) / 180;
      const x0 = g.bx - 8 + (g.bw + 16) * spec.x;
      const y0 = g.by + g.bh + 8;
      node.style.left = `${x0}px`;
      node.style.top = `${y0}px`;
      const ex = Math.cos(rad) * spec.r;
      const ey = -Math.sin(rad) * spec.r;
      const deg = (Math.atan2(ey, ex) * 180) / Math.PI;
      play(
        node,
        [
          { transform: `rotate(${deg}deg) translateX(0px) scaleX(0.4)`, opacity: 0, offset: 0 },
          { transform: `translate(${ex * 0.25}px, ${ey * 0.25}px) rotate(${deg}deg) scaleX(1.6)`, opacity: 1, offset: 0.12 },
          { transform: `translate(${ex}px, ${ey + 46}px) rotate(${deg + 40}deg) scaleX(0.7)`, opacity: 0, offset: 1 },
        ],
        { duration: 560 + (i % 4) * 70, delay: IMPACT, easing: 'cubic-bezier(0.1,0.6,0.4,1)' }
      );
    });
    el.querySelectorAll<HTMLElement>('.ada-burst').forEach((node, i) => {
      node.style.left = `${g.bx - 8 + (i === 0 ? 0 : g.bw + 16)}px`;
      node.style.top = `${g.by + g.bh + 8}px`;
      play(
        node,
        [
          { transform: 'translate(-50%,-50%) scale(0.2) rotate(-20deg)', opacity: 0, offset: 0 },
          { transform: 'translate(-50%,-50%) scale(1.15) rotate(6deg)', opacity: 1, offset: 0.2 },
          { transform: 'translate(-50%,-50%) scale(0.9) rotate(12deg)', opacity: 0, offset: 1 },
        ],
        { duration: 520, delay: IMPACT, easing: 'ease-out' }
      );
    });
    const ring = el.querySelector<HTMLElement>('.ada-ring');
    if (ring) {
      ring.style.left = `${g.bx + g.bw / 2}px`;
      ring.style.top = `${g.by + g.bh + 6}px`;
      ring.style.width = `${g.bw}px`;
      play(
        ring,
        [
          { transform: 'translate(-50%,-50%) scale(0.3, 0.1)', opacity: 0.9, offset: 0 },
          { transform: 'translate(-50%,-50%) scale(1.3, 0.34)', opacity: 0, offset: 1 },
        ],
        { duration: 650, delay: IMPACT, easing: 'cubic-bezier(0.1,0.7,0.3,1)' }
      );
    }
    const flash = el.querySelector('.ada-flash');
    if (flash) {
      play(flash, [{ opacity: 0 }, { opacity: 0.6, offset: 0.18 }, { opacity: 0 }], { duration: 380, delay: IMPACT - 20, easing: 'ease-out' });
    }

    const end = window.setTimeout(() => setDone(true), TOTAL);
    return () => {
      window.clearTimeout(end);
      anims.forEach((a) => a.cancel());
    };
  }, [bio, frame]);

  if (done) return null;

  const g = measure(bio, frame);
  return (
    <div ref={root} className="ada-intro" aria-hidden="true">
      <div className="ada-flash" />
      {GEARS.map((s, i) => (
        <div key={i} className="ada-gear" style={{ left: s.fx * g.fw + s.px - s.w / 2, top: s.fy * g.fh + s.py - s.w / 2, width: s.w, height: s.w }}>
          <img
            className="ada-gear-img"
            src={asset("/fx/ada/gear.png")}
            alt=""
            draggable={false}
            style={v({ '--spin': `${s.t}s`, '--p': `${s.phase}deg`, '--turn': `${s.dir * 360}deg` })}
          />
        </div>
      ))}
      {STEAM.map((s, i) => (
        <span key={i} className="ada-steam" style={{ left: s.s === 0 ? -20 : g.fw - s.w + 20, top: s.y * g.fh, width: s.w, height: s.w }} />
      ))}
      <div className="ada-plate" style={{ left: g.bx - 8, top: g.by - 8, width: g.bw + 16, height: g.bh + 16 }}>
        <span className="ada-rivet ada-rivet-tl" />
        <span className="ada-rivet ada-rivet-tr" />
        <span className="ada-rivet ada-rivet-bl" />
        <span className="ada-rivet ada-rivet-br" />
      </div>
      <img className="ada-burst" src={asset("/fx/ada/spark.png")} alt="" draggable={false} />
      <img className="ada-burst" src={asset("/fx/ada/spark.png")} alt="" draggable={false} />
      <span className="ada-ring" />
      {SPARKS.map((_, i) => (
        <span key={i} className="ada-streak" />
      ))}
    </div>
  );
}
