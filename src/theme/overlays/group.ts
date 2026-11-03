/*
  One world group: the DOM a world paints behind the particle canvas
  (RTPC-SPEC section 4). Built imperatively once per world and never touched
  again except `style.opacity` on the group and on its overlay wrappers:

    div.atm-world[data-world]         palette as inline --w-* props (written once)
      img.atm-plate                   her scene still: poster, fallback, slow CSS drift
      video.atm-plate-video           her looping scene over the still, mounted idle
                                      and only given a src while the engine says play
      div.atm-decor--<name> > i*      static world decor (Vesper's candles)
      div.atm-ov.atm-ov--<kind> > i*  one wrapper per OverlayKind: its opacity is
                                      response-driven; the ambient keyframes run
                                      on the CHILDREN, never on the wrapper

  The look of every overlay lives in src/styles/theme.css, authored at its
  peak; the response data drives the wrapper opacity.
*/
import { artSize, sceneLoopFor } from '../../data/characters';
import type { OverlayKind, ThemeId, ThemeSpec } from '../../data/types';
import { atmosphereTints } from '../themes';

/** Children per overlay wrapper: the CSS styles each child by position. */
const childCount: Record<OverlayKind, number> = {
  godrays: 5,
  fog: 2,
  vignette: 1,
  caustics: 2,
  scanlines: 2,
  aurora: 3,
  heat: 2,
  frostEdge: 5,
  grain: 1,
  moon: 2,
  lightning: 1,
  sunbeam: 2,
  glitch: 5,
  lanterns: 7,
};

/** Static decor some worlds carry on top of their overlays. */
const decor: Partial<Record<ThemeId, { name: string; children: number }[]>> = {
  crimson: [{ name: 'candles', children: 3 }],
};

export interface OverlayHandle {
  kind: OverlayKind;
  el: HTMLDivElement;
  /** Response-driven (has bindings): promoted, rewritten by the engine. */
  driven: boolean;
  written: number;
}

export interface WorldGroup {
  root: HTMLDivElement;
  plate: HTMLImageElement | null;
  overlays: OverlayHandle[];
  /** The plate has decoded (or there is none, or it failed). */
  ready: boolean;
  /** The world has a scene loop that has not failed (it may be released right now). */
  hasVideo: boolean;
  /**
   * Play (true) or pause and release (false) the scene loop. Idempotent; a
   * released loop holds no src, so it decodes nothing. No-op without a loop.
   */
  setPlaying(on: boolean): void;
  destroy(): void;
}

/** A loop that has not started playing this long after it was asked to is given up on. */
const LOOP_STALL_MS = 10000;

interface PlateVideo {
  el: HTMLVideoElement;
  setPlaying(on: boolean): void;
  dispose(): void;
}

/**
 * The scene loop over a still. Idle until asked: no src, nothing decoding. On
 * its first `playing` it fades in over the still, and once it is opaque the
 * still (and its drift) steps aside. On `error`, a rejected play() or a start
 * that never comes it removes itself and the still carries the world alone.
 */
function createPlateVideo(src: string, still: HTMLImageElement, onGone: () => void): PlateVideo {
  const el = document.createElement('video');
  el.className = 'atm-plate atm-plate-video';
  el.muted = true;
  el.defaultMuted = true;
  el.loop = true;
  el.autoplay = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.controls = false;
  el.disablePictureInPicture = true;
  el.disableRemotePlayback = true;
  el.tabIndex = -1;
  el.setAttribute('aria-hidden', 'true');
  el.draggable = false;

  let wanted = false;
  let gone = false;
  let watchdog = 0;

  const release = () => {
    window.clearTimeout(watchdog);
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.classList.remove('is-playing');
    still.classList.remove('is-covered');
  };
  const fail = () => {
    if (gone) return;
    gone = true;
    wanted = false;
    release();
    el.remove();
    onGone();
  };
  const onPlaying = () => {
    window.clearTimeout(watchdog);
    el.classList.add('is-playing');
  };
  const onFaded = (e: TransitionEvent) => {
    if (e.propertyName === 'opacity' && el.classList.contains('is-playing')) still.classList.add('is-covered');
  };
  const onError = () => {
    if (wanted) fail();
  };
  el.addEventListener('playing', onPlaying);
  el.addEventListener('transitionend', onFaded);
  el.addEventListener('error', onError);

  return {
    el,
    setPlaying(on) {
      if (gone || on === wanted) return;
      wanted = on;
      if (!on) {
        release();
        return;
      }
      el.src = src;
      watchdog = window.setTimeout(fail, LOOP_STALL_MS);
      el.play().catch((e: unknown) => {
        // pause() / load() interrupting a pending play() is a release, not a failure.
        if (wanted && !(e instanceof DOMException && e.name === 'AbortError')) fail();
      });
    },
    dispose() {
      gone = true;
      wanted = false;
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('transitionend', onFaded);
      el.removeEventListener('error', onError);
      release();
      el.remove();
    },
  };
}

function children(parent: HTMLElement, n: number): void {
  for (let i = 0; i < n; i++) parent.appendChild(document.createElement('i'));
}

/**
 * Build a world group. `rest`: the overlay opacity to show before the
 * engine's first write; `driven`: overlays the engine rewrites.
 */
export function createWorldGroup(
  spec: ThemeSpec,
  sceneSrc: string | null,
  rest: (kind: OverlayKind) => number,
  driven: (kind: OverlayKind) => boolean,
  onReady: () => void
): WorldGroup {
  const c = spec.colors;
  const t = atmosphereTints[spec.id];
  const root = document.createElement('div');
  root.className = 'atm-world';
  root.dataset.world = spec.id;
  root.dataset.scheme = spec.scheme;
  const vars: Record<string, string> = {
    '--w-canvas': c.canvas,
    '--w-canvas-2': c.canvas2,
    '--w-stage': c.stage,
    '--w-glow': c.glow,
    '--w-accent': c.accent,
    '--w-fog': t.fog,
    '--w-light': t.light,
    '--w-deep': t.deep,
    '--w-a1': t.a1,
    '--w-a2': t.a2,
    '--w-scene': String(spec.sceneOpacity),
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.opacity = '0';

  const group: WorldGroup = {
    root,
    plate: null,
    overlays: [],
    ready: false,
    hasVideo: false,
    setPlaying(on) {
      video?.setPlaying(on);
    },
    destroy() {
      video?.dispose();
      video = null;
      group.hasVideo = false;
      if (group.plate) {
        group.plate.onload = null;
        group.plate.onerror = null;
      }
      root.remove();
    },
  };
  let video: PlateVideo | null = null;

  const markReady = () => {
    if (group.ready) return;
    group.ready = true;
    onReady();
  };

  if (sceneSrc && spec.sceneOpacity > 0) {
    const img = document.createElement('img');
    img.className = 'atm-plate';
    img.alt = '';
    img.width = artSize.full.width;
    img.height = artSize.full.height;
    img.decoding = 'async';
    img.draggable = false;
    img.src = sceneSrc;
    group.plate = img;
    root.appendChild(img);
    // Never shown before decode finishes: the engine keeps the group at 0 until ready.
    img
      .decode()
      .then(() => {
        img.classList.add('is-ready');
        markReady();
      })
      .catch(() => {
        img.remove();
        group.plate = null;
        markReady();
      });
    // Her loop sits over the still; the engine decides when it runs.
    const loopSrc = sceneLoopFor(sceneSrc);
    if (loopSrc) {
      video = createPlateVideo(loopSrc, img, () => {
        video = null;
        group.hasVideo = false;
      });
      group.hasVideo = true;
      root.appendChild(video.el);
    }
  } else {
    queueMicrotask(markReady);
  }

  for (const d of decor[spec.id] ?? []) {
    const el = document.createElement('div');
    el.className = `atm-decor atm-decor--${d.name}`;
    children(el, d.children);
    root.appendChild(el);
  }

  for (const kind of spec.overlays) {
    const el = document.createElement('div');
    el.className = `atm-ov atm-ov--${kind}`;
    const isDriven = driven(kind);
    if (isDriven) el.dataset.driven = '';
    const v = rest(kind);
    el.style.opacity = v.toFixed(3);
    children(el, childCount[kind]);
    root.appendChild(el);
    group.overlays.push({ kind, el, driven: isDriven, written: v });
  }

  return group;
}
