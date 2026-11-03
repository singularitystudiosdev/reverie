/* Kiyo's opening cinematic (~2.6s, once per open): a blue fox spirit, a
   floating kitsune mask trailing its foxfire tails, dashes across the frame;
   as it passes, the bio text ignites in blue flame, flames lick its edges
   left to right, and everything settles back to ink. The text itself is only
   acted on through Web Animations (color + filter), always handed back. */
import { useLayoutEffect, useState, type CSSProperties, type JSX } from 'react';
import { asset } from '../../../../lib/asset';
import './kiyo.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

interface Geo {
  fw: number;
  fh: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

const TOTAL_MS = 2700;
const RUN_DELAY = 0.2;
const RUN_TIME = 1.35;

const TRAIL = [
  { dx: -92, dy: 6, s: 62, d: '-0.1s' },
  { dx: -138, dy: -8, s: 50, d: '-0.35s' },
  { dx: -178, dy: 10, s: 42, d: '-0.2s' },
  { dx: -214, dy: -4, s: 34, d: '-0.5s' },
  { dx: -246, dy: 8, s: 26, d: '-0.3s' },
] as const;

export default function KiyoIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [done, setDone] = useState(false);

  useLayoutEffect(() => {
    const f = frame.getBoundingClientRect();
    const b = bio.getBoundingClientRect();
    setGeo({ fw: f.width, fh: f.height, bx: b.left - f.left, by: b.top - f.top, bw: b.width, bh: b.height });
    const ignite = bio.animate(
      [
        { offset: 0.2, color: 'inherit', filter: 'none' },
        {
          offset: 0.4,
          color: 'color-mix(in oklab, var(--fx-a1, currentColor) 70%, white)',
          filter: 'drop-shadow(0 0 0.35em var(--fx-a1, currentColor)) drop-shadow(0 -0.15em 0.7em var(--fx-a1, currentColor))',
        },
        {
          offset: 0.62,
          color: 'color-mix(in oklab, var(--fx-a1, currentColor) 45%, currentColor)',
          filter: 'drop-shadow(0 0 0.5em var(--fx-a1, currentColor))',
        },
        { offset: 1, color: 'inherit', filter: 'none' },
      ],
      { duration: TOTAL_MS, easing: 'ease-in-out' }
    );
    const timer = window.setTimeout(() => setDone(true), TOTAL_MS + 100);
    return () => {
      ignite.cancel();
      window.clearTimeout(timer);
    };
  }, [bio, frame]);

  if (!geo || done) return null;
  const { fw, fh, bx, by, bw, bh } = geo;
  const cy = by + bh / 2;
  const x0 = -260;
  const x1 = fw + 160;
  const flames = Math.max(5, Math.min(14, Math.round(bw / 50)));

  const style = {
    '--fw': `${fw}px`,
    '--x0': `${x0}px`,
    '--x1': `${x1}px`,
    '--y0': `${Math.min(fh - 60, cy + 190)}px`,
    '--y1': `${cy}px`,
    '--y2': `${Math.max(40, cy - 210)}px`,
    '--run': `${RUN_TIME}s`,
    '--run-d': `${RUN_DELAY}s`,
    '--total': `${TOTAL_MS}ms`,
  } as CSSProperties;

  return (
    <div className="ky-intro" aria-hidden="true" style={style}>
      <div className="ky-i-wash" style={{ left: bx, top: by, width: bw, height: bh }}>
        <span className="ky-i-sweep" />
      </div>

      {Array.from({ length: flames }, (_, i) => {
        const x = bx + ((i + 0.5) / flames) * bw;
        const t = RUN_DELAY + (RUN_TIME * (x - x0)) / (x1 - x0);
        const big = i % 2 === 0;
        return (
          <span
            key={`t${i}`}
            className="ky-i-flame"
            style={{ left: x, top: by + 4, '--s': `${big ? 58 : 44}px`, '--t': `${t}s`, '--fd': `${-0.11 * i}s` } as CSSProperties}
          >
            <img src={asset("/fx/kiyo/wisp.png")} alt="" draggable={false} />
          </span>
        );
      })}
      {Array.from({ length: Math.ceil(flames / 2) }, (_, i) => {
        const x = bx + ((i + 0.5) / Math.ceil(flames / 2)) * bw;
        const t = RUN_DELAY + 0.12 + (RUN_TIME * (x - x0)) / (x1 - x0);
        return (
          <span
            key={`b${i}`}
            className="ky-i-flame ky-i-flame-low"
            style={{ left: x, top: by + bh + 2, '--s': '36px', '--t': `${t}s`, '--fd': `${-0.17 * i}s` } as CSSProperties}
          >
            <img src={asset("/fx/kiyo/wisp.png")} alt="" draggable={false} />
          </span>
        );
      })}

      <div className="ky-i-run-x">
        <div className="ky-i-run-y">
          <div className="ky-i-spirit">
            <span className="ky-i-streak" />
            {TRAIL.map((w, i) => (
              <span key={i} className="ky-i-trail" style={{ left: w.dx, top: w.dy, '--s': `${w.s}px`, '--fd': w.d } as CSSProperties}>
                <img src={asset("/fx/kiyo/wisp.png")} alt="" draggable={false} />
              </span>
            ))}
            <span className="ky-i-tail">
              <img src={asset("/fx/kiyo/tail.png")} alt="" draggable={false} />
            </span>
            <span className="ky-i-mask">
              <img src={asset("/fx/kiyo/mask.png")} alt="" draggable={false} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
