/*
  The atmosphere engine: one frame loop that runs the RTPC parameters, the
  per-world responses, the world groups (plates, overlays) and the particle
  field (RTPC-SPEC sections 1 to 7).

  Worlds stack bottom to top inside `.atm`; the top committed world is the
  CURRENT one (it spawns, it answers the live parameters). A theme change
  pushes a new world that crossfades in over the theme band; the old one stops
  spawning, its particles fade with its group, and it is removed once the new
  one is opaque. A preview world (setPreview) sits above the stack with its
  opacity on the finger; a setTheme to the armed id promotes it.

  Writes per frame: canvas pixels, `style.opacity` of the group(s) that are
  fading, and overlay wrapper opacities at 30Hz when they move by >= 0.01. No
  custom-property writes, no layout reads, no React state.
*/
import type { OverlayKind, ParticleKind, ThemeId, ThemeSpec } from '../../data/types';
import { durMs, ease } from '../../lib/motion';
import { createWorldGroup, type WorldGroup } from '../overlays/group';
import { clamp, clamp01, Rtpc, type AtmosphereInputs } from '../rtpc';
import { getTheme } from '../themes';
import { ParticleField, type FieldLayer, type FieldWorld } from './field';
import { kinds } from './kinds';
import { addOf, compiledResponse, mulOf, SRC, SRC_COUNT, windOf, type CompiledResponse } from './responses';
import { parseColor, rgba, sprite } from './sprites';
import { battery, clampTo, fade, follow, neutral, origins, population, tierRules, tiers, wash, writes } from './tuning';

type Role = 'stack' | 'preview';

interface World {
  slot: number;
  id: ThemeId;
  spec: ThemeSpec;
  sceneSrc: string | null;
  resp: CompiledResponse;
  field: FieldWorld;
  group: WorldGroup;
  role: Role;
  /** Group opacity now, and the last value written to the DOM. */
  opacity: number;
  written: number;
  ramp: { from: number; to: number; start: number; dur: number } | null;
  /** Waiting for the plate before the ramp starts (with a deadline). */
  waitUntil: number;
  /** Current overlay values, parallel to group.overlays. */
  ov: Float32Array;
  glow: number;
  dim: number;
  glowGrad: CanvasGradient | null;
  dimColor: string;
  front: boolean;
}

const NEUTRAL_SRC = (() => {
  const s = new Float32Array(SRC_COUNT);
  s[SRC.affinity] = neutral.affinity;
  return s;
})();

/** cubic-bezier easing (x -> y) for the crossfade ramps. */
function bezier(p: readonly number[]): (t: number) => number {
  const [x1, y1, x2, y2] = p;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = sx(t) - x;
      const d = dx(t);
      if (Math.abs(e) < 1e-4 || d === 0) break;
      t -= e / d;
    }
    return sy(clamp01(t));
  };
}
const easeContinuous = bezier(ease.continuous as readonly number[]);

const MAX_SLOTS = 8;

export interface EnginePerf {
  engineMs: number[];
  frameMs: number[];
  tier: number;
  particles: number;
}

export class AtmosphereEngine {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly field = new ParticleField();
  private readonly rtpc = new Rtpc();
  private readonly stack: World[] = [];
  private preview: World | null = null;
  private readonly slots: (World | null)[] = new Array(MAX_SLOTS).fill(null);
  private W = 1;
  private H = 1;
  private dpr = 1;
  private tier = 0;
  private pinnedTier: number | null = null;
  private raf = 0;
  private running = false;
  private destroyed = false;
  private lastT = 0;
  private lastDraw = 0;
  private budget = 0;
  private tweenUntil = 0;
  private lastOverlayWrite = 0;
  private emaFrame = 16.7;
  private emaEngine = 1;
  private slowSince = 0;
  private fastSince = 0;
  private emit: { slot: number; layer: number; left: number; every: number; next: number } | null = null;
  private readonly ro: ResizeObserver;
  private readonly perf: EnginePerf | null;
  private readonly onVisibility = () => this.wake();
  private readonly onInput = () => {
    this.inputs.lastInputAt = performance.now();
  };

  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly inputs: AtmosphereInputs;

  constructor(
    root: HTMLDivElement,
    canvas: HTMLCanvasElement,
    inputs: AtmosphereInputs,
    options: { perf?: boolean; tier?: number | null } = {}
  ) {
    this.root = root;
    this.canvas = canvas;
    this.inputs = inputs;
    this.ctx = canvas.getContext('2d');
    this.perf = options.perf ? { engineMs: [], frameMs: [], tier: 0, particles: 0 } : null;
    this.pinnedTier = options.tier ?? null;
    this.tier = this.pinnedTier ?? this.storedTier();
    inputs.wake = () => this.wake();
    inputs.lastInputAt = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pointerdown', this.onInput, { passive: true });
    window.addEventListener('keydown', this.onInput, { passive: true });
    this.ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) this.resize(r.width, r.height);
    });
    this.ro.observe(root);
    const r = root.getBoundingClientRect();
    this.resize(r.width, r.height);
  }

  get perfData(): EnginePerf | null {
    return this.perf;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pointerdown', this.onInput);
    window.removeEventListener('keydown', this.onInput);
    for (const w of [...this.stack, this.preview]) if (w) this.removeWorld(w);
    this.inputs.wake = () => {};
  }

  /* ------------------------------------------------------------ worlds */

  /** The committed theme changed (ThemeProvider state). */
  setWorld(spec: ThemeSpec, sceneSrc: string | null): void {
    const now = performance.now();
    const top = this.stack[this.stack.length - 1];
    const initial = !top;
    // Already showing (or already fading in) this world.
    if (top && top.id === spec.id && top.sceneSrc === sceneSrc) return;
    const band = durMs.theme;
    const p = this.preview;
    const armed = !!p && p.id === spec.id && (p.sceneSrc === sceneSrc || !sceneSrc || !p.sceneSrc);
    if (p && armed && p.group.ready) {
      this.promote(p, now);
      return;
    } else {
      if (p && armed) {
        // Armed but its plate never decoded: a plain crossfade replaces it.
        this.removeWorld(p);
        this.preview = null;
        this.rtpc.previewW = 0;
      }
      const w = this.makeWorld(spec, sceneSrc, 'stack');
      if (initial) {
        w.opacity = 1;
        w.ramp = null;
        w.group.root.style.opacity = '1';
        w.written = 1;
      } else {
        w.ramp = { from: 0, to: 1, start: 0, dur: band };
        w.waitUntil = now + fade.decodeWaitMs;
        this.setFront(w, true);
      }
      this.stack.push(w);
    }
    if (!initial) this.tweenUntil = now + durMs.theme;
    // Too many partial fades stacked (rapid switching): finish the oldest at once.
    while (this.stack.length > fade.maxStack) {
      const gone = this.stack.shift();
      if (gone) this.removeWorld(gone);
      const base = this.stack[0];
      if (base) {
        base.opacity = 1;
        base.ramp = null;
        base.waitUntil = 0;
      }
    }
    this.wake();
  }

  /**
   * Promote the armed preview to the current world: ramp from where the
   * finger left it to opaque over max(120ms, theme band x (1 - w0)); its
   * particles are kept, the outgoing world's age out.
   */
  private promote(p: World, now: number): void {
    const band = durMs.theme;
    this.preview = null;
    p.role = 'stack';
    const w0 = p.opacity;
    p.ramp = { from: w0, to: 1, start: now, dur: Math.max(fade.promoteMinMs, band * (1 - w0)) };
    p.waitUntil = 0;
    this.stack.push(p);
    this.setFront(p, true);
    this.rtpc.previewW = 0;
    this.tweenUntil = now + durMs.theme;
    this.wake();
  }

  private makeWorld(spec: ThemeSpec, sceneSrc: string | null, role: Role): World {
    let slot = this.slots.findIndex((s) => s === null);
    if (slot < 0) {
      const oldest = this.stack.shift();
      if (oldest) this.removeWorld(oldest);
      slot = this.slots.findIndex((s) => s === null);
    }
    const resp = compiledResponse(spec.id);
    const fw: FieldWorld = {
      layers: [],
      weight: 0,
      reserveWeight: 0,
      windX: 0,
      windY: 0,
      reserve: 0,
      light: spec.scheme === 'light',
    };
    for (const pl of spec.particles) {
      fw.layers.push(this.makeLayer(pl.kind, pl.colors, pl.density, pl.speed ?? 1, pl.size ?? 1, resp, true));
    }
    const evalOverlay = (kind: OverlayKind, src: Float32Array) => {
      const o = resp.overlays[kind];
      if (!o) return 0.5;
      return clamp(o.rest + addOf(o.add, src, 1), 0, o.max);
    };
    const group = createWorldGroup(
      spec,
      sceneSrc,
      (kind) => evalOverlay(kind, role === 'preview' ? NEUTRAL_SRC : this.rtpc.src),
      (kind) => (resp.overlays[kind]?.add.length ?? 0) > 0,
      () => this.wake()
    );
    // Dark worlds dim toward black, light worlds toward their own ink.
    const dimRgb = spec.scheme === 'light' ? parseColor(spec.colors.ink) : ([0, 0, 0] as [number, number, number]);
    const world: World = {
      slot,
      id: spec.id,
      spec,
      sceneSrc,
      resp,
      field: fw,
      group,
      role,
      opacity: 0,
      written: 0,
      ramp: null,
      waitUntil: 0,
      ov: new Float32Array(group.overlays.map((o) => o.written)),
      glow: 0,
      dim: 0,
      glowGrad: null,
      dimColor: rgba(dimRgb, 1),
      front: false,
    };
    this.slots[slot] = world;
    this.field.worlds[slot] = fw;
    // Committed worlds go under an armed preview; the preview always sits on top.
    const above = role === 'stack' && this.preview ? this.preview.group.root : this.canvas;
    this.root.insertBefore(group.root, above);
    this.buildGlow(world);
    return world;
  }

  private makeLayer(
    kind: ParticleKind,
    colors: string[],
    density: number,
    speed: number,
    size: number,
    resp: CompiledResponse,
    ambient: boolean
  ): FieldLayer {
    const def = kinds[kind];
    const L: FieldLayer = {
      kind,
      def,
      colors,
      density: ambient ? density : 0,
      speed,
      size,
      sprites: [],
      strokes: colors.map((c) => rgba(parseColor(c), 0.5)),
      resp: ambient ? (resp.layers[kind] ?? null) : null,
      ambient,
      live: 0,
      died: 0,
      target: 0,
      spawnMul: 1,
      speedMul: 1,
      alphaMul: 1,
    };
    this.buildSprites(L);
    return L;
  }

  private buildSprites(L: FieldLayer): void {
    if (L.def.code === kinds.rain.code) return;
    L.sprites = L.colors.map((c) => {
      const set = [];
      for (let v = 0; v < L.def.variants; v++) {
        for (let f = 0; f < L.def.frames; f++) set.push(sprite(L.kind, c, v, f, L.size, this.dpr));
      }
      return set;
    });
  }

  private layerFor(w: World, kind: ParticleKind): number {
    const i = w.field.layers.findIndex((l) => l.kind === kind);
    if (i >= 0) return i;
    const colors = w.spec.particles[0]?.colors ?? [w.spec.colors.glow, w.spec.colors.accent];
    w.field.layers.push(this.makeLayer(kind, colors, 0, 1, 1, w.resp, false));
    return w.field.layers.length - 1;
  }

  private removeWorld(w: World): void {
    this.field.clearOwner(w.slot);
    this.field.worlds[w.slot] = null;
    this.slots[w.slot] = null;
    w.group.destroy();
    if (this.emit?.slot === w.slot) this.emit = null;
  }

  private setFront(w: World, on: boolean): void {
    if (w.front === on) return;
    w.front = on;
    w.group.root.classList.toggle('is-front', on);
  }

  private buildGlow(w: World): void {
    if (!this.ctx) return;
    const cx = this.W * wash.glowCenterX * this.dpr;
    const cy = this.H * wash.glowCenterY * this.dpr;
    const r = Math.max(this.W, this.H) * wash.glowRadius * this.dpr;
    const g = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const c = parseColor(w.spec.colors.glow);
    g.addColorStop(0, rgba(c, 1));
    g.addColorStop(0.45, rgba(c, 0.5));
    g.addColorStop(1, rgba(c, 0));
    w.glowGrad = g;
  }

  /* ------------------------------------------------------- size, tiers */

  private resize(w: number, h: number): void {
    if (w < 1 || h < 1) return;
    const t = tiers[this.tier];
    const dpr = Math.min(window.devicePixelRatio || 1, t.dprCap);
    const changedDpr = dpr !== this.dpr;
    this.W = w;
    this.H = h;
    this.dpr = dpr;
    this.field.W = w;
    this.field.H = h;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    for (const s of this.slots) {
      if (!s) continue;
      this.buildGlow(s);
      if (changedDpr) for (const L of s.field.layers) this.buildSprites(L);
    }
    this.wake();
  }

  private storedTier(): number {
    try {
      const v = Number(sessionStorage.getItem(tierRules.storageKey));
      return Number.isInteger(v) && v >= 0 && v < tiers.length ? v : 0;
    } catch {
      return 0;
    }
  }

  private setTier(n: number): void {
    if (n === this.tier || this.pinnedTier !== null) return;
    this.tier = n;
    try {
      sessionStorage.setItem(tierRules.storageKey, String(n));
    } catch {
      /* private mode: the tier just is not remembered */
    }
    this.resize(this.W, this.H);
  }

  private judgeTier(t: number, interval: number, engineMs: number): void {
    if (interval < tierRules.ignoreGapMs) this.emaFrame += (interval - this.emaFrame) * tierRules.ema;
    this.emaEngine += (engineMs - this.emaEngine) * tierRules.ema;
    if (this.pinnedTier !== null) return;
    const slow =
      (this.tier === 0 && (this.emaFrame > tierRules.slowFrameMs || this.emaEngine > tierRules.engineMs)) ||
      (this.tier === 1 && this.emaFrame > tierRules.slowerFrameMs);
    if (slow) {
      this.fastSince = 0;
      if (!this.slowSince) this.slowSince = t;
      else if (t - this.slowSince > tierRules.downHoldMs) {
        this.slowSince = 0;
        this.setTier(this.tier + 1);
      }
      return;
    }
    this.slowSince = 0;
    if (this.tier > 0 && this.emaFrame < tierRules.upFrameMs) {
      if (!this.fastSince) this.fastSince = t;
      else if (t - this.fastSince > tierRules.upHoldMs) {
        this.fastSince = 0;
        this.setTier(this.tier - 1);
      }
    } else this.fastSince = 0;
  }

  /* ------------------------------------------------------------- loop */

  wake(): void {
    if (this.destroyed || this.running || document.hidden) return;
    this.running = true;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (t: number): void => {
    this.raf = 0;
    if (this.destroyed) return;
    if (document.hidden) {
      this.running = false;
      return;
    }
    const interval = t - this.lastT;
    this.lastT = t;
    const tier = tiers[this.tier];
    const sleepy = t - this.inputs.lastInputAt > battery.afterMs;
    const hz = sleepy ? Math.min(battery.hz, tier.hz) : tier.hz;
    if (hz < 60 && t - this.lastDraw < 1000 / hz - 4) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const dt = Math.min(t - (this.lastDraw || t - interval), 1000 * 0.05) / 1000;
    this.lastDraw = t;

    const t0 = performance.now();
    const keepGoing = this.frame(t, dt, sleepy);
    const engineMs = performance.now() - t0;
    this.judgeTier(t, interval, engineMs);
    if (this.perf) {
      this.perf.engineMs.push(engineMs);
      this.perf.frameMs.push(interval);
      if (this.perf.engineMs.length > 1200) {
        this.perf.engineMs.splice(0, 600);
        this.perf.frameMs.splice(0, 600);
      }
      this.perf.tier = this.tier;
      this.perf.particles = this.field.count;
    }
    if (keepGoing) this.raf = requestAnimationFrame(this.tick);
    else this.running = false;
  };

  /** One frame. Returns whether the loop should keep running. */
  private frame(now: number, dt: number, sleepy: boolean): boolean {
    const tier = tiers[this.tier];
    this.rtpc.update(now, dt, this.inputs, false);

    this.syncPreview(now);
    this.advanceRamps(now);
    const top = this.stack[this.stack.length - 1];
    if (!top) return false;

    // Group opacities and visual weights (top down).
    const p = this.preview;
    if (p) {
      p.opacity = p.group.ready ? this.rtpc.previewW : 0;
    }
    let rem = 1;
    if (p) {
      p.field.weight = p.opacity;
      p.field.reserveWeight = p.opacity;
      rem *= 1 - p.opacity;
    }
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const w = this.stack[i];
      const o = i === 0 ? 1 : w.opacity;
      w.field.weight = o * rem;
      // A burst shows at once, even while its world is still fading in.
      w.field.reserveWeight = w === top ? rem : w.field.weight;
      rem *= 1 - o;
    }
    this.writeGroups();

    // Responses: the current world answers the live sources; the preview its neutral ones.
    const scale = sleepy ? 0 : tier.responseScale;
    this.evaluate(top, this.rtpc.src, scale, 1);
    if (p) this.evaluate(p, NEUTRAL_SRC, 1, 0);

    // Bursts and the bloom emit (reserve).
    this.drainBursts(top);
    this.runEmit(now, top, tier.emits && !sleepy);

    // Population targets and spawning.
    const previewAlive = !!p && this.rtpc.previewW > follow.previewSpawnMin;
    const tweenScale = now < this.tweenUntil ? fade.tweenCostScale : 1;
    const capA = (previewAlive ? Math.min(tier.cost, population.currentCostWhilePreview * (tier.cost / tiers[0].cost)) : tier.cost) * tweenScale;
    const pop = sleepy ? battery.pop : tier.pop;
    this.targets(top, capA, pop);
    for (const w of this.stack) {
      if (w !== top) {
        for (const L of w.field.layers) {
          L.target = 0;
          L.died = 0;
        }
      }
    }
    if (p) {
      if (previewAlive) {
        const capB = population.previewCost * (tier.cost / tiers[0].cost);
        this.targets(p, capB, pop * Math.pow(this.rtpc.previewW, 1.5));
      } else for (const L of p.field.layers) L.target = 0;
    }
    this.budget = Math.min(this.budget + population.growthPerSec * dt, population.growthPerSec * 0.15);
    this.spawnInto(top);
    if (p) this.spawnInto(p);

    this.field.step(dt);
    this.paint(top);
    this.writeOverlays(now, false);
    return true;
  }

  /** Preview arm / disarm / replace, from the inputs ref. */
  private syncPreview(now: number): void {
    const want = this.inputs.preview;
    const req = this.inputs.theme;
    let top = this.stack[this.stack.length - 1];
    // setTheme to the armed world already happened (React has not re-rendered
    // yet): promote now, before a re-armed next preview could replace it.
    const armed = this.preview;
    if (
      armed &&
      armed.group.ready &&
      armed.id === req.id &&
      (armed.sceneSrc === req.sceneSrc || !req.sceneSrc) &&
      !(top && top.id === req.id && top.sceneSrc === req.sceneSrc)
    ) {
      this.promote(armed, now);
      top = armed;
    }
    const p = this.preview;
    const id = want.id && !(top && want.id === top.id && want.sceneSrc === top.sceneSrc) ? want.id : null;
    if (!id) {
      // Disarm once the weight has eased back to zero.
      if (p && this.rtpc.previewW <= 0.002) {
        this.removeWorld(p);
        this.preview = null;
      }
      return;
    }
    if (p && p.id === id && p.sceneSrc === want.sceneSrc) return;
    if (p) this.removeWorld(p);
    // Arm: mounted hidden, shown only after its plate decodes.
    const w = this.makeWorld(getTheme(id), want.sceneSrc, 'preview');
    w.opacity = 0;
    this.setFront(w, true);
    this.preview = w;
    this.rtpc.previewW = 0;
  }

  /** Advance the crossfade ramps; drop worlds hidden under an opaque one. */
  private advanceRamps(now: number): boolean {
    let busy = false;
    for (const w of this.stack) {
      const r = w.ramp;
      if (!r) continue;
      busy = true;
      if (!r.start) {
        if (!w.group.ready && now < w.waitUntil) continue;
        r.start = now;
      }
      const t = clamp01((now - r.start) / r.dur);
      w.opacity = r.from + (r.to - r.from) * easeContinuous(t);
      if (t >= 1) {
        w.opacity = 1;
        w.ramp = null;
      }
    }
    // Everything under the highest opaque world is invisible: remove it.
    let opaque = -1;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const w = this.stack[i];
      if (i === 0 || (w.opacity >= 1 && !w.ramp)) {
        opaque = i;
        break;
      }
    }
    if (opaque > 0) {
      const gone = this.stack.splice(0, opaque);
      for (const w of gone) this.removeWorld(w);
      const base = this.stack[0];
      if (base) {
        this.setFront(base, false);
      }
    }
    return busy;
  }

  /** Group opacities: the fading group(s) every frame they move. */
  private writeGroups(): void {
    for (let i = 0; i <= this.stack.length; i++) {
      const w = i < this.stack.length ? this.stack[i] : this.preview;
      if (!w) continue;
      const v = i === 0 ? 1 : w.opacity;
      const settled = (v === 1 && w.written === 1) || (v === 0 && w.written === 0);
      if (settled || (Math.abs(v - w.written) < 0.002 && v !== 0 && v !== 1)) continue;
      w.group.root.style.opacity = v >= 1 ? '1' : v.toFixed(3);
      w.written = v;
    }
  }

  /** Evaluate a world's response into its layers, overlays, wind and washes. */
  private evaluate(w: World, src: Float32Array, scale: number, windScale: number): void {
    const r = w.resp;
    for (const L of w.field.layers) {
      const lr = L.resp;
      if (!lr) {
        L.spawnMul = 1;
        L.speedMul = 1;
        L.alphaMul = 1;
        continue;
      }
      L.spawnMul = clamp(mulOf(lr.spawn, src, scale), clampTo.spawn[0], clampTo.spawn[1]);
      L.speedMul = clamp(mulOf(lr.speed, src, scale), clampTo.speed[0], clampTo.speed[1]);
      L.alphaMul = clamp(mulOf(lr.alpha, src, scale), clampTo.alpha[0], clampTo.alpha[1]);
    }
    const ovs = w.group.overlays;
    for (let i = 0; i < ovs.length; i++) {
      const o = r.overlays[ovs[i].kind];
      w.ov[i] = o ? clamp(o.rest + addOf(o.add, src, scale), clampTo.overlay[0], o.max) : ovs[i].written;
    }
    const dir = this.rtpc.gustDir;
    w.field.windX = clamp(windOf(r.windX, src, scale, dir), clampTo.wind[0], clampTo.wind[1]) * this.W * windScale;
    w.field.windY = clamp(addOf(r.windY, src, scale), clampTo.wind[0], clampTo.wind[1]) * this.W * windScale;
    w.glow = clamp(addOf(r.glow, src, scale), clampTo.glow[0], clampTo.glow[1]);
    w.dim = clamp(addOf(r.dim, src, scale), clampTo.dim[0], clampTo.dim[1]);
  }

  /** Per-layer targets from density x area x spawn multiplier, fitted under a cost cap. */
  private targets(w: World, cap: number, pop: number): void {
    const units = (this.W * this.H) / population.areaUnit;
    let cost = 0;
    for (const L of w.field.layers) {
      if (!L.ambient) {
        L.target = 0;
        continue;
      }
      const max = L.def.code === kinds.rain.code ? population.rainLayerCap : population.layerCap;
      L.target = Math.min(max, L.density * units * L.spawnMul * pop);
      cost += L.target * L.def.cost;
    }
    const s = cost > cap ? cap / cost : 1;
    for (const L of w.field.layers) L.target = Math.round(L.target * s);
  }

  /**
   * Fill a world's layers toward their targets: particles that died since the
   * last pass are replaced freely; net growth spends the growth budget
   * (at most `growthPerSec`, so a gust ramps in instead of popping).
   */
  private spawnInto(w: World): void {
    for (let li = 0; li < w.field.layers.length; li++) {
      const L = w.field.layers[li];
      while (L.live < L.target && (L.died > 0 || this.budget >= 1)) {
        const mode = L.live < L.target * population.fieldFillShare ? 'field' : 'edge';
        if (!this.field.spawn(w.slot, li, mode)) break;
        if (L.died > 0) L.died--;
        else this.budget -= 1;
      }
      L.died = 0;
    }
  }

  private reserveRoom(w: World, kind: ParticleKind): number {
    const tier = tiers[this.tier];
    const used = w.field.reserve;
    return Math.max(0, Math.floor((tier.reserve - used) / kinds[kind].cost));
  }

  private drainBursts(top: World): void {
    const q = this.inputs.bursts;
    if (!q.length) return;
    for (const k of q) {
      const kind = k ?? top.spec.particles[0]?.kind ?? 'sparkle';
      const li = this.layerFor(top, kind);
      const n = Math.min(population.burstCount, this.reserveRoom(top, kind));
      for (let i = 0; i < n; i++) this.field.spawn(top.slot, li, 'burst', this.W * origins.burstX, this.H * origins.burstY);
      this.rtpc.touch();
    }
    q.length = 0;
  }

  private runEmit(now: number, top: World, allowed: boolean): void {
    const be = top.resp.bloomEmit;
    const s = this.rtpc.takeBloomEmit(now, now < this.tweenUntil);
    if (s > 0 && be && allowed) {
      const n = Math.max(1, Math.round(be.n * s));
      this.emit = { slot: top.slot, layer: this.layerFor(top, be.kind), left: n, every: follow.bloomEmitSpanMs / n, next: now };
    }
    const e = this.emit;
    if (!e) return;
    const w = this.slots[e.slot];
    if (!w) {
      this.emit = null;
      return;
    }
    while (e.left > 0 && now >= e.next) {
      if (this.reserveRoom(w, w.field.layers[e.layer].kind) < 1) break;
      this.field.spawn(e.slot, e.layer, 'emit', this.W * origins.bloomX, this.H * origins.bloomY);
      e.left--;
      e.next += e.every;
    }
    if (e.left <= 0) this.emit = null;
  }

  /* ------------------------------------------------------------- paint */

  private paint(top: World): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Dim wash (one fill), then the current world's light wash.
    let dim = 0;
    for (const w of this.stack) dim += w.dim * w.field.weight;
    if (this.preview) dim += this.preview.dim * this.preview.field.weight;
    if (dim > 0.004) {
      ctx.globalAlpha = Math.min(clampTo.dim[1], dim) * (top.spec.scheme === 'light' ? wash.lightDimScale : 1);
      ctx.fillStyle = top.dimColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    for (const w of this.preview ? [top, this.preview] : [top]) {
      const g = w.glow * w.field.weight;
      if (g > 0.004 && w.glowGrad) {
        ctx.globalAlpha = g;
        ctx.fillStyle = w.glowGrad;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
    ctx.globalAlpha = 1;
    this.field.draw(ctx, this.dpr);
  }

  /** Overlay wrapper opacities: 30Hz, only on a change of >= 0.01, at most 8 writes a frame. */
  private writeOverlays(now: number, force: boolean): void {
    if (!force && now - this.lastOverlayWrite < 1000 / writes.overlayHz) return;
    this.lastOverlayWrite = now;
    let n = 0;
    const all = this.preview ? [this.stack[this.stack.length - 1], this.preview] : [this.stack[this.stack.length - 1]];
    for (const w of all) {
      if (!w) continue;
      const ovs = w.group.overlays;
      for (let i = 0; i < ovs.length && n < writes.maxPerFrame; i++) {
        const h = ovs[i];
        const v = w.ov[i];
        if (Math.abs(v - h.written) < writes.step && !(v === 0 && h.written !== 0)) continue;
        h.el.style.opacity = v.toFixed(3);
        h.written = v;
        n++;
      }
    }
  }
}
