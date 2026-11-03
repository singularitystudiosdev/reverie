/*
  The React side of the player. Nothing here owns a canvas or a GL context:
  renderer.ts has the one overlay canvas over [data-frame]. A component here
  renders a plain anchor element (the rect an effect belongs to), registers a
  sprite for it with the renderer, and unregisters on unmount.

    FxSurface  a full-frame (or any-rect) layer list: the intro plays once at
               zIndex 110, then the loop at 100 after its loopDelay, on ONE
               hidden video. Its anchor is an absolute box; the clip is drawn
               cover-fit into it.
    FxRing     the square avatar decoration around her circular avatar. Every
               ring of the same clip shares one video and one texture.
    useFxSprite  the shared glue, also used by FxWords.

  Offscreen anchors (IntersectionObserver) stop being drawn and stop keeping
  their video playing. The texture slot is released on unmount.
*/
import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import type { Character } from '../../data/types';
import './fx.css';
import {
  coverUv,
  cellUv,
  offsetInFrame,
  openEntry,
  openSharedEntry,
  uvAspect,
  type FxFrameCtx,
  type FxSprite,
  type FxStatus,
} from './renderer';
import type { FxLayer, FxQuad } from './types';
import { useCharacterFx } from './useCharacterFx';

export type { FxStatus } from './renderer';

export interface SpriteOptions {
  /** The element the sprite belongs to (also what is watched for visibility). */
  getAnchor: () => HTMLElement | null;
  /** Played in order on one video. */
  layers: readonly FxLayer[];
  /** One video and texture per clip, shared by every holder of the same src (rings, words). */
  shared?: boolean;
  /** The anchor moves under the sprite (sheet slides, avatar morphs): read its rect every pass. */
  live?: boolean;
  /** Hidden while a sheet is open over it. */
  base?: boolean;
  /** Fade the sprite out over this long when it unmounts (surfaces over a closing sheet). */
  fadeOutMs?: number;
  quads: (ctx: FxFrameCtx) => readonly FxQuad[];
  /** Runs once per ResizeObserver pass and when fonts settle: cache rects here, never per frame. */
  measure?: (anchor: HTMLElement) => void;
  onStatus?: (status: FxStatus) => void;
}

export function useFxSprite(options: SpriteOptions): void {
  const optRef = useRef(options);
  optRef.current = options;
  const key = `${options.shared ? 's' : 'o'}${options.live ? 'l' : ''}${options.base ? 'b' : ''}|${options.layers
    .map((l) => `${l.src}|${l.loop}|${l.duration}|${l.loopDelay ?? 0}|${l.zIndex ?? 0}|${l.cell?.join(',') ?? ''}`)
    .join('>')}`;

  useEffect(() => {
    const { getAnchor, layers, shared, live, base, fadeOutMs } = optRef.current;
    const anchor = getAnchor();
    const host = anchor?.closest<HTMLElement>('[data-frame]');
    const first = layers[0];
    if (!anchor || !host || !first) {
      optRef.current.onStatus?.('failed');
      return;
    }
    const entry = shared ? openSharedEntry(host, first) : openEntry(host, layers);
    if (!entry) {
      optRef.current.onStatus?.('failed');
      return;
    }
    const sprite: FxSprite = {
      visible: true,
      live: Boolean(live),
      base,
      quads: (ctx) => optRef.current.quads(ctx),
    };
    entry.addSprite(sprite);
    const offStatus = entry.onStatus((s) => optRef.current.onStatus?.(s));

    let cancelled = false;
    const measure = () => {
      optRef.current.measure?.(anchor);
      entry.invalidate();
    };
    const ro = new ResizeObserver(measure);
    ro.observe(anchor);
    const io = new IntersectionObserver((records) => {
      const last = records[records.length - 1];
      if (!last) return;
      sprite.visible = last.isIntersecting;
      entry.invalidate();
    });
    io.observe(anchor);
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });

    return () => {
      cancelled = true;
      ro.disconnect();
      io.disconnect();
      offStatus();
      entry.removeSprite(sprite);
      entry.dispose(fadeOutMs);
    };
  }, [key]);
}

export interface FxSurfaceProps {
  /** Played in order: each non-looping layer hands over to the next when it ends. */
  layers: readonly FxLayer[];
  className?: string;
  style?: CSSProperties;
  /** Fade over this long when unmounted. */
  fadeOutMs?: number;
  /** loading | playing | ended | failed. A failed surface should be replaced by the v5 fallback. */
  onStatus?: (status: FxStatus) => void;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A layer list drawn cover-fit into this box. Give it `absolute inset-0` (or any box) via className. */
export function FxSurface(props: FxSurfaceProps): JSX.Element {
  const { layers, className, style, fadeOutMs, onStatus } = props;
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef<Box | null>(null);
  const [played, setPlayed] = useState(false);
  const poster = layers[0]?.poster;

  useFxSprite({
    getAnchor: () => ref.current,
    layers,
    fadeOutMs,
    measure: (el) => {
      const o = offsetInFrame(el);
      box.current = o ? { x: o.x, y: o.y, w: el.offsetWidth, h: el.offsetHeight } : null;
    },
    quads: (ctx) => {
      const b = box.current;
      if (!b || b.w < 1 || b.h < 1) return [];
      const layer = ctx.layer;
      const cols = layer.cols ?? 1;
      const rows = layer.rows ?? 1;
      const [col, row] = layer.cell ?? [0, 0];
      const cell = cellUv(cols, rows, col, row, ctx.videoW, ctx.videoH);
      const uv = coverUv(cell, uvAspect(cell, ctx.videoW, ctx.videoH), b.w / b.h);
      return [{ x: b.x, y: b.y, w: b.w, h: b.h, uv }];
    },
    onStatus: (s) => {
      if (s === 'playing') setPlayed(true);
      onStatus?.(s);
    },
  });

  return (
    <div
      ref={ref}
      className={`fx-surface ${className ?? ''}`}
      style={{ ...style, zIndex: layers[0]?.zIndex }}
      aria-hidden="true"
    >
      {poster && !played ? <img className="fx-poster" src={poster} alt="" draggable={false} decoding="async" /> : null}
    </div>
  );
}

/**
 * The avatar decoration. Mount it inside a `relative` box that is exactly the
 * avatar; it paints a square ring slightly larger than the avatar with the
 * centre empty. Renders nothing when she has no ring clip (or it is missing).
 */
export function FxRing(props: { character: Pick<Character, 'id'> }): JSX.Element | null {
  const fx = useCharacterFx(props.character.id);
  const ring = fx.has.ring ? fx.fx?.ring : undefined;
  if (!ring) return null;
  return <RingSprite layer={ring} />;
}

function RingSprite(props: { layer: FxLayer }): JSX.Element {
  const { layer } = props;
  const ref = useRef<HTMLSpanElement>(null);

  useFxSprite({
    getAnchor: () => ref.current,
    layers: [layer],
    shared: true,
    live: true,
    base: true,
    quads: (ctx) => {
      const el = ref.current;
      if (!el) return [];
      const o = ctx.offsetOf(el);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w < 1 || h < 1) return [];
      const cell = cellUv(layer.cols ?? 1, layer.rows ?? 1, layer.cell?.[0] ?? 0, layer.cell?.[1] ?? 0, ctx.videoW, ctx.videoH);
      return [{ x: o.x, y: o.y, w, h, uv: coverUv(cell, uvAspect(cell, ctx.videoW, ctx.videoH), w / h) }];
    },
  });

  return <span ref={ref} className="fx-ring" aria-hidden="true" />;
}
