/*
  useCharacterFx: finds a character's rendered-FX config and says which of its
  clips actually exist.

  Each character unit adds ONE file, characters/<id>.ts, whose default export is
  a CharacterFx (usually `defineCharacterFx(...)`); import.meta.glob finds it
  and nothing else changes. A missing config, a missing clip, a server that
  answers a clip URL with the app shell, or a browser without WebGL2 all leave
  `has.<clip>` false, and the caller keeps v5's CSS effect. Harmless by
  construction: this hook never throws and never renders.
*/
import { useEffect, useReducer } from 'react';
import type { CharacterFx, FxClip } from './types';

const MODULES = import.meta.glob('./characters/*.ts', { eager: true }) as Record<string, { default?: CharacterFx }>;

const CONFIGS = new Map<string, CharacterFx>();
for (const [path, mod] of Object.entries(MODULES)) {
  const fx = mod.default;
  if (fx) CONFIGS.set(fx.id || path.replace(/^.*\/(.+)\.ts$/, '$1'), fx);
}

export type FxHas = Record<FxClip, boolean>;
const NONE: FxHas = { intro: false, loop: false, frame: false, ring: false, words: false };

export interface CharacterFxState {
  /** Her config, or null when she has none. */
  fx: CharacterFx | null;
  /** 'none': no config. 'pending': probing the clips. 'ready': `has` is final. */
  status: 'none' | 'pending' | 'ready';
  /** Per clip: configured AND the file is really there. */
  has: FxHas;
}

const CLIPS: readonly FxClip[] = ['intro', 'loop', 'frame', 'ring', 'words'];
const probes = new Map<string, Promise<boolean>>();
const known = new Map<string, boolean>();

/** True when the URL answers with a media file (not a 404, not the SPA's index.html). */
function probe(src: string): Promise<boolean> {
  let p = probes.get(src);
  if (!p) {
    p = fetch(src, { method: 'HEAD' })
      .then((res) => res.ok && !/text\/html/i.test(res.headers.get('content-type') ?? ''))
      .catch(() => false)
      .then((ok) => {
        known.set(src, ok);
        return ok;
      });
    probes.set(src, p);
  }
  return p;
}

function srcOf(fx: CharacterFx, clip: FxClip): string | null {
  return fx[clip]?.src ?? null;
}

function snapshot(fx: CharacterFx): CharacterFxState {
  const has = { ...NONE };
  let pending = false;
  for (const clip of CLIPS) {
    const src = srcOf(fx, clip);
    if (!src) continue;
    const ok = known.get(src);
    if (ok === undefined) pending = true;
    else has[clip] = ok;
  }
  return { fx, status: pending ? 'pending' : 'ready', has };
}

export function getCharacterFx(id: string | null | undefined): CharacterFx | null {
  return id ? CONFIGS.get(id) ?? null : null;
}

const NO_FX: CharacterFxState = { fx: null, status: 'none', has: NONE };

export function useCharacterFx(id: string | null | undefined): CharacterFxState {
  const fx = getCharacterFx(id);
  // The state is derived from the probe cache on every render, so a render
  // between an id change and its effect never shows the old character's clips;
  // the reducer only exists to re-render when a probe lands.
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!fx) return;
    let cancelled = false;
    const srcs = CLIPS.map((c) => srcOf(fx, c)).filter((s): s is string => s !== null);
    void Promise.all(srcs.map(probe)).then(() => {
      if (!cancelled) bump();
    });
    return () => {
      cancelled = true;
    };
  }, [fx]);

  return fx ? snapshot(fx) : NO_FX;
}
