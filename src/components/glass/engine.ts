/*
  engine.ts: keeps one generated refraction filter per .liquid-glass pane, and
  drives the pane's motion.

  Why an engine: the map is the pane's own geometry, and the class API is fixed
  (TabBar, ChatHeader and Explore all wear .liquid-glass without knowing about
  filters). A document-level controller measures each pane, draws its map,
  installs its filter in the shared <defs>, and points the pane at it with
  --glass-refract plus data-glass-refract. glass.css only switches to the
  refracting chain for panes that carry that attribute, so a pane whose profile
  cannot be read stays on the plain blur fallback.

  Motion: --glass-x / --glass-y are the public axis. A press sets them toward
  the pointer; the tab-bar lens sliding sets them toward the direction of
  travel. The engine mirrors them into the filter's feOffset, which moves the
  whole field: the bend, and the uniform rim ring, which comes to rest just
  inside the leading edge. Reduced motion: the axes stay at 0px.

  Interaction constants below are motion-simulation values, not design values
  (the same exception BRIEF.md makes for particle physics and lib/motion.ts).
*/

import { buildDisplacementMap, measureGlass, readGlassOptics, type GlassOptics } from './geometry';
import { createGlassFilter, type GlassFilterHandle } from './filter';

/** How much of the remaining distance each frame of the press/settle covers. */
const SHIFT_EASE = 0.28;
/** Below this many px the shift snaps to its target. */
const SHIFT_EPSILON = 0.01;
/** Lens velocity (px/frame) to shift (px). */
const LENS_GAIN = 0.45;
/** How long after the lens stops moving its shift settles back to zero. */
const LENS_HOLD_MS = 110;
/** Resize changes are coalesced over this long before the map is redrawn. */
const RESIZE_DEBOUNCE_MS = 120;

interface Entry {
  element: HTMLElement;
  optics: GlassOptics;
  width: number;
  height: number;
  filter: GlassFilterHandle;
  resizeObserver: ResizeObserver;
  lensObserver: MutationObserver | null;
  lensElement: HTMLElement | null;
  lensFrames: () => void;
  resizeTimer: number | null;
  lensLastX: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True in the engines that paint a reference filter behind an element. */
function referenceBackdropsSupported(): boolean {
  // The same condition as the @supports block in glass.css. WebKit accepts the
  // grammar and then paints nothing (WebKit bug 245510), so it is excluded by
  // its -webkit-hyphens support; Chromium is the engine verified to render it.
  return (
    typeof CSS !== 'undefined' &&
    CSS.supports('backdrop-filter', 'url(#lg-refract)') &&
    !CSS.supports('-webkit-hyphens', 'none')
  );
}

/** The translation an element's computed transform carries, in CSS px. */
function transformX(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none') return 0;
  try {
    return new DOMMatrixReadOnly(transform).m41;
  } catch {
    return 0;
  }
}

export function startGlassEngine(defs: SVGElement): () => void {
  if (!referenceBackdropsSupported()) return () => {};

  const entries = new Map<HTMLElement, Entry>();
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const transparencyQuery = window.matchMedia('(prefers-reduced-transparency: reduce)');
  let reduce = reduceQuery.matches;
  let disposed = false;
  let uid = 0;
  let refreshFrame = 0;

  let motionElement: HTMLElement | null = null;
  let pressed: HTMLElement | null = null;
  let motionFrame = 0;
  let currentX = 0;
  let currentY = 0;
  let targetX = 0;
  let targetY = 0;
  let leadTimer: number | null = null;

  const clearShift = (element: HTMLElement): void => {
    const entry = entries.get(element);
    entry?.filter.setShift(0, 0);
    element.style.removeProperty('--glass-x');
    element.style.removeProperty('--glass-y');
  };

  const resetMotion = (): void => {
    if (motionFrame) cancelAnimationFrame(motionFrame);
    motionFrame = 0;
    if (leadTimer !== null) window.clearTimeout(leadTimer);
    leadTimer = null;
    if (motionElement) clearShift(motionElement);
    motionElement = null;
    pressed = null;
    currentX = 0;
    currentY = 0;
    targetX = 0;
    targetY = 0;
  };

  const applyShift = (entry: Entry, x: number, y: number): void => {
    entry.filter.setShift(x, y);
    entry.element.style.setProperty('--glass-x', `${x.toFixed(2)}px`);
    entry.element.style.setProperty('--glass-y', `${y.toFixed(2)}px`);
  };

  const step = (): void => {
    motionFrame = 0;
    const element = motionElement;
    if (!element) return;
    const entry = entries.get(element);
    if (!entry) {
      motionElement = null;
      return;
    }
    currentX += (targetX - currentX) * SHIFT_EASE;
    currentY += (targetY - currentY) * SHIFT_EASE;
    if (Math.abs(targetX - currentX) < SHIFT_EPSILON) currentX = targetX;
    if (Math.abs(targetY - currentY) < SHIFT_EPSILON) currentY = targetY;
    if (currentX === 0 && currentY === 0 && targetX === 0 && targetY === 0) {
      clearShift(element);
      return;
    }
    applyShift(entry, currentX, currentY);
    motionFrame = requestAnimationFrame(step);
  };

  const pointMotionAt = (element: HTMLElement, x: number, y: number): void => {
    if (motionElement && motionElement !== element) clearShift(motionElement);
    motionElement = element;
    targetX = x;
    targetY = y;
    if (!motionFrame) motionFrame = requestAnimationFrame(step);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (reduce || transparencyQuery.matches) return;
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const element = origin.closest<HTMLElement>('.liquid-glass');
    if (!element) return;
    const entry = entries.get(element);
    if (!entry) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pressed = element;
    const nx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const ny = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    pointMotionAt(
      element,
      clamp(nx, -1, 1) * entry.optics.shift,
      clamp(ny, -1, 1) * entry.optics.shift,
    );
  };

  const onPointerRelease = (): void => {
    if (!pressed) return;
    pressed = null;
    if (motionElement) pointMotionAt(motionElement, 0, 0);
  };

  const watchLens = (entry: Entry): void => {
    const lens = entry.element.querySelector<HTMLElement>('.liquid-glass-lens');
    if (lens === entry.lensElement) return;
    entry.lensObserver?.disconnect();
    entry.lensObserver = null;
    entry.lensFrames();
    entry.lensElement = lens;
    if (!lens) return;
    entry.lensLastX = transformX(lens);
    // The slide itself is a compositor animation (motion animates the lens's
    // transform through the Web Animations API), so the style attribute jumps
    // to its end value in one write. Sample the *computed* transform for as
    // long as the animation is running: that is the only place the per-frame
    // travel is visible, and it costs one style read per frame of the slide.
    let lensFrame = 0;
    const sampleLens = (): void => {
      lensFrame = 0;
      if (reduce || pressed || transparencyQuery.matches) return;
      const x = transformX(lens);
      const delta = x - entry.lensLastX;
      entry.lensLastX = x;
      if (Math.abs(delta) >= 0.05) {
        const amount = Math.min(entry.optics.shift, Math.abs(delta) * LENS_GAIN);
        if (leadTimer !== null) window.clearTimeout(leadTimer);
        leadTimer = window.setTimeout(() => {
          leadTimer = null;
          if (motionElement) pointMotionAt(motionElement, 0, 0);
        }, LENS_HOLD_MS);
        pointMotionAt(entry.element, amount * Math.sign(delta), 0);
      }
      if (lens.getAnimations().some((animation) => animation.playState === 'running')) {
        lensFrame = requestAnimationFrame(sampleLens);
      }
    };
    const observer = new MutationObserver(() => {
      if (reduce || pressed || transparencyQuery.matches) return;
      if (!lensFrame) lensFrame = requestAnimationFrame(sampleLens);
    });
    observer.observe(lens, { attributes: true, attributeFilter: ['style'] });
    entry.lensObserver = observer;
    entry.lensFrames = () => {
      if (lensFrame) cancelAnimationFrame(lensFrame);
      lensFrame = 0;
    };
  };

  const build = (element: HTMLElement): Entry | null => {
    const geometry = measureGlass(element);
    const optics = readGlassOptics(element);
    if (!geometry || !optics) return null;
    const map = buildDisplacementMap(geometry, optics);
    if (!map) return null;
    const filter = createGlassFilter(
      defs,
      `lg-refract-${++uid}`,
      geometry,
      optics,
      map.url,
      map.depth,
    );
    const entry: Entry = {
      element,
      optics,
      width: geometry.width,
      height: geometry.height,
      filter,
      resizeObserver: new ResizeObserver(() => {
        if (entry.resizeTimer !== null) window.clearTimeout(entry.resizeTimer);
        entry.resizeTimer = window.setTimeout(() => {
          entry.resizeTimer = null;
          rebuild(entry);
        }, RESIZE_DEBOUNCE_MS);
      }),
      lensObserver: null,
      lensElement: null,
      lensFrames: () => {},
      resizeTimer: null,
      lensLastX: 0,
    };
    entry.resizeObserver.observe(element);
    watchLens(entry);
    element.style.setProperty('--glass-refract', `url(#${filter.id})`);
    element.dataset.glassRefract = '';
    return entry;
  };

  const rebuild = (entry: Entry): void => {
    if (disposed || !entry.element.isConnected) return;
    const geometry = measureGlass(entry.element);
    if (!geometry) {
      drop(entry);
      return;
    }
    if (geometry.width === entry.width && geometry.height === entry.height) return;
    const map = buildDisplacementMap(geometry, entry.optics);
    if (!map) {
      drop(entry);
      return;
    }
    const id = entry.filter.id;
    entry.filter.destroy();
    entry.filter = createGlassFilter(
      defs,
      id,
      geometry,
      entry.optics,
      map.url,
      map.depth,
    );
    entry.width = geometry.width;
    entry.height = geometry.height;
  };

  const drop = (entry: Entry): void => {
    entry.resizeObserver.disconnect();
    entry.lensObserver?.disconnect();
    entry.lensFrames();
    if (entry.resizeTimer !== null) window.clearTimeout(entry.resizeTimer);
    entry.filter.destroy();
    entry.element.removeAttribute('data-glass-refract');
    entry.element.style.removeProperty('--glass-refract');
    if (entries.get(entry.element) === entry) entries.delete(entry.element);
    if (motionElement === entry.element) resetMotion();
  };

  const refresh = (): void => {
    if (disposed) return;
    const elements = new Set(document.querySelectorAll<HTMLElement>('.liquid-glass'));
    for (const [element, entry] of entries) {
      if (!elements.has(element)) drop(entry);
    }
    if (transparencyQuery.matches) return;
    for (const element of elements) {
      const entry = entries.get(element);
      if (entry) {
        // The tab lens mounts after the pane does; pick it up when it appears.
        watchLens(entry);
        continue;
      }
      const built = build(element);
      if (built) entries.set(element, built);
    }
  };

  const scheduleRefresh = (): void => {
    if (disposed || refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      refresh();
    });
  };

  const domObserver = new MutationObserver(scheduleRefresh);
  domObserver.observe(document.body, { childList: true, subtree: true });

  const onMotionPreference = (): void => {
    reduce = reduceQuery.matches;
    if (reduce) resetMotion();
  };

  const onTransparencyPreference = (): void => {
    if (transparencyQuery.matches) {
      for (const entry of [...entries.values()]) drop(entry);
    } else {
      scheduleRefresh();
    }
  };

  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointerup', onPointerRelease, { passive: true });
  document.addEventListener('pointercancel', onPointerRelease, { passive: true });
  reduceQuery.addEventListener('change', onMotionPreference);
  transparencyQuery.addEventListener('change', onTransparencyPreference);

  refresh();

  return (): void => {
    disposed = true;
    domObserver.disconnect();
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointerup', onPointerRelease);
    document.removeEventListener('pointercancel', onPointerRelease);
    reduceQuery.removeEventListener('change', onMotionPreference);
    transparencyQuery.removeEventListener('change', onTransparencyPreference);
    if (refreshFrame) cancelAnimationFrame(refreshFrame);
    resetMotion();
    for (const entry of [...entries.values()]) drop(entry);
    entries.clear();
  };
}
