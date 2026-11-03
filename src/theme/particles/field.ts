/*
  The particle field: one pooled structure-of-arrays (no per-frame
  allocation), per-kind natural motion, and the draw into the one canvas.

  Motion per kind: leaves, maple and petals flutter and tumble; rose petals
  drift and curl; feathers swing like a pendulum; snow drifts and sways;
  bubbles rise with a buoyant wobble; embers rise and flicker; bats swoop in
  arcs with a two-frame flap; rain falls as one batched stroke; fireflies
  wander and pulse; sand streams on the breeze; foxfire wisps rise and
  flicker; bokeh breathes; butterflies wander and flap; glyphs fall and tick;
  pollen drifts; gears turn; steam puffs rise and spread; sparkles twinkle;
  stars twinkle; shooting stars streak across after a dormant spell.

  Particles belong to a world slot (`owner`) and a layer of that world; the
  engine owns the worlds and tells the field their weights and winds.
  Simulation numbers (brief exemption for src/theme/particles/**).
*/
import type { ParticleKind } from '../../data/types';
import type { CompiledLayer } from './responses';
import { K, kindByCode, type KindDef } from './kinds';
import { population } from './tuning';
import type { Sprite } from './sprites';

export interface FieldLayer {
  kind: ParticleKind;
  def: KindDef;
  colors: string[];
  /** Per 100k px^2. Zero for burst-only layers. */
  density: number;
  speed: number;
  size: number;
  /** sprites[color][variant * frames + frame] */
  sprites: Sprite[][];
  /** rgba strings for the rain stroke, one per colour. */
  strokes: string[];
  resp: CompiledLayer | null;
  ambient: boolean;
  /** Ambient (non-reserve) live count. */
  live: number;
  /** Ambient particles that died since the last spawn pass: replacing them is not growth. */
  died: number;
  target: number;
  spawnMul: number;
  speedMul: number;
  alphaMul: number;
}

export interface FieldWorld {
  layers: FieldLayer[];
  /** Alpha multiplier for this world's ambient particles (its visual weight). */
  weight: number;
  /** Alpha multiplier for its burst and bloom particles. */
  reserveWeight: number;
  /** Wind in CSS px per second. */
  windX: number;
  windY: number;
  /** Reserve (burst, bloom emit) live count. */
  reserve: number;
}

export type SpawnMode = 'field' | 'edge' | 'burst' | 'emit';

const FLAG_RESERVE = 1;
const TAU = Math.PI * 2;

export type Rand = () => number;

/** mulberry32: a deterministic generator for the reduced-motion still frame. */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (r: readonly [number, number], t: number) => r[0] + (r[1] - r[0]) * t;

export class ParticleField {
  readonly n = population.slots;
  readonly alive = new Uint8Array(this.n);
  readonly owner = new Uint8Array(this.n);
  readonly layer = new Uint8Array(this.n);
  readonly flags = new Uint8Array(this.n);
  readonly color = new Uint8Array(this.n);
  readonly variant = new Uint8Array(this.n);
  readonly x = new Float32Array(this.n);
  readonly y = new Float32Array(this.n);
  readonly vx = new Float32Array(this.n);
  readonly vy = new Float32Array(this.n);
  readonly wx = new Float32Array(this.n);
  readonly wy = new Float32Array(this.n);
  readonly rot = new Float32Array(this.n);
  readonly vr = new Float32Array(this.n);
  readonly ph = new Float32Array(this.n);
  readonly phs = new Float32Array(this.n);
  readonly ph2 = new Float32Array(this.n);
  readonly ph3 = new Float32Array(this.n);
  readonly aux = new Float32Array(this.n);
  readonly amp = new Float32Array(this.n);
  readonly sc = new Float32Array(this.n);
  readonly al = new Float32Array(this.n);
  readonly age = new Float32Array(this.n);
  readonly life = new Float32Array(this.n);
  readonly delay = new Float32Array(this.n);
  private readonly free = new Int16Array(this.n);
  private freeTop = 0;
  count = 0;

  /** World slots, indexed by `owner`. */
  readonly worlds: (FieldWorld | null)[] = [];
  /** Per-kind wind relax factors, refreshed each step. */
  private readonly relax = new Float32Array(kindByCode.length);
  rand: Rand = Math.random;

  W = 1;
  H = 1;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.alive.fill(0);
    this.freeTop = 0;
    for (let i = this.n - 1; i >= 0; i--) this.free[this.freeTop++] = i;
    this.count = 0;
    for (const w of this.worlds) {
      if (!w) continue;
      w.reserve = 0;
      for (const l of w.layers) {
        l.live = 0;
        l.died = 0;
      }
    }
  }

  /** Remove every particle of a world slot. */
  clearOwner(slot: number): void {
    for (let i = 0; i < this.n; i++) if (this.alive[i] && this.owner[i] === slot) this.kill(i);
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    const w = this.worlds[this.owner[i]];
    if (w) {
      if (this.flags[i] & FLAG_RESERVE) w.reserve--;
      else {
        const l = w.layers[this.layer[i]];
        if (l) {
          l.live--;
          l.died++;
        }
      }
    }
    this.free[this.freeTop++] = i;
  }

  /**
   * Spawn one particle of a layer. `ox`, `oy` (CSS px): the origin for burst
   * and emit. Returns false when the pool is full.
   */
  spawn(slot: number, li: number, mode: SpawnMode, ox = 0, oy = 0): boolean {
    const w = this.worlds[slot];
    if (!w || this.freeTop === 0) return false;
    const L = w.layers[li];
    if (!L) return false;
    const i = this.free[--this.freeTop];
    const r = this.rand;
    const d = L.def;
    const W = this.W;
    const H = this.H;
    const reserve = mode === 'burst' || mode === 'emit';

    this.alive[i] = 1;
    this.count++;
    this.owner[i] = slot;
    this.layer[i] = li;
    this.flags[i] = reserve ? FLAG_RESERVE : 0;
    if (reserve) w.reserve++;
    else L.live++;

    const depth = r();
    const df = 0.6 + 0.6 * depth; // speed by depth: far is slow
    this.sc[i] = (0.55 + 0.45 * depth) * (0.85 + 0.15 * r());
    this.al[i] = lerp(d.alpha, r()) * (0.7 + 0.3 * depth);
    this.color[i] = Math.floor(r() * L.colors.length);
    this.variant[i] = Math.floor(r() * d.variants);
    this.age[i] = 0;
    this.life[i] = lerp(d.life, r());
    this.delay[i] = mode === 'edge' ? lerp(d.delay, r()) : mode === 'field' ? lerp(d.delay, r()) * r() : 0;
    this.rot[i] = r() * TAU;
    this.vr[i] = 0;
    this.ph[i] = r() * TAU;
    this.phs[i] = 1;
    this.ph2[i] = r() * TAU;
    this.ph3[i] = r();
    this.aux[i] = 0;
    this.amp[i] = 0;
    this.vx[i] = 0;
    this.vy[i] = 0;
    const sus = d.sus;
    this.wx[i] = w.windX * sus;
    this.wy[i] = d.windXOnly ? 0 : w.windY * sus;
    const m = Math.max(24, d.px * L.size);

    // Position: in the field, entering at the edge the motion comes from, or at an origin.
    let x = r() * W;
    let y = r() * H;
    const windish = w.windX / Math.max(1, W);
    const sideP = Math.min(0.6, Math.abs(windish) * 0.9);
    if (mode === 'edge') {
      if (d.motion === 'fall') {
        if (r() < sideP) {
          x = windish < 0 ? W + m : -m;
          y = r() * H * 0.8;
        } else {
          x = r() * W;
          y = -m;
        }
      } else if (d.motion === 'rise') {
        if (r() < sideP) {
          x = windish < 0 ? W + m : -m;
          y = H * (0.3 + 0.7 * r());
        } else {
          x = r() * W;
          y = H + m;
        }
      }
    }

    switch (d.code) {
      case K.leaf:
      case K.maple:
      case K.petal:
      case K.rose:
      case K.feather: {
        const fast = d.code === K.leaf ? 50 : d.code === K.maple ? 42 : d.code === K.petal ? 34 : d.code === K.rose ? 30 : 24;
        this.vy[i] = fast * (0.75 + 0.5 * r()) * df;
        this.amp[i] = (d.code === K.feather ? 34 : d.code === K.petal ? 30 : 24) * (0.7 + 0.6 * r());
        this.phs[i] = (d.code === K.feather ? 1.4 : d.code === K.petal ? 2.2 : 1.7) * (0.75 + 0.5 * r());
        // Tumble rate (the 3D flip), and spin for maple.
        this.aux[i] = (d.code === K.rose ? 1.1 : d.code === K.feather ? 0 : 1.9) * (0.6 + 0.8 * r()) * (r() < 0.5 ? -1 : 1);
        this.vr[i] = d.code === K.maple ? (1.4 + 1.6 * r()) * (r() < 0.5 ? -1 : 1) : (r() - 0.5) * 0.6;
        if (d.code === K.feather) this.rot[i] = 0;
        break;
      }
      case K.snow:
        this.vy[i] = (22 + 26 * r()) * df;
        this.amp[i] = 10 + 14 * r();
        this.phs[i] = 0.6 + 0.6 * r();
        this.vr[i] = (r() - 0.5) * 0.6;
        break;
      case K.bubble:
        this.vy[i] = -(30 + 34 * r()) * df;
        this.amp[i] = 6 + 9 * r();
        this.phs[i] = 2 + 1.6 * r();
        this.rot[i] = 0;
        break;
      case K.ember:
        this.vy[i] = -(40 + 50 * r()) * df;
        this.amp[i] = 8 + 10 * r();
        this.phs[i] = 1.5 + 1.5 * r();
        this.aux[i] = 9 + 8 * r(); // flicker rate
        if (mode === 'edge' && r() < 0.7) y = H * (0.75 + 0.3 * r());
        break;
      case K.star:
        y = r() * H * 0.72;
        this.vx[i] = (r() - 0.5) * 3;
        this.phs[i] = 0.8 + 1.8 * r();
        this.rot[i] = 0;
        break;
      case K.shootingStar: {
        x = W * (0.25 + 0.75 * r());
        y = H * (0.03 + 0.3 * r());
        const leftward = r() < 0.7;
        const ang = (leftward ? Math.PI - 0.5 : 0.5) + (r() - 0.5) * 0.35;
        const v = 520 + 300 * r();
        this.vx[i] = Math.cos(ang) * v;
        this.vy[i] = Math.sin(ang) * v;
        this.rot[i] = ang;
        if (!leftward) x = W * 0.75 * r();
        break;
      }
      case K.bat: {
        const fromLeft = r() < 0.5;
        x = fromLeft ? -m : W + m;
        this.aux[i] = H * (0.08 + 0.42 * r()); // base altitude
        y = this.aux[i];
        this.vx[i] = (70 + 60 * r()) * (fromLeft ? 1 : -1) * df;
        this.vy[i] = (r() - 0.5) * 16; // altitude drift
        this.amp[i] = 22 + 34 * r();
        this.phs[i] = 1.6 + 1.2 * r();
        this.aux[i] = y;
        this.ph2[i] = 7 + 4 * r(); // flap rate (Hz)
        this.rot[i] = 0;
        if (mode === 'field' && this.delay[i] === 0) x = r() * W;
        break;
      }
      case K.rain:
        this.vy[i] = (640 + 300 * r()) * df;
        this.vx[i] = -36;
        this.amp[i] = (12 + 12 * r()) * df; // streak length
        if (mode === 'edge') {
          y = -this.amp[i] - r() * H * 0.2;
          x = r() * (W + 80) - 40;
        }
        break;
      case K.firefly:
        this.vx[i] = 10 + 16 * r(); // cruise speed
        this.rot[i] = r() * TAU; // heading
        this.aux[i] = 0.6 + 0.8 * r(); // turn rate
        this.phs[i] = 1.2 + 1.4 * r(); // blink
        if (mode === 'edge') y = H * (0.25 + 0.75 * r());
        break;
      case K.sand:
        this.vx[i] = -(60 + 80 * r()) * df;
        this.vy[i] = (r() - 0.35) * 10;
        this.amp[i] = 4 + 8 * r();
        this.phs[i] = 3 + 4 * r();
        this.vr[i] = (r() - 0.5) * 4;
        if (mode === 'edge') {
          const drift = this.vx[i] + w.windX * sus;
          x = drift < 0 ? W + m : -m;
          y = H * (0.25 + 0.75 * r());
        }
        break;
      case K.wisp:
        this.vy[i] = -(10 + 14 * r()) * df;
        this.amp[i] = 10 + 12 * r();
        this.phs[i] = 0.9 + 0.8 * r();
        this.aux[i] = 7 + 6 * r(); // flicker rate
        this.rot[i] = 0;
        if (mode === 'edge') y = H * (0.45 + 0.55 * r());
        break;
      case K.bokeh:
        this.vx[i] = (r() - 0.5) * 12;
        this.vy[i] = (r() - 0.5) * 10;
        this.phs[i] = 0.3 + 0.5 * r();
        this.rot[i] = 0;
        break;
      case K.butterfly:
        this.vx[i] = 30 + 26 * r(); // cruise speed
        this.aux[i] = r() * TAU; // heading
        this.amp[i] = 10 + 10 * r();
        this.phs[i] = 2 + 1.5 * r(); // bob
        this.ph2[i] = r() * TAU; // turn phase
        this.vr[i] = 8 + 4 * r(); // flap rate (Hz)
        this.rot[i] = 0;
        break;
      case K.glyph:
        this.vy[i] = (14 + 20 * r()) * df;
        this.ph[i] = 0.35 + 0.8 * r(); // time to the next tick
        this.rot[i] = 0;
        if (mode === 'edge') y = -m;
        break;
      case K.pollen:
        this.vx[i] = (r() - 0.5) * 10;
        this.vy[i] = (r() - 0.5) * 10;
        this.phs[i] = 1.5 + 2 * r();
        this.rot[i] = 0;
        break;
      case K.gear:
        this.vx[i] = (r() - 0.5) * 6;
        this.vy[i] = (3 + 6 * r()) * df;
        this.vr[i] = (0.25 + 0.5 * r()) * (r() < 0.5 ? -1 : 1);
        this.sc[i] = 0.5 + 0.5 * depth;
        break;
      case K.steam:
        this.vy[i] = -(14 + 16 * r()) * df;
        this.amp[i] = 6 + 8 * r();
        this.phs[i] = 0.7 + 0.6 * r();
        this.vr[i] = (r() - 0.5) * 0.4;
        if (mode === 'edge' || mode === 'field') y = H * (0.6 + 0.45 * r());
        break;
      case K.sparkle:
        this.vx[i] = (r() - 0.5) * 4;
        this.vy[i] = (r() - 0.5) * 4;
        this.vr[i] = (r() - 0.5) * 1.2;
        break;
    }

    if (reserve) {
      // Radial from the origin: a fast burst or a gentle bloom emit.
      const ang = r() * TAU;
      const v = mode === 'burst' ? 150 + 230 * r() : 40 + 90 * r();
      this.vx[i] = Math.cos(ang) * v;
      this.vy[i] = Math.sin(ang) * v;
      this.life[i] = mode === 'burst' ? 1.4 + 0.9 * r() : 2.4 + 1.2 * r();
      this.delay[i] = 0;
      this.vr[i] = (r() - 0.5) * 4;
      this.sc[i] = 0.7 + 0.3 * r();
      this.al[i] = lerp(d.alpha, 0.5 + 0.5 * r());
      x = ox;
      y = oy;
    }

    this.x[i] = x;
    this.y[i] = y;
    if (d.code === K.bat && !reserve) this.aux[i] = y;
    return true;
  }

  /** Advance every particle by dt seconds. */
  step(dt: number): void {
    for (let c = 0; c < kindByCode.length; c++) this.relax[c] = 1 - Math.exp(-dt / kindByCode[c].tau);
    const W = this.W;
    const H = this.H;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const w = this.worlds[this.owner[i]];
      const L = w?.layers[this.layer[i]];
      if (!w || !L) {
        this.kill(i);
        continue;
      }
      const d = L.def;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        continue;
      }
      this.age[i] += dt;
      const sp = L.speed * L.speedMul;
      const reserve = this.flags[i] & FLAG_RESERVE;

      if (reserve) {
        if (this.age[i] > this.life[i]) {
          this.kill(i);
          continue;
        }
        const drag = Math.exp(-dt * 2.2);
        this.vx[i] *= drag;
        this.vy[i] *= drag;
        const grav = d.motion === 'fall' ? 36 : d.motion === 'rise' ? -28 : 0;
        this.vy[i] += grav * dt;
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
        this.rot[i] += this.vr[i] * dt;
        this.ph[i] += 2 * dt;
        this.ph2[i] += 1.9 * dt;
        this.ph3[i] += 9 * dt;
        continue;
      }

      // Wind: the per-particle velocity relaxes toward the world's wind (kind inertia).
      const kr = this.relax[d.code];
      this.wx[i] += (w.windX * d.sus - this.wx[i]) * kr;
      if (!d.windXOnly) this.wy[i] += (w.windY * d.sus - this.wy[i]) * kr;
      let dx = this.wx[i];
      let dy = this.wy[i];

      switch (d.code) {
        case K.leaf:
        case K.maple:
        case K.petal:
        case K.rose: {
          this.ph[i] += this.phs[i] * dt * sp;
          this.ph2[i] += this.aux[i] * dt * sp;
          const c = Math.cos(this.ph[i]);
          dx += this.amp[i] * c * sp;
          dy += this.vy[i] * sp * (0.78 + 0.32 * Math.sin(2 * this.ph[i]));
          this.rot[i] += (this.vr[i] + 0.55 * c * this.phs[i]) * dt * sp;
          break;
        }
        case K.feather: {
          this.ph[i] += this.phs[i] * dt * sp;
          const s = Math.sin(this.ph[i]);
          dx += this.amp[i] * Math.cos(this.ph[i]) * sp;
          dy += this.vy[i] * sp * (0.5 + 0.8 * (1 - Math.abs(s)));
          this.rot[i] = 0.75 * s;
          break;
        }
        case K.snow:
          this.ph[i] += this.phs[i] * dt * sp;
          dx += this.amp[i] * Math.cos(this.ph[i]) * 0.6 * sp;
          dy += this.vy[i] * sp;
          this.rot[i] += this.vr[i] * dt;
          break;
        case K.bubble:
          this.ph[i] += this.phs[i] * dt * sp;
          dx += this.amp[i] * Math.cos(this.ph[i]) * this.phs[i] * 0.35 * sp;
          dy += this.vy[i] * sp;
          break;
        case K.ember:
          this.ph[i] += this.phs[i] * dt * sp;
          this.ph2[i] += this.aux[i] * dt;
          dx += this.amp[i] * Math.sin(this.ph[i]) * sp;
          dy += this.vy[i] * sp;
          break;
        case K.star:
          this.ph[i] += this.phs[i] * dt * (0.5 + 0.5 * sp);
          dx += this.vx[i] * sp;
          break;
        case K.shootingStar:
          dx += this.vx[i] * sp;
          dy += this.vy[i] * sp;
          if (this.age[i] > this.life[i]) {
            this.kill(i);
            continue;
          }
          break;
        case K.bat:
          // Flap rate (Hz) lives in ph2; the flap phase runs in ph3.
          this.ph[i] += this.phs[i] * dt * sp;
          this.ph3[i] += this.ph2[i] * dt * sp;
          this.aux[i] += this.vy[i] * dt;
          dx += this.vx[i] * sp;
          // Swooping arcs: altitude rides a sine around a drifting base line.
          this.y[i] = this.aux[i] + this.amp[i] * Math.sin(this.ph[i]) + this.wy[i] * dt;
          this.rot[i] = 0.3 * Math.cos(this.ph[i]) * Math.sign(this.vx[i]);
          dy = 0;
          break;
        case K.rain:
          dx += this.vx[i];
          dy += this.vy[i] * sp;
          break;
        case K.firefly: {
          this.ph2[i] += this.aux[i] * dt;
          this.rot[i] += Math.sin(this.ph2[i]) * 1.3 * dt;
          this.ph[i] += this.phs[i] * dt * sp;
          dx += Math.cos(this.rot[i]) * this.vx[i] * sp;
          dy += Math.sin(this.rot[i]) * this.vx[i] * sp - 3;
          break;
        }
        case K.sand:
          this.ph[i] += this.phs[i] * dt;
          dx += this.vx[i] * sp;
          dy += (this.vy[i] + this.amp[i] * Math.sin(this.ph[i])) * sp;
          this.rot[i] += this.vr[i] * dt;
          break;
        case K.wisp:
          this.ph[i] += this.phs[i] * dt * sp;
          this.ph2[i] += this.aux[i] * dt;
          dx += this.amp[i] * Math.cos(this.ph[i]) * this.phs[i] * 0.5 * sp;
          dy += this.vy[i] * sp;
          this.rot[i] = Math.max(-0.35, Math.min(0.35, dx * 0.012));
          break;
        case K.bokeh:
          this.ph[i] += this.phs[i] * dt * sp;
          dx += this.vx[i] * sp;
          dy += this.vy[i] * sp;
          break;
        case K.butterfly: {
          this.ph[i] += this.phs[i] * dt * sp;
          this.ph2[i] += 0.8 * dt;
          this.ph3[i] += this.vr[i] * dt * Math.max(0.6, sp);
          let head = this.aux[i] + Math.sin(this.ph2[i]) * 0.9 * dt;
          // Wander back toward the middle when near an edge.
          const x = this.x[i];
          const y = this.y[i];
          if (x < W * 0.08 || x > W * 0.92 || y < H * 0.08 || y > H * 0.85) {
            const to = Math.atan2(H * 0.45 - y, W * 0.5 - x);
            let diff = to - head;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            head += diff * Math.min(1, dt * 1.6);
          }
          this.aux[i] = head;
          dx += Math.cos(head) * this.vx[i] * sp;
          dy += Math.sin(head) * this.vx[i] * 0.55 * sp + this.amp[i] * Math.cos(this.ph[i]) * sp;
          break;
        }
        case K.glyph:
          this.ph[i] -= dt * Math.max(0.3, sp);
          if (this.ph[i] <= 0) {
            this.variant[i] = Math.floor(this.rand() * d.variants);
            this.ph[i] = 0.35 + 0.8 * this.rand();
          }
          dy += this.vy[i] * sp;
          break;
        case K.pollen: {
          const kick = 26 * dt;
          this.vx[i] += (this.rand() - 0.5) * kick;
          this.vy[i] += (this.rand() - 0.5) * kick;
          const damp = Math.exp(-dt * 0.7);
          this.vx[i] *= damp;
          this.vy[i] *= damp;
          this.ph[i] += this.phs[i] * dt;
          dx += this.vx[i] * sp;
          dy += this.vy[i] * sp - 4;
          break;
        }
        case K.gear:
          dx += this.vx[i] * sp;
          dy += this.vy[i] * sp;
          this.rot[i] += this.vr[i] * dt * sp;
          break;
        case K.steam:
          this.ph[i] += this.phs[i] * dt;
          dx += this.amp[i] * Math.sin(this.ph[i]) * sp;
          dy += this.vy[i] * sp;
          this.rot[i] += this.vr[i] * dt;
          break;
        case K.sparkle:
          dx += this.vx[i];
          dy += this.vy[i];
          this.rot[i] += this.vr[i] * dt;
          break;
      }

      this.x[i] += dx * dt;
      if (d.code !== K.bat) this.y[i] += dy * dt;

      // Life, then leaving the frame (only when moving away from it).
      if (this.age[i] > this.life[i]) {
        this.kill(i);
        continue;
      }
      const m = d.code === K.rain ? this.amp[i] + 4 : Math.max(24, d.px * L.size);
      const x = this.x[i];
      const y = this.y[i];
      if ((x < -m && dx <= 0) || (x > W + m && dx >= 0) || (y < -m && dy <= 0) || (y > H + m && dy >= 0)) {
        this.kill(i);
        continue;
      }
      // Far outside (a side spawn the wind turned away from): recycle.
      if (x < -W * 0.6 || x > W * 1.6) this.kill(i);
    }
  }

  /**
   * Draw every live particle. `dpr`: device pixels per CSS px. Three passes:
   * sprites, the rain stroke (one path per world layer colour), then the
   * additive kinds with 'lighter'.
   */
  draw(ctx: CanvasRenderingContext2D, dpr: number): number {
    let drawn = 0;
    drawn += this.pass(ctx, dpr, false);
    drawn += this.rain(ctx, dpr);
    ctx.globalCompositeOperation = 'lighter';
    drawn += this.pass(ctx, dpr, true);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return drawn;
  }

  private envelope(i: number, d: KindDef): number {
    const age = this.age[i];
    const life = this.life[i];
    if (this.flags[i] & FLAG_RESERVE) {
      const fin = Math.min(1, age / 0.12);
      const fout = Math.min(1, (life - age) / (life * 0.45));
      return Math.max(0, Math.min(fin, fout));
    }
    switch (d.code) {
      case K.shootingStar:
      case K.steam:
      case K.sparkle:
        return Math.max(0, Math.sin(Math.PI * Math.min(1, age / life)));
    }
    let e = Math.min(1, age / population.fadeIn);
    if (life < 1e8) e = Math.min(e, (life - age) / population.fadeOut);
    return e < 0 ? 0 : e;
  }

  private pass(ctx: CanvasRenderingContext2D, dpr: number, additive: boolean): number {
    let drawn = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.delay[i] > 0) continue;
      const w = this.worlds[this.owner[i]];
      const L = w?.layers[this.layer[i]];
      if (!w || !L) continue;
      const d = L.def;
      if (d.additive !== additive || d.code === K.rain) continue;
      const reserve = this.flags[i] & FLAG_RESERVE;
      let a = this.al[i] * this.envelope(i, d) * L.alphaMul * (reserve ? w.reserveWeight : w.weight);
      let s = this.sc[i];
      let sx = 1;
      let sy = 1;
      let frame = 0;
      const ph = this.ph[i];
      switch (d.code) {
        case K.leaf:
        case K.maple:
        case K.petal:
        case K.rose: {
          const c = Math.cos(this.ph2[i]);
          sx = c >= 0 ? Math.max(0.18, c) : Math.min(-0.18, c);
          break;
        }
        case K.bubble:
          sx = 1 + 0.05 * Math.sin(2 * ph);
          sy = 1 - 0.05 * Math.sin(2 * ph);
          break;
        case K.ember: {
          const life = this.life[i];
          a *= 0.62 + 0.38 * Math.sin(this.ph2[i]) * Math.sin(this.ph2[i] * 0.37 + 1.3);
          if (life < 1e8) s *= 1 - 0.5 * Math.min(1, this.age[i] / life);
          break;
        }
        case K.star:
          a *= 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(ph));
          s *= 0.85 + 0.15 * Math.sin(ph);
          break;
        case K.bat:
          frame = (this.ph3[i] % 1) < 0.5 ? 0 : 1;
          if (this.vx[i] < 0) sx = -1;
          break;
        case K.firefly: {
          const b = 0.5 + 0.5 * Math.sin(ph);
          a *= 0.12 + 0.88 * b * b * b;
          break;
        }
        case K.wisp:
          a *= 0.72 + 0.28 * Math.sin(this.ph2[i]);
          s *= 1 + 0.08 * Math.sin(this.ph2[i] * 0.5);
          break;
        case K.bokeh:
          a *= 0.65 + 0.35 * Math.sin(ph);
          break;
        case K.butterfly:
          frame = (this.ph3[i] % 1) < 0.5 ? 0 : 1;
          if (Math.cos(this.aux[i]) < 0) sx = -1;
          break;
        case K.glyph:
          a *= this.ph[i] < 0.12 ? 1 : 0.75;
          break;
        case K.pollen:
          a *= 0.6 + 0.4 * Math.sin(ph);
          break;
        case K.steam:
          s *= 0.55 + 0.9 * Math.min(1, this.age[i] / this.life[i]);
          break;
        case K.sparkle:
          s *= Math.max(0.05, Math.sin(Math.PI * Math.min(1, this.age[i] / this.life[i])));
          break;
      }
      if (reserve && (d.code === K.bat || d.code === K.butterfly)) frame = (this.ph3[i] % 1) < 0.5 ? 0 : 1;
      if (a > 1) a = 1;
      if (a < 0.01) continue;
      const set = L.sprites[this.color[i]];
      const sp = set?.[this.variant[i] * d.frames + frame] ?? set?.[0];
      if (!sp) continue;
      const rot = this.rot[i];
      const cs = Math.cos(rot) * s * dpr;
      const sn = Math.sin(rot) * s * dpr;
      ctx.globalAlpha = a;
      ctx.setTransform(cs * sx, sn * sx, -sn * sy, cs * sy, this.x[i] * dpr, this.y[i] * dpr);
      ctx.drawImage(sp.img, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
      drawn++;
    }
    return drawn;
  }

  private rain(ctx: CanvasRenderingContext2D, dpr: number): number {
    let any = false;
    for (let s = 0; s < this.worlds.length; s++) {
      const w = this.worlds[s];
      if (!w) continue;
      for (let li = 0; li < w.layers.length; li++) {
        const L = w.layers[li];
        if (L.def.code !== K.rain) continue;
        for (let c = 0; c < L.colors.length; c++) {
          let started = false;
          for (let i = 0; i < this.n; i++) {
            if (!this.alive[i] || this.owner[i] !== s || this.layer[i] !== li || this.color[i] !== c) continue;
            if (!started) {
              ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              ctx.beginPath();
              started = true;
            }
            const len = this.amp[i];
            const vy = Math.max(1, this.vy[i] * L.speed * L.speedMul);
            const slant = ((this.vx[i] + this.wx[i]) / vy) * len;
            ctx.moveTo(this.x[i], this.y[i]);
            ctx.lineTo(this.x[i] - slant, this.y[i] - len);
          }
          if (!started) continue;
          ctx.globalAlpha = Math.min(1, L.alphaMul * w.weight);
          ctx.strokeStyle = L.strokes[c];
          ctx.lineWidth = Math.max(0.6, L.size);
          ctx.lineCap = 'round';
          ctx.stroke();
          any = true;
        }
      }
    }
    return any ? 1 : 0;
  }
}
