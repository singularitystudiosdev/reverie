/*
  Swipe to dismiss, shared by the chats drawer (swipe LEFT) and the profile and
  gallery sheets (swipe DOWN).
  - A swipe may start anywhere in the window while the overlay is open: on the
    panel, on the scrim, or outside the 9:16 frame. The hook listens on window
    (pointerdown in the capture phase, then pointermove and pointerup), so the
    panel's own handlers never have to claim the press.
  - It engages after ENGAGE_PX of travel in the dismiss direction that also
    beats the cross axis, so a tap, a click on a control and a vertical scroll
    in the drawer list all pass through untouched. Presses on text fields
    never engage; a touch that starts inside a [data-swipe-scroll] region
    (a natively scrolling list) is left to the browser.
  - Once engaged the panel follows the finger 1:1 through a motion value (no
    React state per frame, no CSS variable). Movement the other way rubber
    bands by at most RUBBER_PX.
  - Release closes ONLY when the panel was dragged CLOSE_FRACTION of its size,
    or the pointer reached within EDGE_PX of the window edge (left for the
    drawer, bottom for the sheets). A fast flick does not close it. Anything
    else springs back open on spring.snappy.
  - The click that follows an engaged drag is swallowed, so a swipe that ends
    on a row, a tile or the scrim never counts as a tap.
  - Only the newest overlay that is listening reacts, so a sheet opened over
    another one is not dragged along with it.
*/
import { animate, useIsPresent, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { spring } from './motion';

export type SwipeDirection = 'left' | 'down';

/** Travel along the dismiss axis before a press becomes a drag. */
const ENGAGE_PX = 8;
/** The most the panel gives the wrong way. */
const RUBBER_PX = 6;
/** Share of the panel's size that closes it on release. */
const CLOSE_FRACTION = 0.6;
/** Distance from the window edge that closes it on release. */
const EDGE_PX = 24;
/** How long the click that ends a drag is swallowed. */
const CLICK_GUARD_MS = 60;

const IGNORE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-no-swipe]';

/** Overlays currently listening, oldest first; only the last one reacts. */
const listening: object[] = [];

/** A motion value reads as a number, or a percent or px string mid-entrance. */
function toPx(v: unknown, size: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isNaN(n)) return 0;
    return v.trim().endsWith('%') ? (n / 100) * size : n;
  }
  return 0;
}

interface Press {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  base: number;
  size: number;
  startedAtEdge: boolean;
  engaged: boolean;
}

export interface SwipeDismiss {
  /** Bind to the panel's `style` (`x` for left, `y` for down). */
  offset: MotionValue<number>;
  /** Bind to the scrim's `style.opacity`: 1 at rest, 0 when the panel is gone. */
  scrimOpacity: MotionValue<number>;
  /** True from the moment a swipe engages until the next press. Taps check it. */
  dragged: MutableRefObject<boolean>;
}

export function useSwipeDismiss(options: {
  direction: SwipeDirection;
  /** The panel that moves; its size is the distance to dismiss. */
  panel: RefObject<HTMLElement | null>;
  /**
   * Called when a release should close. Return false when the overlay stays
   * (the gallery's preview steps back to the grid): the panel springs back.
   */
  onDismiss(): boolean | void;
  enabled?: boolean;
}): SwipeDismiss {
  const { direction, panel, enabled = true } = options;
  const isPresent = useIsPresent();
  const live = enabled && isPresent;
  const offset = useMotionValue(0);
  const dragged = useRef(false);
  // True while a drag or its spring back is moving the panel, so the scrim
  // follows only that and not the entrance or exit animation.
  const tracking = useRef(false);
  const onDismiss = useRef(options.onDismiss);
  onDismiss.current = options.onDismiss;

  const sizeOf = (): number => {
    const el = panel.current;
    if (!el) return 0;
    return direction === 'left' ? el.offsetWidth : el.offsetHeight;
  };

  const scrimOpacity = useTransform(offset, (v: number | string) => {
    if (!tracking.current) return 1;
    const size = sizeOf();
    if (!size) return 1;
    const travelled = direction === 'left' ? -toPx(v, size) : toPx(v, size);
    return Math.min(1, Math.max(0, 1 - travelled / size));
  });

  useEffect(() => {
    if (!live) return;
    const token = {};
    listening.push(token);
    let press: Press | null = null;
    const sign = direction === 'left' ? -1 : 1;

    const along = (dx: number, dy: number) => (direction === 'left' ? dx : dy);
    const across = (dx: number, dy: number) => (direction === 'left' ? dy : dx);

    const swallowClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };

    const springBack = () => {
      tracking.current = true;
      void animate(offset, 0, {
        ...spring.snappy,
        onComplete: () => {
          tracking.current = false;
        },
      });
    };

    const endPress = (cancelled: boolean, x: number, y: number) => {
      const p = press;
      press = null;
      if (!p || !p.engaged) return;
      document.documentElement.style.userSelect = '';
      window.addEventListener('click', swallowClick, true);
      window.setTimeout(() => window.removeEventListener('click', swallowClick, true), CLICK_GUARD_MS);

      const travelled = sign * toPx(offset.get(), p.size);
      const atEdge = !p.startedAtEdge && (direction === 'left' ? x <= EDGE_PX : window.innerHeight - y <= EDGE_PX);
      const far = travelled >= p.size * CLOSE_FRACTION;
      if (!cancelled && (far || atEdge)) {
        if (onDismiss.current() !== false) return;
      }
      springBack();
    };

    const onDown = (e: PointerEvent) => {
      if (listening[listening.length - 1] !== token) return;
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(IGNORE)) return;
      if (e.pointerType !== 'mouse' && target?.closest('[data-swipe-scroll]')) return;
      const size = sizeOf();
      if (!size) return;
      dragged.current = false;
      press = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        base: toPx(offset.get(), size),
        size,
        startedAtEdge: direction === 'left' ? e.clientX <= EDGE_PX : window.innerHeight - e.clientY <= EDGE_PX,
        engaged: false,
      };
    };

    const onMove = (e: PointerEvent) => {
      const p = press;
      if (!p || e.pointerId !== p.id) return;
      p.x = e.clientX;
      p.y = e.clientY;
      const dx = e.clientX - p.x0;
      const dy = e.clientY - p.y0;
      if (!p.engaged) {
        const main = sign * along(dx, dy);
        const cross = Math.abs(across(dx, dy));
        if (Math.max(Math.abs(main), cross) < ENGAGE_PX) return;
        // Not this swipe: it went the other way or across (a scroll). Let it be.
        if (main < ENGAGE_PX || main <= cross) {
          press = null;
          return;
        }
        p.engaged = true;
        dragged.current = true;
        tracking.current = true;
        offset.stop();
        document.documentElement.style.userSelect = 'none';
      }
      // Distance toward dismissal; negative means the wrong way (rubber band).
      const d = sign * (p.base + along(dx, dy));
      const clamped = d < 0 ? -Math.min(RUBBER_PX, -d * 0.25) : Math.min(d, p.size);
      offset.set(sign * clamped);
    };

    const onUp = (e: PointerEvent) => {
      if (press && e.pointerId === press.id) endPress(e.type === 'pointercancel', e.clientX, e.clientY);
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      if (press?.engaged) document.documentElement.style.userSelect = '';
      const at = listening.indexOf(token);
      if (at >= 0) listening.splice(at, 1);
    };
    // sizeOf reads the panel ref and the direction, both covered here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, direction, offset, panel]);

  return { offset, scrimOpacity, dragged };
}
