/* Nerissa's opening: a wall of water crashes across the whole frame with
   wave-crest sprites riding its edge and spray flying off, the bio text
   ripples as if seen through water (an SVG turbulence displacement driven for
   the length of the crash), and bubbles rush up the frame. Plays once (about
   2.8s), restores the text, then unmounts. */
import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import './nerissa.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const RIPPLE_MS = 2300;
const TOTAL_MS = 2900;

const v = (vars: Record<string, string | number>): CSSProperties => vars as CSSProperties;

/* A tiny deterministic generator so the bubbles are the same every open. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const rand = seeded(7);
const BUBBLES = Array.from({ length: 22 }, () => ({
  x: `${(3 + rand() * 94).toFixed(1)}%`,
  s: `${Math.round(12 + rand() * 34)}px`,
  d: `${(0.4 + rand() * 1.15).toFixed(2)}s`,
  t: `${(1.3 + rand() * 0.8).toFixed(2)}s`,
  sx: `${Math.round(-18 + rand() * 36)}px`,
}));

const SPRAY = Array.from({ length: 14 }, (_, i) => ({
  y: `${(6 + rand() * 84).toFixed(1)}%`,
  s: `${Math.round(9 + rand() * 14)}px`,
  d: `${(0.25 + i * 0.07).toFixed(2)}s`,
  dx: `${Math.round(60 + rand() * 120)}px`,
  dy: `${Math.round(-90 - rand() * 90)}px`,
}));

export default function NerissaIntro(props: IntroProps): JSX.Element | null {
  const { bio } = props;
  const [done, setDone] = useState(false);
  const turbulence = useRef<SVGFETurbulenceElement>(null);
  const displace = useRef<SVGFEDisplacementMapElement>(null);

  useEffect(() => {
    const wobble = bio.animate(
      [
        { transform: 'translateY(0) skewX(0deg)', offset: 0 },
        { transform: 'translateY(3px) skewX(0.8deg)', offset: 0.25 },
        { transform: 'translateY(-2px) skewX(-0.7deg)', offset: 0.5 },
        { transform: 'translateY(1.5px) skewX(0.4deg)', offset: 0.75 },
        { transform: 'translateY(0) skewX(0deg)', offset: 1 },
      ],
      { duration: RIPPLE_MS, delay: 350, easing: 'ease-in-out', fill: 'backwards' }
    );
    bio.style.filter = 'url(#ne-intro-ripple)';
    const t0 = performance.now() + 350;
    let raf = 0;
    const tick = (now: number): void => {
      const p = (now - t0) / (RIPPLE_MS - 350);
      if (p >= 1) {
        displace.current?.setAttribute('scale', '0');
        return;
      }
      if (p >= 0) {
        const swell = Math.sin(Math.PI * Math.min(1, p * 1.15)) ** 1.5;
        displace.current?.setAttribute('scale', (13 * swell).toFixed(2));
        turbulence.current?.setAttribute('baseFrequency', `${(0.012 + 0.004 * Math.sin(p * 9)).toFixed(4)} ${(0.05 + 0.014 * Math.sin(p * 13)).toFixed(4)}`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const end = window.setTimeout(() => setDone(true), TOTAL_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(end);
      wobble.cancel();
      bio.style.filter = '';
    };
  }, [bio]);

  if (done) {
    bio.style.filter = '';
    return null;
  }

  return (
    <div className="ne-intro">
      <svg className="ne-i-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="ne-intro-ripple" x="-4%" y="-8%" width="108%" height="116%">
          <feTurbulence ref={turbulence} type="turbulence" baseFrequency="0.012 0.05" numOctaves="2" seed="4" result="noise" />
          <feDisplacementMap ref={displace} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div className="ne-i-tint" />
      <div className="ne-i-sheet">
        <div className="ne-i-body" />
        <div className="ne-i-foam" />
        {[0, 1, 2].map((i) => (
          <img key={i} className="ne-i-crest" data-i={i} src="/fx/nerissa/wave.png" alt="" draggable={false} />
        ))}
        {SPRAY.map((p, i) => (
          <img key={i} className="ne-i-spray" src="/fx/nerissa/bubble.png" alt="" draggable={false} style={v({ '--y': p.y, '--s': p.s, '--d': p.d, '--dx': p.dx, '--dy': p.dy })} />
        ))}
      </div>
      {BUBBLES.map((b, i) => (
        <span key={i} className="ne-i-bubble" style={v({ '--x': b.x, '--s': b.s, '--d': b.d, '--t': b.t, '--sx': b.sx })}>
          <img src="/fx/nerissa/bubble.png" alt="" draggable={false} />
        </span>
      ))}
    </div>
  );
}
