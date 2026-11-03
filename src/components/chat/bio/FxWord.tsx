/*
  FxWord: the shared frame of every word effect. The tagged phrase is real
  text in an inline-block wrapper (position: relative, nowrap) so the
  particles can be placed against it without moving a single line; the
  particle layer is aria-hidden, sits BEHIND the paragraph's text
  (z-index: -1 inside the bio's own stacking context) and ignores the pointer.
  Reduced motion hides the layer and the overlays in bio.css; the word keeps
  a static accent colour.
*/
import type { CSSProperties, JSX, ReactNode } from 'react';

/** Inline custom properties for a particle (--x, --y, --d ...). */
export function v(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

export function FxWord(props: { kind: string; text: string; children?: ReactNode }): JSX.Element {
  const { kind, text, children } = props;
  return (
    <span className="fx" data-fx={kind} style={v({ '--fx-n': text.length })}>
      <span className="fx-text" data-w={text}>
        {text}
      </span>
      {children ? (
        <span className="fx-layer" aria-hidden="true">
          {children}
        </span>
      ) : null}
    </span>
  );
}

export interface FxProps {
  text: string;
}
