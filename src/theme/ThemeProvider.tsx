/*
  ThemeProvider: owns which world the frame shows. On a theme change (and
  only then) it writes the --t-* colours on [data-frame] (registered with
  @property in index.css, so CSS tweens them over the theme band) and
  --t-stage on <html>, and hands the new world to the Atmosphere.

  The RTPC calls (setParam, pulse, setPreview, burst) write into one mutable
  inputs object the atmosphere engine reads inside its own frame loop: no
  React state, no custom-property writes, cheap enough for every pointermove.

  Dev only: `?atmo=<themeId>` pins the frame to that world (setTheme calls
  are ignored) so every world can be screenshotted; `&affinity=<0..1>` pins
  the affinity too, and `&tier=<0..2>` pins the engine's quality tier.
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
import { characters } from '../data/characters';
import type { ParticleKind, ThemeColors, ThemeId } from '../data/types';
import { Atmosphere } from './Atmosphere';
import { createInputs, type AtmosphereInputs, type AtmosphereParam, type AtmospherePulse } from './rtpc';
import { getTheme, themes } from './themes';

export type { AtmosphereInputs, AtmosphereParam, AtmospherePulse } from './rtpc';

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

interface DevPin {
  themeId: ThemeId;
  sceneSrc: string | null;
  affinity: number | null;
  tier: number | null;
}

/** Dev-only URL pins (`?atmo=`, `&affinity=`, `&tier=`). Null in production builds. */
function readDevPin(): DevPin | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  const atmo = q.get('atmo');
  if (!atmo || !(atmo in themes)) return null;
  const id = atmo as ThemeId;
  const aff = q.get('affinity');
  const tier = q.get('tier');
  return {
    themeId: id,
    sceneSrc: characters.find((c) => c.theme === id)?.scene || null,
    affinity: aff !== null && Number.isFinite(Number(aff)) ? Math.min(1, Math.max(0, Number(aff))) : null,
    tier: tier !== null && Number.isInteger(Number(tier)) ? Number(tier) : null,
  };
}

export function ThemeProvider(props: { children: ReactNode }): JSX.Element {
  const pin = useMemo(readDevPin, []);
  const [state, setState] = useState<{ themeId: ThemeId; sceneSrc: string | null }>(() =>
    pin ? { themeId: pin.themeId, sceneSrc: pin.sceneSrc } : { themeId: 'base', sceneSrc: null }
  );
  const spec = getTheme(state.themeId);

  const inputs = useRef<AtmosphereInputs | null>(null);
  if (!inputs.current) {
    inputs.current = createInputs();
    if (pin) inputs.current.theme = { id: pin.themeId, sceneSrc: pin.sceneSrc };
    if (pin?.affinity != null) inputs.current.params.affinity = pin.affinity;
  }
  const io = inputs.current;

  // Stage colour around the phone (desktop) and the browser chrome colour (phone).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--t-stage', spec.colors.stage);
    root.style.colorScheme = spec.scheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', spec.colors.canvas);
  }, [spec]);

  // A new focus starts calm: setTheme zeroes typing and drag (callers set
  // their params AFTER setTheme); the first affinity set after it snaps.
  const setTheme = useCallback(
    (id: ThemeId, sceneSrc: string | null = null) => {
      if (pin) return;
      io.params.typing = 0;
      io.params.drag = 0;
      io.seq.theme++;
      io.theme = { id, sceneSrc };
      io.lastInputAt = performance.now();
      setState((prev) => (prev.themeId === id && prev.sceneSrc === sceneSrc ? prev : { themeId: id, sceneSrc }));
      io.wake();
    },
    [io, pin]
  );

  const burst = useCallback(
    (kind?: ParticleKind) => {
      io.bursts.push(kind ?? null);
      io.lastInputAt = performance.now();
      io.wake();
    },
    [io]
  );

  const setParam = useCallback(
    (name: AtmosphereParam, value: number) => {
      if (name === 'affinity') {
        if (pin?.affinity != null) return;
        io.seq.affinity++;
      }
      io.params[name] = Number.isFinite(value) ? value : 0;
      io.lastInputAt = performance.now();
      io.wake();
    },
    [io, pin]
  );

  const pulse = useCallback(
    (name: AtmospherePulse, strength = 1) => {
      const queue = io.pulses;
      const at = performance.now();
      queue.push({ name, strength, at });
      if (queue.length > 16) queue.shift();
      io.lastInputAt = at;
      io.wake();
    },
    [io]
  );

  const setPreview = useCallback(
    (id: ThemeId | null, sceneSrc: string | null = null, weight = 0) => {
      const p = io.preview;
      p.id = id;
      p.sceneSrc = id ? sceneSrc : null;
      p.weight = id && Number.isFinite(weight) ? weight : 0;
      io.lastInputAt = performance.now();
      io.wake();
    },
    [io]
  );

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

  // --t-* are written only when the theme changes; CSS transitions tween them.
  const vars = useMemo(() => frameVars(spec.colors, spec.scheme), [spec]);

  return (
    <FrameThemeContext.Provider value={value}>
      <div data-frame className="relative h-full w-full overflow-hidden" style={vars}>
        <Atmosphere spec={spec} sceneSrc={state.sceneSrc} inputs={io} tier={pin?.tier ?? null} />
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
