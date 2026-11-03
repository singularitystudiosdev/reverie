/*
  The refraction filters behind .liquid-glass (glass.css).

  Each pane gets its own filter, generated at runtime from that pane's measured
  geometry by src/components/glass/engine.ts. This component only owns the one
  hidden <svg> those filters live in, and starts the engine after mount. The
  zero-size, absolutely positioned svg is not display:none: a display:none
  <svg> drops its filters.

  #lg-refract is the identity probe the @supports test in glass.css names, and
  the safe fallback if an attribute is ever set without its filter. It is not
  the material: the real filters are #lg-refract-<n>.
*/
import { useEffect, useRef, type JSX } from 'react';
import { startGlassEngine } from './glass/engine';

export function LiquidGlassDefs(): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const defs = svgRef.current?.querySelector('defs');
    if (!defs) return;
    return startGlassEngine(defs);
  }, []);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      className="pointer-events-none absolute size-0 overflow-hidden"
    >
      <defs>
        <filter id="lg-refract" x="0%" y="0%" width="100%" height="100%">
          <feOffset in="SourceGraphic" dx="0" dy="0" />
        </filter>
      </defs>
    </svg>
  );
}
