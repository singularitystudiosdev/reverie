/*
  Atmosphere: the full-frame living background behind the UI. React renders
  only the container and the one particle canvas; the engine
  (particles/engine.ts) builds each world's group (gradient, scene plate with
  its slow drift, light overlays) imperatively inside `.atm`, before the
  canvas, and runs the frame loop: theme crossfades over the theme band, the
  preview world under the finger, bursts, and the RTPC responses.

  Reduced motion: the engine draws one still frame and stops; the plate and
  overlays stop animating (theme.css); a theme change swaps within 150ms.
*/
import { useEffect, useRef, type JSX } from 'react';
import type { ThemeSpec } from '../data/types';
import { AtmosphereEngine } from './particles/engine';
import type { AtmosphereInputs } from './rtpc';

declare global {
  interface Window {
    /** Dev only: the engine's frame timings, for the performance proof. */
    __atmo?: AtmosphereEngine['perfData'];
  }
}

export function Atmosphere(props: {
  spec: ThemeSpec;
  sceneSrc: string | null;
  inputs: AtmosphereInputs;
  /** Dev pin for the quality tier (null: adaptive). */
  tier?: number | null;
}): JSX.Element {
  const { spec, sceneSrc, inputs, tier = null } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AtmosphereEngine | null>(null);
  // The world the engine should show; read by the mount effect without re-running it.
  const latest = useRef({ spec, sceneSrc });
  latest.current = { spec, sceneSrc };

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const engine = new AtmosphereEngine(root, canvas, inputs, { perf: import.meta.env.DEV, tier });
    engineRef.current = engine;
    engine.setWorld(latest.current.spec, latest.current.sceneSrc);
    if (import.meta.env.DEV) {
      window.__atmo = engine.perfData;
      (window as unknown as { __atmoEngine?: AtmosphereEngine }).__atmoEngine = engine;
    }
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [inputs, tier]);

  useEffect(() => {
    engineRef.current?.setWorld(spec, sceneSrc);
  }, [spec, sceneSrc]);

  return (
    <div ref={rootRef} aria-hidden="true" className="atm">
      <canvas ref={canvasRef} className="atm-canvas" />
    </div>
  );
}
