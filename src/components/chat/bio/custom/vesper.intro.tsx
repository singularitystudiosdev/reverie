/*
  Vesper's opening cinematic. Painted over the whole frame when her profile
  opens, once, about 2.6 s. A swarm of bats bursts out of the dark at the
  vanishing point and flies STRAIGHT AT the viewer: real perspective
  (translateZ from far behind the glass to past the camera), wings flapping,
  echoes of each big bat trailing as motion blur. As the hero bat swallows the
  frame a crimson flash goes off; the bio paragraph shudders under the swarm
  and settles. The layer then removes itself.

  The paragraph is animated with the Web Animations API and is back to normal
  when it ends. No reduced-motion handling: the user asked for it to always
  play.
*/
import { useLayoutEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import './vesper.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const SPR = '/fx/vesper/';
const TOTAL_MS = 2700;

function sv(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

/** A small deterministic 0..1 sequence so re-renders never reshuffle the swarm. */
function rnd(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface Bat {
  big: boolean;
  src: string;
  size: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  r0: number;
  r1: number;
  delay: number;
  dur: number;
  flap: number;
}

function buildSwarm(fw: number, fh: number): Bat[] {
  const out: Bat[] = [];
  /* three big head-on bats: the first one flies dead centre */
  for (let i = 0; i < 3; i += 1) {
    out.push({
      big: true,
      src: `${SPR}bat-front-lg.png`,
      size: 230 + i * 20,
      sx: (rnd(i, 1) - 0.5) * 60,
      sy: (rnd(i, 2) - 0.5) * 40,
      ex: i === 0 ? 0 : (i === 1 ? -1 : 1) * fw * 0.16,
      ey: i === 0 ? fh * 0.02 : (rnd(i, 3) - 0.5) * fh * 0.3,
      r0: (rnd(i, 4) - 0.5) * 14,
      r1: (rnd(i, 5) - 0.5) * 40,
      delay: 0.22 + i * 0.2,
      dur: 1.25 + i * 0.1,
      flap: 0.15 + i * 0.015,
    });
  }
  /* the swarm around them */
  for (let i = 0; i < 11; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    out.push({
      big: false,
      src: `${SPR}bat.png`,
      size: 120 + rnd(i, 6) * 60,
      sx: (rnd(i, 7) - 0.5) * 140,
      sy: (rnd(i, 8) - 0.5) * 90,
      ex: side * (fw * (0.08 + rnd(i, 9) * 0.3)),
      ey: (rnd(i, 10) - 0.5) * fh * 0.55,
      r0: (rnd(i, 11) - 0.5) * 30,
      r1: side * (10 + rnd(i, 12) * 40),
      delay: 0.1 + rnd(i, 13) * 0.75,
      dur: 1.0 + rnd(i, 14) * 0.6,
      flap: 0.12 + rnd(i, 15) * 0.08,
    });
  }
  return out;
}

/** The paragraph shudders as the swarm goes past, then comes to rest. */
function shudder(bio: HTMLElement): Animation {
  const frames: Keyframe[] = [{ transform: 'translate(0px, 0px) rotate(0deg)', filter: 'none', offset: 0 }];
  const start = 0.18;
  const end = 0.62;
  const steps = 22;
  for (let k = 0; k < steps; k += 1) {
    const t = k / (steps - 1);
    const amp = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 3.2;
    frames.push({
      transform: `translate(${((rnd(k, 21) - 0.5) * 2 * amp).toFixed(2)}px, ${((rnd(k, 22) - 0.5) * 2 * amp * 0.7).toFixed(2)}px) rotate(${((rnd(k, 23) - 0.5) * 0.5 * amp).toFixed(2)}deg)`,
      filter: `drop-shadow(0 0 ${(2 + amp * 3).toFixed(1)}px color-mix(in oklab, var(--t-accent) ${Math.round(30 + amp * 16)}%, transparent))`,
      offset: start + (end - start) * t,
    });
  }
  frames.push({ transform: 'translate(0px, 0px) rotate(0deg)', filter: 'drop-shadow(0 0 10px color-mix(in oklab, var(--t-accent) 55%, transparent))', offset: 0.72 });
  frames.push({ transform: 'translate(0px, 0px) rotate(0deg)', filter: 'none', offset: 1 });
  return bio.animate(frames, { duration: TOTAL_MS - 200, easing: 'linear' });
}

export default function VesperIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [alive, setAlive] = useState(true);

  useLayoutEffect(() => {
    const r = frame.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
  }, [frame]);

  useLayoutEffect(() => {
    const anim = shudder(bio);
    return () => anim.cancel();
  }, [bio]);

  useLayoutEffect(() => {
    const id = window.setTimeout(() => setAlive(false), TOTAL_MS);
    return () => window.clearTimeout(id);
  }, []);

  const swarm = useMemo(() => (size ? buildSwarm(size.w, size.h) : []), [size]);

  if (!size || !alive) return null;
  return (
    <div className="ve-intro" aria-hidden="true">
      <div className="ve-in-dark" />
      <div className="ve-in-stage">
        {swarm.map((b, i) => (
          <div
            key={i}
            className="ve-in-bat"
            data-big={b.big ? 1 : 0}
            style={sv({
              '--sz': `${b.size}px`,
              '--sx': `${b.sx.toFixed(0)}px`,
              '--sy': `${b.sy.toFixed(0)}px`,
              '--ex': `${b.ex.toFixed(0)}px`,
              '--ey': `${b.ey.toFixed(0)}px`,
              '--r0': `${b.r0.toFixed(1)}deg`,
              '--r1': `${b.r1.toFixed(1)}deg`,
              '--bd': `${b.delay.toFixed(2)}s`,
              '--bt': `${b.dur.toFixed(2)}s`,
              '--fl': `${b.flap.toFixed(3)}s`,
            })}
          >
            <span className="ve-in-wing">
              <img className="ve-in-img" src={b.src} alt="" draggable={false} />
            </span>
          </div>
        ))}
        {/* echoes of the three big bats: the motion blur trailing them */}
        {swarm.slice(0, 3).flatMap((b, i) =>
          [1, 2].map((echo) => (
            <div
              key={`${i}-${echo}`}
              className="ve-in-bat ve-in-echo"
              style={sv({
                '--sz': `${b.size}px`,
                '--sx': `${b.sx.toFixed(0)}px`,
                '--sy': `${b.sy.toFixed(0)}px`,
                '--ex': `${b.ex.toFixed(0)}px`,
                '--ey': `${b.ey.toFixed(0)}px`,
                '--r0': `${b.r0.toFixed(1)}deg`,
                '--r1': `${b.r1.toFixed(1)}deg`,
                '--bd': `${(b.delay - echo * 0.055).toFixed(3)}s`,
                '--bt': `${b.dur.toFixed(2)}s`,
                '--fl': `${b.flap.toFixed(3)}s`,
                '--eo': echo === 1 ? 0.4 : 0.2,
              })}
            >
              <span className="ve-in-wing">
                <img className="ve-in-img" src={b.src} alt="" draggable={false} />
              </span>
            </div>
          ))
        )}
      </div>
      <div className="ve-in-flash" />
      <div className="ve-in-edge" />
    </div>
  );
}
