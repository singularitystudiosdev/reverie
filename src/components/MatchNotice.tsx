/*
  The match notification: ONE component for every match, instant or delayed,
  that drops from the top of the frame over whatever screen is showing. It
  replaces the centered "You Matched!" modal and the bottom toast.

  - Content: her animated round avatar in the live ring (Avatar > Portrait),
    her name in Instrument Serif, "It's a match", and one "Chat" button that
    opens her chat. The card is themed to HER, not the frame: her palette is
    written onto the card as --t-* (so every utility inside reads her colours),
    her scene plate sits softly behind, and her world's own particle kinds
    drift inside it (a small canvas, the real sprites from theme/particles).
    When it drops, a burst of those same particles fans out from the top
    centre of the frame. (The frame's burst() always fires from the frame's
    own current world at its centre, so over another character's chat it
    would be the wrong world and the wrong place.)
  - It never blocks anything: no scrim, no focus trap, no inert content. The
    container is role="status" (polite); Escape dismisses it (a sheet or the
    drawer takes the key first when one is open).
  - Queue: the store keeps it (state.matchNotices); only the head shows, and the
    next drops after the previous has left (AnimatePresence mode="wait").
    Entering her chat removes her from the queue, so nothing shows for a chat
    the user is already in.
  - Dismissal: about 6s (paused while hovered, focused or being dragged), a swipe
    up, Escape, or "Chat".
  - Motion: drops from above the frame on a snappy spring with a slight
    overshoot; leaves upward on the exit easing. Reduced motion: a fade only,
    no burst, and the card's particles render one still frame.
*/
import { AnimatePresence, motion, useIsPresent, type PanInfo } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import type { Character, ParticleKind, ParticleLayer, ThemeColors } from '../data/types';
import { dur, ease, spring, useReducedMotion } from '../lib/motion';
import { useApp, useCharacter } from '../state/store';
import { kinds } from '../theme/particles/kinds';
import { sprite, type Sprite } from '../theme/particles/sprites';
import { getTheme } from '../theme/themes';
import { Avatar } from './Avatar';

/**
 * Gesture and simulation numbers, not design values (like deckConfig and the
 * constants under src/theme/particles). Fold into motion.ts when it is next
 * touched.
 */
export const noticeConfig = {
  /** How long it stays before it leaves by itself (ms). */
  dismissMs: 6000 /* deliberate */,
  /** The drop: snappy, a little looser so it overshoots by about 6%. */
  drop: { ...spring.snappy, stiffness: 380, damping: 26 },
  /** Hidden position above the frame (share of the card's own height; clears a safe-area inset). */
  hiddenY: '-200%',
  /** A swipe up past this many px, or faster than this (px/s), dismisses. */
  swipeDistance: 48,
  swipeVelocity: 400,
  /** The card's particles are drawn at this share of their frame size. */
  cardScale: 0.55,
  /** Ambient particles per layer in the card, and in total. */
  perLayer: { min: 2, max: 6, perDensity: 0.7 },
  maxAmbient: 12,
  /** The burst at the top of the frame. */
  burst: {
    count: 22,
    scale: 0.8,
    speed: [140, 340],
    drag: 1.6,
    life: [1.3, 2.3],
    fadeIn: 0.08,
    gravity: 70,
    spin: 3,
  },
  /** The longest frame the simulation will integrate (s). */
  maxDt: 0.05,
} as const;

/* ------------------------------------------------------------------ theme */

const slotVars: Record<Exclude<keyof ThemeColors, 'stage'>, string> = {
  canvas: '--t-canvas',
  canvas2: '--t-canvas-2',
  surface: '--t-surface',
  surfaceStrong: '--t-surface-strong',
  ink: '--t-ink',
  muted: '--t-muted',
  hairline: '--t-hairline',
  accent: '--t-accent',
  onAccent: '--t-on-accent',
  me: '--t-me',
  onMe: '--t-on-me',
  glow: '--t-glow',
};

/** Her palette as --t-* on the card, plus her focus ring: the frame's own theme is ignored. */
function herVars(character: Character): CSSProperties {
  const theme = getTheme(character.theme);
  const style: Record<string, string> = { colorScheme: theme.scheme };
  for (const [slot, name] of Object.entries(slotVars)) {
    style[name] = theme.colors[slot as keyof typeof slotVars];
  }
  style['--focus-ring-color'] = theme.colors.accent;
  return style as CSSProperties;
}

/* -------------------------------------------------------------- particles */

const TAU = Math.PI * 2;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** Her particle layers that draw a sprite or a rain stroke, densest first, capped. */
function usableLayers(layers: readonly ParticleLayer[]): ParticleLayer[] {
  return layers.filter((l) => l.colors.length > 0).slice(0, 3);
}

interface Mote {
  kind: ParticleKind;
  /** sprites[variant * frames + frame] for one colour, already rendered. */
  sprites: Sprite[];
  frames: number;
  stroke: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  phase: number;
  alpha: number;
  /** Burst only: seconds lived, and the life it dies at. */
  age: number;
  life: number;
  /** Streaks (shooting stars): seconds until the next pass; <0 while crossing. */
  wait: number;
}

function sizeCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  return { w, h, dpr };
}

function makeMote(layer: ParticleLayer, scale: number, dpr: number): Mote {
  const def = kinds[layer.kind];
  const color = pick(layer.colors);
  const size = (layer.size ?? 1) * scale;
  const sprites: Sprite[] = [];
  for (let v = 0; v < def.variants; v++) {
    for (let f = 0; f < def.frames; f++) sprites.push(sprite(layer.kind, color, v, f, size, dpr));
  }
  return {
    kind: layer.kind,
    sprites,
    frames: def.frames,
    stroke: color,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: rand(0, TAU),
    spin: rand(-0.6, 0.6),
    phase: rand(0, TAU),
    alpha: rand(def.alpha[0], def.alpha[1]),
    age: 0,
    life: 0,
    wait: rand(1, 4),
  };
}

function drawMote(ctx: CanvasRenderingContext2D, m: Mote, t: number, alpha: number, light: boolean, wob: boolean): void {
  const def = kinds[m.kind];
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (m.kind === 'rain') {
    ctx.strokeStyle = m.stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - 3, m.y - 11);
    ctx.stroke();
    return;
  }
  const frame = m.frames > 1 ? Math.floor(t * 7 + m.phase) % m.frames : 0;
  const variant = Math.floor(m.phase * 7) % Math.max(1, def.variants);
  const sp = m.sprites[variant * m.frames + frame] ?? m.sprites[0];
  if (!sp) return;
  ctx.globalCompositeOperation = def.additive && !light ? 'lighter' : 'source-over';
  ctx.save();
  ctx.translate(m.x, m.y);
  // Streaks and bats keep their heading; the rest turn and sway.
  if (m.kind === 'shootingStar') ctx.rotate(Math.atan2(m.vy, m.vx));
  else if (wob) ctx.rotate(m.rot);
  ctx.drawImage(sp.img, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
  ctx.restore();
}

function respawnAmbient(m: Mote, w: number, h: number, speed: number, scatter: boolean): void {
  const def = kinds[m.kind];
  const pad = 20;
  m.x = rand(0, w);
  m.y = rand(0, h);
  m.vx = 0;
  m.vy = 0;
  switch (def.motion) {
    case 'fall':
      m.vy = rand(14, 26) * speed;
      if (!scatter) m.y = -pad;
      break;
    case 'rise':
      m.vy = -rand(12, 24) * speed;
      if (!scatter) m.y = h + pad;
      break;
    case 'cross': {
      const dir = Math.random() < 0.5 ? -1 : 1;
      m.vx = dir * rand(22, 40) * speed;
      if (!scatter) m.x = dir > 0 ? -pad : w + pad;
      break;
    }
    case 'streak':
      m.vx = -rand(240, 320);
      m.vy = rand(90, 140);
      m.x = rand(w * 0.5, w);
      m.y = rand(-pad, h * 0.3);
      m.wait = rand(2.5, 7);
      break;
    case 'float':
      break;
  }
  if (m.kind === 'rain') {
    m.vy = rand(150, 220) * speed;
    m.vx = -m.vy * 0.15;
    if (!scatter) m.y = -pad;
  }
}

/** Her world's particles, drifting inside the card. Reduced motion: one still frame. */
function CardParticles(props: { layers: readonly ParticleLayer[]; light: boolean; reduce: boolean }): JSX.Element {
  const { layers, light, reduce } = props;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let { w, h, dpr } = sizeCanvas(canvas);
    const used = usableLayers(layers);
    const { perLayer, maxAmbient, cardScale } = noticeConfig;
    const motes: { mote: Mote; speed: number }[] = [];
    for (const layer of used) {
      const n = Math.min(perLayer.max, Math.max(perLayer.min, Math.round(layer.density * perLayer.perDensity)));
      for (let i = 0; i < n && motes.length < maxAmbient; i++) {
        const mote = makeMote(layer, cardScale, dpr);
        const speed = layer.speed ?? 1;
        respawnAmbient(mote, w, h, speed, true);
        motes.push({ mote, speed });
      }
    }

    let last = performance.now();
    let clock = 0;
    const paint = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const { mote: m } of motes) {
        const def = kinds[m.kind];
        const twinkle = def.motion === 'float' ? 0.65 + 0.35 * Math.sin(clock * 1.4 + m.phase) : 1;
        drawMote(ctx, m, clock, m.alpha * twinkle, light, def.motion === 'fall' || def.motion === 'rise');
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    const resize = new ResizeObserver(() => {
      ({ w, h, dpr } = sizeCanvas(canvas));
      for (const { mote, speed } of motes) respawnAmbient(mote, w, h, speed, true);
      paint();
    });
    resize.observe(canvas);

    if (reduce) {
      paint();
      return () => resize.disconnect();
    }

    let raf = 0;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(noticeConfig.maxDt, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      clock += dt;
      for (const { mote: m, speed } of motes) {
        const def = kinds[m.kind];
        m.rot += m.spin * dt;
        if (def.motion === 'float') {
          m.x += Math.cos(clock * 0.5 + m.phase) * 9 * speed * dt;
          m.y += Math.sin(clock * 0.4 + m.phase * 1.3) * 7 * speed * dt;
          if (m.x < -20) m.x = w + 20;
          if (m.x > w + 20) m.x = -20;
          if (m.y < -20) m.y = h + 20;
          if (m.y > h + 20) m.y = -20;
          continue;
        }
        if (m.kind === 'shootingStar') {
          m.wait -= dt;
          if (m.wait > 0) {
            m.alpha = 0;
            continue;
          }
          m.alpha = 0.9;
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          if (m.x < -40 || m.y > h + 40) respawnAmbient(m, w, h, speed, false);
          continue;
        }
        const sway = def.motion === 'fall' || def.motion === 'rise' ? Math.sin(clock * 0.9 + m.phase) * 12 : 0;
        m.x += (m.vx + sway) * dt;
        m.y += m.vy * dt;
        if (def.motion === 'cross') m.y += Math.sin(clock * 1.6 + m.phase) * 10 * dt;
        const out = m.y > h + 24 || m.y < -24 || m.x > w + 24 || m.x < -24;
        if (out) respawnAmbient(m, w, h, speed, false);
      }
      paint();
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
    };
  }, [layers, light, reduce]);

  return <canvas ref={ref} aria-hidden="true" data-slot="notice-particles" className="pointer-events-none absolute inset-0 size-full" />;
}

/** The burst: her particles fan out from the top centre of the frame, then fall away. */
function TopBurst(props: { layers: readonly ParticleLayer[]; light: boolean }): JSX.Element {
  const { layers, light } = props;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { w, h, dpr } = sizeCanvas(canvas);
    const used = usableLayers(layers).filter((l) => l.kind !== 'rain');
    const cfg = noticeConfig.burst;
    if (!used.length) return;
    const motes: Mote[] = [];
    for (let i = 0; i < cfg.count; i++) {
      const layer = used[i % used.length];
      const m = makeMote(layer, cfg.scale, dpr);
      const heading = rand(0.12, 0.88) * Math.PI; // a fan over the lower half circle
      const speed = rand(cfg.speed[0], cfg.speed[1]) * (layer.speed ?? 1);
      m.x = w / 2;
      m.y = 0;
      m.vx = Math.cos(heading) * speed;
      m.vy = Math.sin(heading) * speed;
      m.spin = rand(-cfg.spin, cfg.spin);
      m.life = rand(cfg.life[0], cfg.life[1]);
      motes.push(m);
    }

    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = Math.min(noticeConfig.maxDt, (now - last) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const m of motes) {
        m.age += dt;
        if (m.age >= m.life) continue;
        alive++;
        const drag = Math.exp(-cfg.drag * dt);
        m.vx *= drag;
        m.vy *= drag;
        const def = kinds[m.kind];
        m.vy += (def.motion === 'rise' ? -cfg.gravity : cfg.gravity) * dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.rot += m.spin * dt;
        const p = m.age / m.life;
        const alpha = m.alpha * Math.min(1, m.age / cfg.fadeIn) * (1 - p * p);
        drawMote(ctx, m, m.age, alpha, light, true);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (alive > 0) raf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [layers, light]);

  return <canvas ref={ref} aria-hidden="true" data-slot="notice-burst" className="pointer-events-none absolute inset-0 size-full" />;
}

/* ------------------------------------------------------------------- card */

function NoticeCard(props: { character: Character; reduce: boolean }): JSX.Element {
  const { character, reduce } = props;
  const { state, actions } = useApp();
  const present = useIsPresent();
  const id = character.id;
  const theme = getTheme(character.theme);
  const vars = herVars(character);
  const light = theme.scheme === 'light';

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const paused = hovered || focused || dragging;

  // About 6s, counted only while nothing holds it: a pause keeps what is left.
  const left = useRef<number>(noticeConfig.dismissMs);
  const dismiss = useCallback(() => actions.dismissNotice(id), [actions, id]);
  useEffect(() => {
    if (!present || paused) return;
    const startedAt = performance.now();
    const timer = window.setTimeout(dismiss, left.current);
    return () => {
      window.clearTimeout(timer);
      left.current = Math.max(0, left.current - (performance.now() - startedAt));
    };
  }, [present, paused, dismiss]);

  // Escape dismisses, unless a sheet or the drawer is open: that one takes the key.
  const covered = state.profileId !== null || state.drawerOpen;
  useEffect(() => {
    if (!present || covered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [present, covered, dismiss]);

  const onDragEnd = (_: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
    setDragging(false);
    if (info.offset.y < -noticeConfig.swipeDistance || info.velocity.y < -noticeConfig.swipeVelocity) dismiss();
  };

  const layers = theme.particles;

  return (
    <>
    <motion.div
      data-slot="match-notice"
      data-theme-id={character.theme}
      style={vars}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.6, bottom: 0.08 }}
      dragMomentum={false}
      onDragStart={() => setDragging(true)}
      onDragEnd={onDragEnd}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      initial={reduce ? { opacity: 0 } : { y: noticeConfig.hiddenY, opacity: 0 }}
      animate={
        reduce
          ? { opacity: 1, transition: { duration: dur.base, ease: ease.enter } }
          : { y: 0, opacity: 1, transition: { y: noticeConfig.drop, opacity: { duration: dur.quick, ease: ease.enter } } }
      }
      exit={
        reduce
          ? { opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }
          : { y: noticeConfig.hiddenY, opacity: 0, transition: { duration: dur.base, ease: ease.exit } }
      }
      className="pointer-events-auto relative overflow-hidden rounded-20 border border-hairline bg-canvas text-ink shadow-[inset_0_var(--glass-rim)_0_0_var(--glass-rim-top),var(--shadow-28)] select-none"
    >
      {/* Her scene plate, softly behind; a canvas-coloured wash keeps the type quiet. */}
      <img
        src={character.sceneSm}
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="async"
        className="pointer-events-none absolute inset-0 size-full object-cover"
        style={{ opacity: theme.sceneOpacity }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-linear-to-r from-canvas/90 to-canvas/60" />
      <CardParticles layers={layers} light={light} reduce={reduce} />

      <div className="relative flex items-center gap-16 p-16">
        <Avatar character={character} size="md" ring eager />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-title">{character.name}</p>
          <p className="truncate text-label text-muted">It&rsquo;s a match</p>
        </div>
        <button
          type="button"
          aria-label={`Chat with ${character.name}`}
          onClick={() => actions.openChat(id)}
          className="inline-flex h-[var(--target-touch)] shrink-0 items-center justify-center rounded-full bg-accent px-20 text-label text-on-accent transition-opacity duration-[var(--duration-150)] ease-standard active:opacity-80"
        >
          Chat
        </button>
      </div>
    </motion.div>
      {/* Above the card, so her particles fan out over it as it lands. */}
      {reduce ? null : <TopBurst layers={layers} light={light} />}
    </>
  );
}

export function MatchNotice(): JSX.Element {
  const { state } = useApp();
  const character = useCharacter(state.matchNotices[0] ?? null);
  const reduce = useReducedMotion();

  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="match-notice-layer"
      className="pointer-events-none absolute inset-x-0 top-0 z-40 h-1/3 px-[var(--gutter)] pt-[calc(var(--statusbar-h)+var(--spacing-12))]"
    >
      <AnimatePresence mode="wait">
        {character ? <NoticeCard key={character.id} character={character} reduce={reduce} /> : null}
      </AnimatePresence>
    </div>
  );
}
