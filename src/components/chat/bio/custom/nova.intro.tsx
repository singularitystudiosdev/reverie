/* Nova's opening cinematic (about 2.3s, once per open): the screen glitches
   (RGB-fringed vignette, torn colour slices, scanlines, a bright band passing),
   and the bio text decodes out of random glyphs, locking letter by letter in
   reading order with a ragged front.

   The real bio is React-owned, so it is never rewritten: it is hidden
   (visibility only, no layout change), and a clone of it, with its effect
   layers stripped, is scrambled inside the overlay and tracked to the bio's
   rect every tick. When the decode finishes the clone is removed and the real
   bio shows again, text identical to the clone's last frame. */
import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import './nova.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const GLYPHS = '01<>/\\#$%&*+=?!{}[]|~^:;';
const DECODE_START = 320;
const DECODE_END = 1720;
const TOTAL = 2350;
const TICK = 46;

/* top / height (% of the frame), sideways throw (px), cyan or magenta, delay and length (s) */
const TEARS = [
  { top: 8, h: 2.2, dx: 46, m: 0, d: 0.02, t: 0.62 },
  { top: 19, h: 5, dx: -62, m: 1, d: 0.06, t: 0.5 },
  { top: 31, h: 1.4, dx: 38, m: 0, d: 0.1, t: 0.7 },
  { top: 44, h: 3.6, dx: -80, m: 1, d: 0.03, t: 0.58 },
  { top: 57, h: 1.8, dx: 54, m: 0, d: 0.14, t: 0.52 },
  { top: 66, h: 6, dx: -44, m: 1, d: 0.08, t: 0.66 },
  { top: 78, h: 2.4, dx: 70, m: 0, d: 0.04, t: 0.6 },
  { top: 88, h: 3, dx: -52, m: 1, d: 0.12, t: 0.54 },
  { top: 37, h: 2.8, dx: 90, m: 1, d: 1.72, t: 0.4 },
  { top: 71, h: 4.2, dx: -76, m: 0, d: 1.76, t: 0.36 },
] as const;

interface Slot {
  node: Text;
  chars: string[];
  /* index -> time (ms) the char locks to its real value; -1 for whitespace */
  lock: number[];
}

function collectSlots(root: HTMLElement): Slot[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const total = nodes.reduce((sum, n) => sum + n.data.replace(/\s/g, '').length, 0) || 1;
  let seen = 0;
  return nodes.map((node) => {
    const chars = node.data.split('');
    const lock = chars.map((ch) => {
      if (/\s/.test(ch)) return -1;
      const f = (seen / total) * 0.72 + Math.random() * 0.28;
      seen += 1;
      return DECODE_START + f * (DECODE_END - DECODE_START);
    });
    return { node, chars, lock };
  });
}

function scramble(slots: Slot[], now: number): void {
  for (const s of slots) {
    let out = '';
    for (let i = 0; i < s.chars.length; i++) {
      out += s.lock[i] < 0 || s.lock[i] <= now ? s.chars[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }
    if (s.node.data !== out) s.node.data = out;
  }
}

export default function NovaIntro({ bio, frame }: IntroProps): JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const clone = bio.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.fx-layer').forEach((n) => n.remove());
    clone.querySelectorAll('[data-w]').forEach((n) => n.removeAttribute('data-w'));
    clone.removeAttribute('data-slot');
    clone.setAttribute('aria-hidden', 'true');
    clone.classList.add('nova-in-text');

    const cs = getComputedStyle(bio);
    const box = bio.getBoundingClientRect();
    Object.assign(clone.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      margin: '0',
      width: `${box.width}px`,
      minHeight: `${box.height}px`,
      pointerEvents: 'none',
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textAlign: cs.textAlign,
      color: cs.color,
    });
    host.appendChild(clone);

    const slots = collectSlots(clone);
    const previous = bio.style.visibility;
    bio.style.visibility = 'hidden';

    const t0 = performance.now();
    const place = (): void => {
      const r = bio.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      clone.style.transform = `translate(${r.left - f.left}px, ${r.top - f.top}px)`;
    };
    place();
    scramble(slots, 0);

    let revealed = false;
    const reveal = (): void => {
      if (revealed) return;
      revealed = true;
      bio.style.visibility = previous;
      clone.remove();
    };

    const tick = window.setInterval(() => {
      const now = performance.now() - t0;
      place();
      if (now >= DECODE_END + 60) {
        reveal();
        return;
      }
      scramble(slots, now);
    }, TICK);
    const end = window.setTimeout(() => setDone(true), TOTAL);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(end);
      reveal();
    };
  }, [bio, frame]);

  if (done) return null;

  return (
    <div className="nova-in" aria-hidden="true">
      <div className="nova-in-vig" />
      <div className="nova-in-scan" />
      <div ref={hostRef} className="nova-in-host" />
      {TEARS.map((t, i) => (
        <span
          key={i}
          className="nova-in-tear"
          data-m={t.m}
          style={
            {
              '--top': `${t.top}%`,
              '--h': `${t.h}%`,
              '--dx': `${t.dx}px`,
              '--d': `${t.d}s`,
              '--t': `${t.t}s`,
            } as CSSProperties
          }
        />
      ))}
      <div className="nova-in-band" />
      <div className="nova-in-flash" />
    </div>
  );
}
