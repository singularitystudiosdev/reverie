/*
  One world group: the DOM a world paints behind the particle canvas
  (RTPC-SPEC section 4). Built imperatively once per world and never touched
  again except `style.opacity` on the group and on its overlay wrappers:

    div.atm-world[data-world]         palette as inline --w-* props (written once)
      img.atm-plate                   her scene plate, slow CSS drift
      div.atm-decor--<name> > i*      static world decor (Vesper's candles)
      div.atm-ov.atm-ov--<kind> > i*  one wrapper per OverlayKind: its opacity is
                                      response-driven; the ambient keyframes run
                                      on the CHILDREN, never on the wrapper

  The look of every overlay lives in src/styles/theme.css, authored at its
  peak; the response data drives the wrapper opacity.
*/
import { artSize } from '../../data/characters';
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
  destroy(): void;
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
    destroy() {
      if (group.plate) {
        group.plate.onload = null;
        group.plate.onerror = null;
      }
      root.remove();
    },
  };

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
