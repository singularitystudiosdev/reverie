/* Zahra's opening cinematic (~2.7s, once per open): a magic lamp pops into the
   frame, is rubbed, flashes, and golden smoke pours from its spout and swirls
   across the sheet; grains of sand fly out of the smoke and the bio text
   materialises out of them, sweeping in left to right from a gold, blurred
   haze to sharp ink. The text is only acted on through Web Animations
   (opacity, filter, mask), always handed back. */
import { useLayoutEffect, useState, type CSSProperties, type JSX } from 'react';
import { asset } from '../../../../lib/asset';
import './zahra.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

interface Geo {
  fw: number;
  fh: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

const TOTAL_MS = 2800;
const LAMP = 150;
const MASK = 'linear-gradient(90deg, black 40%, transparent 60%)';

/** A small deterministic generator so the sand falls the same way every open. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function ZahraIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [done, setDone] = useState(false);

  useLayoutEffect(() => {
    const f = frame.getBoundingClientRect();
    const b = bio.getBoundingClientRect();
    setGeo({ fw: f.width, fh: f.height, bx: b.left - f.left, by: b.top - f.top, bw: b.width, bh: b.height });
    const materialise = bio.animate(
      [
        {
          offset: 0,
          opacity: 0,
          filter: 'blur(7px) sepia(1) saturate(3) brightness(1.3)',
          maskImage: MASK,
          webkitMaskImage: MASK,
          maskSize: '300% 100%',
          webkitMaskSize: '300% 100%',
          maskPosition: '100% 0',
          webkitMaskPosition: '100% 0',
        },
        {
          offset: 0.3,
          opacity: 0,
          filter: 'blur(7px) sepia(1) saturate(3) brightness(1.3)',
          maskImage: MASK,
          webkitMaskImage: MASK,
          maskSize: '300% 100%',
          webkitMaskSize: '300% 100%',
          maskPosition: '100% 0',
          webkitMaskPosition: '100% 0',
        },
        {
          offset: 0.62,
          opacity: 1,
          filter: 'blur(3px) sepia(0.7) saturate(2) brightness(1.15)',
          maskImage: MASK,
          webkitMaskImage: MASK,
          maskSize: '300% 100%',
          webkitMaskSize: '300% 100%',
          maskPosition: '50% 0',
          webkitMaskPosition: '50% 0',
        },
        {
          offset: 0.86,
          opacity: 1,
          filter: 'blur(0px) sepia(0) saturate(1) brightness(1)',
          maskImage: MASK,
          webkitMaskImage: MASK,
          maskSize: '300% 100%',
          webkitMaskSize: '300% 100%',
          maskPosition: '0% 0',
          webkitMaskPosition: '0% 0',
        },
        { offset: 1, opacity: 1, filter: 'none' },
      ],
      { duration: TOTAL_MS, easing: 'ease-in-out' }
    );
    const timer = window.setTimeout(() => setDone(true), TOTAL_MS + 100);
    return () => {
      materialise.cancel();
      window.clearTimeout(timer);
    };
  }, [bio, frame]);

  if (!geo || done) return null;
  const { fw, fh, bx, by, bw, bh } = geo;

  const lx = Math.max(LAMP / 2 + 10, Math.min(fw * 0.22, bx + 70));
  const ly = Math.min(fh - LAMP / 2 - 10, by + bh + 110);
  const spoutX = lx + LAMP * 0.45;
  const spoutY = ly - LAMP * 0.19;

  /* smoke: six plumes land across the text, two sweep the whole frame */
  const rand = rng(7);
  const plumes = [
    ...Array.from({ length: 6 }, (_, i) => ({
      ex: bx + ((i + 0.5) / 6) * bw,
      ey: by + bh / 2 + (rand() - 0.5) * bh * 0.6,
      s: 190 + rand() * 80,
      d: 0.55 + i * 0.13,
      r0: -30 + rand() * 60,
      r1: 40 + rand() * 90,
    })),
    { ex: fw * 0.85, ey: Math.max(50, by - 50), s: 320, d: 0.75, r0: 10, r1: 120 },
    { ex: fw * 0.2, ey: Math.max(40, by - 90), s: 290, d: 0.95, r0: -20, r1: -110 },
  ];

  /* sand: each grain flies from the spout to a spot in the text, sweeping in
     step with the reveal (earlier on the left) */
  const grains = Array.from({ length: 56 }, () => {
    const tx = rand();
    const ty = rand();
    const gx = bx + tx * bw;
    const gy = by + ty * bh;
    return {
      sx: spoutX - gx + (rand() - 0.5) * 40,
      sy: spoutY - gy + (rand() - 0.5) * 40,
      wx: (rand() - 0.5) * 160,
      wy: (rand() - 0.5) * 160,
      x: gx,
      y: gy,
      s: 2.5 + rand() * 3.5,
      d: 0.75 + tx * 0.8 + rand() * 0.15,
    };
  });

  const style = {
    '--total': `${TOTAL_MS}ms`,
    '--lx': `${lx}px`,
    '--ly': `${ly}px`,
    '--sx': `${spoutX}px`,
    '--sy': `${spoutY}px`,
  } as CSSProperties;

  return (
    <div className="zh-intro" aria-hidden="true" style={style}>
      <div className="zh-i-haze" />

      {grains.map((g, i) => (
        <span
          key={i}
          className="zh-i-grain"
          style={{ left: g.x, top: g.y, width: g.s, height: g.s, '--gx': `${g.sx}px`, '--gy': `${g.sy}px`, '--wx': `${g.wx}px`, '--wy': `${g.wy}px`, '--d': `${g.d}s` } as CSSProperties}
        />
      ))}

      {plumes.map((p, i) => (
        <span
          key={i}
          className="zh-i-plume"
          style={{ '--ex': `${p.ex - spoutX}px`, '--ey': `${p.ey - spoutY}px`, '--s': `${p.s}px`, '--d': `${p.d}s`, '--r0': `${p.r0}deg`, '--r1': `${p.r1}deg` } as CSSProperties}
        >
          <span className="zh-i-plume-y">
            <span className="zh-i-plume-in">
              <img src={asset("/fx/zahra/smoke.png")} alt="" draggable={false} />
            </span>
          </span>
        </span>
      ))}

      <span className="zh-i-flash" />
      <span className="zh-i-lamp">
        <span className="zh-i-lamp-rub">
          <img src={asset("/fx/zahra/lamp.png")} alt="" draggable={false} />
        </span>
      </span>
      <span className="zh-i-glitter">
        <img src={asset("/fx/zahra/glitter.png")} alt="" draggable={false} />
      </span>
    </div>
  );
}
