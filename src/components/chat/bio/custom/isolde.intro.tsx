/* Isolde's opening cinematic (about 2.6 s): frost freezes in from the edges of
   the frame, the bio text frosts over, then shatters into ice that flies apart
   in 3D and re-forms into the words as the frost thaws.
   Three plates: a back plate of cold (rime, flash, shock ring), a mid plate of
   painted sprites (edge crystals, flying shards) and the front plate, the text
   itself, cut into shards. The shards are clipped clones of the bio paragraph
   laid over the original; every clone is removed, and the original is returned
   to its own look, when the cinematic ends or the component unmounts. */
import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import './isolde.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const TOTAL = 2600;
const COLS = 4;
const ROWS = 3;

const JIT = [0.12, 0.83, 0.47, 0.66, 0.21, 0.95, 0.38, 0.74, 0.05, 0.58, 0.31, 0.89, 0.43, 0.7, 0.17, 0.92, 0.62, 0.28, 0.79, 0.52];

function css(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

function read(el: HTMLElement, name: string, fallback: string): string {
  const val = getComputedStyle(el).getPropertyValue(name).trim();
  return val || fallback;
}

type Pt = { x: number; y: number };

/* a jittered grid cut into triangles: [a, b, c] vertices in percent of the box */
function cutShards(): Pt[][] {
  const pts: Pt[][] = [];
  for (let r = 0; r <= ROWS; r += 1) {
    const row: Pt[] = [];
    for (let c = 0; c <= COLS; c += 1) {
      const j = JIT[(r * 7 + c * 3) % JIT.length] - 0.5;
      const k = JIT[(r * 5 + c * 11 + 2) % JIT.length] - 0.5;
      const edgeX = c === 0 || c === COLS;
      const edgeY = r === 0 || r === ROWS;
      row.push({
        x: (c / COLS) * 100 + (edgeX ? 0 : j * 12),
        y: (r / ROWS) * 100 + (edgeY ? 0 : k * 14),
      });
    }
    pts.push(row);
  }
  const tris: Pt[][] = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const a = pts[r][c];
      const b = pts[r][c + 1];
      const d = pts[r + 1][c];
      const e = pts[r + 1][c + 1];
      if ((r + c) % 2 === 0) {
        tris.push([a, b, e], [a, e, d]);
      } else {
        tris.push([a, b, d], [b, e, d]);
      }
    }
  }
  return tris;
}

export default function IsoldeIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const [done, setDone] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number; cx: number; cy: number; bw: number; bh: number } | null>(null);

  useEffect(() => {
    const f = frame.getBoundingClientRect();
    const b = bio.getBoundingClientRect();
    setSize({ w: f.width, h: f.height, cx: b.left - f.left + b.width / 2, cy: b.top - f.top + b.height / 2, bw: b.width, bh: b.height });
  }, [bio, frame]);

  /* the text: frosts over, shatters into clipped clones, re-forms, thaws */
  useEffect(() => {
    const parent = bio.parentElement;
    if (!parent || typeof bio.animate !== 'function') {
      return undefined;
    }
    const ice = read(bio, '--fx-light', 'white');
    const frosted = `saturate(0.45) brightness(1.3) contrast(0.95) drop-shadow(0 0 4px ${ice})`;
    const clones: HTMLElement[] = [];
    const anims: Animation[] = [];
    const cx = bio.offsetLeft;
    const cy = bio.offsetTop;
    const bw = bio.offsetWidth;
    const bh = bio.offsetHeight;

    const tris = cutShards();
    tris.forEach((tri, i) => {
      const clone = bio.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-slot');
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('.fx-layer').forEach((n) => n.remove());
      Object.assign(clone.style, {
        position: 'absolute',
        left: `${cx}px`,
        top: `${cy}px`,
        width: `${bw}px`,
        height: `${bh}px`,
        margin: '0',
        pointerEvents: 'none',
        opacity: '0',
        clipPath: `polygon(${tri.map((p) => `${p.x.toFixed(2)}% ${p.y.toFixed(2)}%`).join(',')})`,
        willChange: 'transform, opacity',
      });
      parent.insertBefore(clone, bio.nextSibling);
      clones.push(clone);

      /* the shard flies away from the middle of the paragraph, toward the viewer */
      const mx = (tri[0].x + tri[1].x + tri[2].x) / 3 / 100 - 0.5;
      const my = (tri[0].y + tri[1].y + tri[2].y) / 3 / 100 - 0.5;
      const j = JIT[(i * 3 + 1) % JIT.length];
      const k = JIT[(i * 7 + 4) % JIT.length];
      const dx = mx * bw * (0.5 + 0.7 * j) + (k - 0.5) * 26;
      const dy = my * bh * (0.5 + 0.7 * k) + (j - 0.5) * 26;
      const dz = 60 + 220 * j;
      const rx = (k - 0.5) * 140;
      const ry = (j - 0.5) * 140;
      const rz = (JIT[(i * 5 + 9) % JIT.length] - 0.5) * 80;
      const at = (tx: number, ty: number, tz: number, ax: number, ay: number, az: number) =>
        `perspective(720px) translate3d(${tx}px, ${ty}px, ${tz}px) rotateX(${ax}deg) rotateY(${ay}deg) rotateZ(${az}deg)`;
      const rest = at(0, 0, 0, 0, 0, 0);
      const apart = at(dx, dy, dz, rx, ry, rz);
      anims.push(
        clone.animate(
          [
            { offset: 0, opacity: 0, transform: rest, filter: frosted },
            { offset: 0.37, opacity: 0, transform: rest, filter: frosted },
            { offset: 0.375, opacity: 1, transform: rest, filter: frosted, easing: 'cubic-bezier(0.08, 0.75, 0.25, 1)' },
            { offset: 0.5, opacity: 1, transform: apart, filter: `${frosted} brightness(1.2)` },
            { offset: 0.58, opacity: 1, transform: at(dx * 1.08, dy * 1.08 + 6, dz * 1.06, rx * 1.05, ry * 1.05, rz * 1.05), filter: frosted, easing: 'cubic-bezier(0.5, 0, 0.2, 1.15)' },
            { offset: 0.82, opacity: 1, transform: rest, filter: frosted },
            { offset: 0.83, opacity: 0, transform: rest, filter: frosted },
            { offset: 1, opacity: 0, transform: rest, filter: frosted },
          ],
          { duration: TOTAL, fill: 'both' }
        )
      );
    });

    /* the original: frosts, hides while the shards fly, is back as they seal */
    anims.push(
      bio.animate(
        [
          { offset: 0, opacity: 1, filter: 'none' },
          { offset: 0.34, opacity: 1, filter: frosted },
          { offset: 0.37, opacity: 1, filter: frosted },
          { offset: 0.375, opacity: 0, filter: frosted },
          { offset: 0.82, opacity: 0, filter: frosted },
          { offset: 0.83, opacity: 1, filter: frosted },
          { offset: 1, opacity: 1, filter: 'none' },
        ],
        { duration: TOTAL }
      )
    );
    const end = window.setTimeout(() => {
      clones.forEach((c) => c.remove());
      setDone(true);
    }, TOTAL + 80);
    return () => {
      window.clearTimeout(end);
      anims.forEach((a) => a.cancel());
      clones.forEach((c) => c.remove());
    };
  }, [bio]);

  const parts = useMemo(() => {
    if (!size) return null;
    const { w, h } = size;
    /* crystals that grow inward from the frame's edges: position on the
       perimeter (t runs 0..1 around it), size, turn, when they start */
    const crystals = Array.from({ length: 12 }, (_, i) => {
      const t = (i + 0.5) / 12;
      const j = JIT[(i * 3 + 2) % JIT.length];
      const k = JIT[(i * 7 + 5) % JIT.length];
      const per = 2 * (w + h);
      const d = t * per;
      let x: number;
      let y: number;
      if (d < w) {
        x = d;
        y = 0;
      } else if (d < w + h) {
        x = w;
        y = d - w;
      } else if (d < 2 * w + h) {
        x = w - (d - w - h);
        y = h;
      } else {
        x = 0;
        y = h - (d - 2 * w - h);
      }
      return {
        key: i,
        x,
        y,
        size: w * (0.2 + 0.22 * j),
        turn: Math.round(-60 + 120 * k),
        delay: Math.round(80 + 700 * ((i * 0.37) % 1)),
      };
    });
    const shards = Array.from({ length: 11 }, (_, i) => {
      const j = JIT[(i * 5 + 1) % JIT.length];
      const k = JIT[(i * 3 + 7) % JIT.length];
      const ang = (i / 11) * Math.PI * 2 + j * 0.5;
      const reach = Math.min(w, h) * (0.35 + 0.4 * k);
      return {
        key: i,
        size: w * (0.16 + 0.16 * j),
        x: Math.cos(ang) * reach * 1.1,
        y: Math.sin(ang) * reach * 0.9,
        z: Math.round(40 + 260 * j),
        spin: Math.round(-200 + 400 * k),
        flip: i % 2 === 0 ? 1 : -1,
      };
    });
    return { crystals, shards };
  }, [size]);

  if (done || !size || !parts) return <div className="isolde-intro" aria-hidden="true" />;

  const rootVars = css({
    '--W': `${size.w}px`,
    '--H': `${size.h}px`,
    '--cx': `${size.cx}px`,
    '--cy': `${size.cy}px`,
    '--ii-ice': read(bio, '--fx-light', 'white'),
    '--ii-deep': read(bio, '--fx-deep', 'black'),
    '--ii-glacier': read(bio, '--t-accent', 'skyblue'),
    '--ii-total': `${TOTAL}ms`,
  });

  return (
    <div className="isolde-intro" aria-hidden="true" style={rootVars}>
      {/* back plate: night closes in, rime creeps from the edges, a flash when it fully freezes */}
      <div className="isolde-intro-night" />
      <div className="isolde-intro-rime" />
      <div className="isolde-intro-rime isolde-intro-rime-pattern" />
      <div className="isolde-intro-flash" />
      <div className="isolde-intro-ring" />
      <div className="isolde-intro-ring isolde-intro-ring-late" />

      {/* mid plate: crystals grow along the edges, shards burst from the text and fly back in */}
      {parts.crystals.map((c) => (
        <div key={c.key} className="isolde-intro-crystal" style={css({ left: c.x, top: c.y, '--cs': `${c.size}px`, '--ct': `${c.turn}deg`, '--cd': `${c.delay}ms` })}>
          <img src="/fx/isolde/snowflake.png" alt="" draggable={false} decoding="async" />
        </div>
      ))}
      {parts.shards.map((s) => (
        <div
          key={s.key}
          className="isolde-intro-shard"
          style={css({ '--ss': `${s.size}px`, '--sx': `${s.x}px`, '--sy': `${s.y}px`, '--sz': `${s.z}px`, '--sspin': `${s.spin}deg`, '--sflip': s.flip })}
        >
          <img src="/fx/isolde/shard.png" alt="" draggable={false} decoding="async" />
        </div>
      ))}
    </div>
  );
}
