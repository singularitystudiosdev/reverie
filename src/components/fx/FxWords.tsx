/*
  FxWords: the word atlas overlay for a paragraph. Mount it as a child of the
  <p> that holds the tagged words (`<span data-w="closer">`). It renders only a
  hidden marker; the paragraph itself is the anchor.

  - Measure ONCE per ResizeObserver pass (and when fonts settle) into a ref:
    each tagged word's box in paragraph-local layout pixels (offsetLeft/Top/
    Width/Height: no transforms, no per-frame reads, no CSS custom properties).
  - Draw: every pass, each word's atlas cell is drawn from the SAME single
    video texture (one upload, N sprites, one instanced draw call), at the
    word's rect: the paragraph's own position (live, because the sheet slides
    and scrolls) plus the word's measured offset.
  - A cell keeps its own aspect and is centred on the word, never squashed
    into a line of text. It is drawn `scale` line heights tall (default 3) and
    at least wide enough to cover the word; the cell's `gutter` is trimmed.
*/
import { useRef, type JSX } from 'react';
import './fx.css';
import { cellUv, uvAspect, type FxStatus } from './renderer';
import { useFxSprite } from './FxSurface';
import type { FxQuad, FxWordsLayer } from './types';

interface WordBox {
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_SCALE = 3;
/** The cell is at least this much wider than the word it sits on. */
const MIN_COVER = 1.2;

export interface FxWordsProps {
  layer: FxWordsLayer;
  onStatus?: (status: FxStatus) => void;
}

export function FxWords(props: FxWordsProps): JSX.Element {
  const { layer, onStatus } = props;
  const marker = useRef<HTMLSpanElement>(null);
  const words = useRef<readonly WordBox[]>([]);

  useFxSprite({
    getAnchor: () => marker.current?.parentElement ?? null,
    layers: [layer],
    shared: true,
    live: true,
    measure: (p) => {
      const found: WordBox[] = [];
      for (const el of p.querySelectorAll<HTMLElement>('[data-w]')) {
        const cell = layer.cells[el.dataset.w ?? ''];
        if (!cell) continue;
        found.push({ col: cell[0], row: cell[1], x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
      }
      words.current = found;
    },
    quads: (ctx) => {
      const p = marker.current?.parentElement;
      const list = words.current;
      if (!p || list.length === 0) return [];
      const o = ctx.offsetOf(p);
      const scale = layer.scale ?? DEFAULT_SCALE;
      const out: FxQuad[] = [];
      for (const b of list) {
        const uv = cellUv(layer.cols, layer.rows, b.col, b.row, ctx.videoW, ctx.videoH, layer.gutter);
        const aspect = uvAspect(uv, ctx.videoW, ctx.videoH);
        const h = Math.max(scale * b.h, (b.w * MIN_COVER) / aspect);
        const w = h * aspect;
        out.push({ x: o.x + b.x + b.w / 2 - w / 2, y: o.y + b.y + b.h / 2 - h / 2, w, h, uv });
      }
      return out;
    },
    onStatus,
  });

  return <span ref={marker} hidden aria-hidden="true" />;
}
