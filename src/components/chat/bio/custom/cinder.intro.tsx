/* Cinder's opening cinematic (about 2.4 s): a wall of fire sweeps across the
   frame, the bio text heats up like coals and cools back to ink, embers are
   flung ahead of the wall and sparks rain down behind it.
   Three plates: a back plate of heat (dim, bloom, flash), a mid plate of
   painted flame sprites (the wall, the embers) and a front plate of sparks.
   The bio is acted on with the Web Animations API and always returns to its
   own look (no fill, the animation is cancelled on unmount). */
import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import './cinder.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const TOTAL = 2400;

/* a small fixed table instead of Math.random: the same wall every time */
const JIT = [0.12, 0.83, 0.47, 0.66, 0.21, 0.95, 0.38, 0.74, 0.05, 0.58, 0.31, 0.89, 0.43, 0.7, 0.17, 0.92, 0.62, 0.28, 0.79, 0.52];

function css(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

function read(el: HTMLElement, name: string, fallback: string): string {
  const val = getComputedStyle(el).getPropertyValue(name).trim();
  return val || fallback;
}

export default function CinderIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [done, setDone] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number; bx: number; by: number; bw: number; bh: number } | null>(null);

  useEffect(() => {
    const f = frame.getBoundingClientRect();
    const b = bio.getBoundingClientRect();
    setSize({ w: f.width, h: f.height, bx: b.left - f.left, by: b.top - f.top, bw: b.width, bh: b.height });
  }, [bio, frame]);

  /* the bio heats like coal while the wall passes, then cools back to ink */
  useEffect(() => {
    const hot = read(bio, '--fx-a1', 'orange');
    const red = read(bio, '--fx-a2', 'gold');
    const coal = 'sepia(1) saturate(8) hue-rotate(-36deg) brightness(1.45)';
    const warm = 'sepia(0.6) saturate(4) hue-rotate(-26deg) brightness(1.15)';
    const glow = animateSafe(
      bio,
      [
        { offset: 0, filter: 'none', textShadow: '0 0 0 transparent' },
        { offset: 0.3, filter: 'none', textShadow: '0 0 0 transparent' },
        { offset: 0.5, filter: coal, textShadow: `0 0 6px ${hot}, 0 0 18px ${red}` },
        { offset: 0.66, filter: coal, textShadow: `0 0 8px ${hot}, 0 0 22px ${red}` },
        { offset: 0.82, filter: warm, textShadow: `0 0 4px ${hot}` },
        { offset: 1, filter: 'none', textShadow: '0 0 0 transparent' },
      ],
      { duration: TOTAL, easing: 'ease-in-out' }
    );
    /* the wall's heat shoves the paragraph: a short tremor, transform only */
    const shake = animateSafe(
      bio,
      [
        { offset: 0, transform: 'translate3d(0,0,0)' },
        { offset: 0.34, transform: 'translate3d(0,0,0)' },
        { offset: 0.4, transform: 'translate3d(-2px,1px,0)' },
        { offset: 0.46, transform: 'translate3d(2px,-1px,0)' },
        { offset: 0.52, transform: 'translate3d(-1.5px,-1px,0)' },
        { offset: 0.58, transform: 'translate3d(1px,1px,0)' },
        { offset: 0.66, transform: 'translate3d(0,0,0)' },
        { offset: 1, transform: 'translate3d(0,0,0)' },
      ],
      { duration: TOTAL, easing: 'linear' }
    );
    const end = window.setTimeout(() => setDone(true), TOTAL + 100);
    return () => {
      window.clearTimeout(end);
      glow?.cancel();
      shake?.cancel();
    };
  }, [bio]);

  const parts = useMemo(() => {
    if (!size) return null;
    const { w, h } = size;
    const fw = Math.min(h * 0.34, w * 0.72);
    const wallW = fw * 1.25;
    const flames = Array.from({ length: 8 }, (_, i) => {
      const j = JIT[i % JIT.length];
      const k = JIT[(i * 3 + 5) % JIT.length];
      return {
        key: i,
        sprite: i % 3 === 1 ? 'tongue' : 'flame',
        size: fw * (0.86 + 0.3 * j),
        x: wallW * (0.3 + 0.35 * k) - fw * 0.5,
        bottom: h * (0.2 + i * 0.12),
        hue: Math.round(-10 + 22 * k),
        delay: -Math.round(1000 * j),
        period: 380 + Math.round(320 * k),
        flip: i % 2 === 0 ? 1 : -1,
      };
    });
    const embers = Array.from({ length: 9 }, (_, i) => {
      const j = JIT[(i * 2 + 1) % JIT.length];
      const k = JIT[(i * 5 + 2) % JIT.length];
      return {
        key: i,
        size: h * (0.07 + 0.07 * j),
        y: h * (0.08 + 0.82 * k),
        arc: h * (-0.12 - 0.12 * j),
        delay: Math.round(100 + 240 * j + i * 60),
        dur: Math.round(1100 + 500 * k),
        spin: Math.round(-180 + 360 * j),
      };
    });
    const sparks = Array.from({ length: 34 }, (_, i) => {
      const j = JIT[(i * 7 + 3) % JIT.length];
      const k = JIT[(i * 11 + 1) % JIT.length];
      const m = JIT[(i * 13 + 6) % JIT.length];
      return {
        key: i,
        x: w * (0.04 + 0.92 * j),
        y: h * (0.06 + 0.5 * k),
        size: 2 + Math.round(4 * m),
        delay: Math.round(450 + 1100 * ((i * 0.29) % 1)),
        dur: Math.round(900 + 900 * m),
        fall: Math.round(h * (0.12 + 0.3 * k)),
        drift: Math.round(-60 + 120 * m),
      };
    });
    return { fw, wallW, flames, embers, sparks };
  }, [size]);

  if (done || !size || !parts) return <div className="cinder-intro" aria-hidden="true" />;

  const rootVars = css({
    '--W': `${size.w}px`,
    '--H': `${size.h}px`,
    '--ci-a1': read(bio, '--fx-a1', 'orange'),
    '--ci-a2': read(bio, '--fx-a2', 'gold'),
    '--ci-light': read(bio, '--fx-light', 'white'),
    '--ci-deep': read(bio, '--fx-deep', 'black'),
    '--ci-wall': `${parts.wallW}px`,
    '--ci-total': `${TOTAL}ms`,
  });

  return (
    <div className="cinder-intro" aria-hidden="true" style={rootVars}>
      {/* back plate: the room dims, the heat blooms, a flash at the wall's crest */}
      <div className="cinder-intro-dim" />
      <div className="cinder-intro-bloom" />
      <div className="cinder-intro-flash" />

      {/* mid plate: the wall of fire, flames stacked into a curtain */}
      <div className="cinder-intro-wall">
        <div className="cinder-intro-wallglow" />
        {parts.flames.map((f) => (
          <div
            key={f.key}
            className="cinder-intro-flame"
            style={css({
              '--fs': `${f.size}px`,
              '--fl': `${f.x}px`,
              '--fb': `${f.bottom}px`,
              '--hue': `${f.hue}deg`,
              '--fd': `${f.delay}ms`,
              '--fp': `${f.period}ms`,
              '--flip': f.flip,
            })}
          >
            <img src={`/fx/cinder/${f.sprite}.png`} alt="" draggable={false} decoding="async" />
          </div>
        ))}
      </div>
      {parts.embers.map((e) => (
        <div
          key={e.key}
          className="cinder-intro-ember"
          style={css({ '--es': `${e.size}px`, '--ey': `${e.y}px`, '--earc': `${e.arc}px`, '--ed': `${e.delay}ms`, '--edur': `${e.dur}ms`, '--espin': `${e.spin}deg` })}
        >
          <img src="/fx/cinder/ember.png" alt="" draggable={false} decoding="async" />
        </div>
      ))}

      {/* front plate: sparks rain down behind the wall */}
      {parts.sparks.map((s) => (
        <span
          key={s.key}
          className="cinder-intro-spark"
          style={css({ left: s.x, top: s.y, '--ss': `${s.size}px`, '--sd': `${s.delay}ms`, '--sdur': `${s.dur}ms`, '--sfall': `${s.fall}px`, '--sdrift': `${s.drift}px` })}
        />
      ))}
    </div>
  );
}

function animateSafe(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  return typeof el.animate === 'function' ? el.animate(frames, opts) : null;
}
