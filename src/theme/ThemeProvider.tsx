/*
  ThemeProvider: owns which world the frame shows. It writes the --t-* colors
  on [data-frame] (registered with @property in index.css, so they tween) and
  --t-stage on <html>, and renders the Atmosphere behind the UI.
  Scaffold version: the theme unit rewrites this file. The contract below is
  fixed: screens build against it.
*/
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';
import type { ParticleKind, ThemeColors, ThemeId } from '../data/types';
import { Atmosphere } from './Atmosphere';
import { getTheme } from './themes';

/** Continuous inputs the atmosphere engine reads in its own frame loop. */
export type AtmosphereParam = 'typing' | 'drag' | 'affinity';
/** One-shot impulses the atmosphere engine reacts to. */
export type AtmospherePulse = 'gust' | 'bloom';

export interface FrameTheme {
  themeId: ThemeId;
  sceneSrc: string | null;
  setTheme(id: ThemeId, sceneSrc?: string | null): void;
  burst(kind?: ParticleKind): void;
  /** typing 0|1, drag -1..1, affinity 0..1. Cheap per pointermove: writes a ref only. */
  setParam(name: AtmosphereParam, value: number): void;
  /** gust (send, card fly-off) or bloom (reply lands), strength 0..1 (default 1). */
  pulse(name: AtmospherePulse, strength?: number): void;
  /** The next world under the finger while dragging (weight 0..1); null clears it. */
  setPreview(id: ThemeId | null, sceneSrc?: string | null, weight?: number): void;
}

/** What the engine reads each frame. Mutated in place, never React state. */
export interface AtmosphereInputs {
  params: Record<AtmosphereParam, number>;
  pulses: { name: AtmospherePulse; strength: number; at: number }[];
  preview: { id: ThemeId | null; sceneSrc: string | null; weight: number };
}

const FrameThemeContext = createContext<FrameTheme | null>(null);

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

function frameVars(colors: ThemeColors, scheme: 'light' | 'dark'): CSSProperties {
  const style: Record<string, string> = { colorScheme: scheme };
  for (const [slot, name] of Object.entries(slotVars)) {
    style[name] = colors[slot as keyof typeof slotVars];
  }
  return style as CSSProperties;
}

export function ThemeProvider(props: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<{ themeId: ThemeId; sceneSrc: string | null }>({
    themeId: 'base',
    sceneSrc: null,
  });
  const spec = getTheme(state.themeId);

  const inputs = useRef<AtmosphereInputs>({
    params: { typing: 0, drag: 0, affinity: 0 },
    pulses: [],
    preview: { id: null, sceneSrc: null, weight: 0 },
  });

  // Stage color around the phone (desktop) and the browser chrome color (phone).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--t-stage', spec.colors.stage);
    root.style.colorScheme = spec.scheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', spec.colors.canvas);
  }, [spec]);

  // A new focus starts calm: setTheme zeroes typing and drag (callers set
  // their params AFTER setTheme).
  const setTheme = useCallback((id: ThemeId, sceneSrc: string | null = null) => {
    inputs.current.params.typing = 0;
    inputs.current.params.drag = 0;
    setState((prev) =>
      prev.themeId === id && prev.sceneSrc === sceneSrc ? prev : { themeId: id, sceneSrc }
    );
  }, []);

  // Scaffold: the theme unit implements the particle burst.
  const burst = useCallback((kind?: ParticleKind) => {
    void kind;
  }, []);

  const setParam = useCallback((name: AtmosphereParam, value: number) => {
    inputs.current.params[name] = value;
  }, []);

  const pulse = useCallback((name: AtmospherePulse, strength = 1) => {
    const queue = inputs.current.pulses;
    queue.push({ name, strength, at: performance.now() });
    if (queue.length > 16) queue.shift();
  }, []);

  const setPreview = useCallback((id: ThemeId | null, sceneSrc: string | null = null, weight = 0) => {
    const p = inputs.current.preview;
    p.id = id;
    p.sceneSrc = id ? sceneSrc : null;
    p.weight = id ? weight : 0;
  }, []);

  const value = useMemo<FrameTheme>(
    () => ({
      themeId: state.themeId,
      sceneSrc: state.sceneSrc,
      setTheme,
      burst,
      setParam,
      pulse,
      setPreview,
    }),
    [state.themeId, state.sceneSrc, setTheme, burst, setParam, pulse, setPreview]
  );

  return (
    <FrameThemeContext.Provider value={value}>
      <div
        data-frame
        className="relative h-full w-full overflow-hidden"
        style={frameVars(spec.colors, spec.scheme)}
      >
        <Atmosphere spec={spec} sceneSrc={state.sceneSrc} />
        <div className="relative isolate h-full w-full">{props.children}</div>
      </div>
    </FrameThemeContext.Provider>
  );
}

export function useFrameTheme(): FrameTheme {
  const ctx = useContext(FrameThemeContext);
  if (!ctx) throw new Error('useFrameTheme() must be used inside <ThemeProvider>');
  return ctx;
}
