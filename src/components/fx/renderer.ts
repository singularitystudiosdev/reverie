/*
  The one FX renderer. ONE WebGL2 context for the whole app, and ONE overlay
  canvas that owns it, laid over [data-frame] (pointer-events none, on top of
  everything). A WebGL context belongs to the canvas that made it, so nothing
  is "re-targeted": every effect is a sprite that registers a rect (and a UV
  rect into its video) with this module, and a single pass draws them all.

  Shape of the pass (the game-VFX flipbook / sub-UV lateral):
    entry   one <video> (hidden) plus one GL texture slot. A surface owns its
            entry; rings and words SHARE an entry per clip, so a clip is
            decoded and uploaded once however many avatars or words show it.
    sprite  one consumer of an entry: a rect in the frame and the cell it
            samples. An entry draws all its sprites with ONE instanced draw.
    pass    requestAnimationFrame, only while something changed: a video
            presented a frame (requestVideoFrameCallback), a rect moved, or a
            live sprite is on screen. The texture is re-uploaded only when its
            video presented a new frame.

  Stacked alpha: colour from the top half of the video frame, alpha from the
  luma of the bottom half, output premultiplied (the proof's shader).

  Per frame this file writes no CSS. It reads layout only for `live` sprites
  (one rect per anchor, a clean-layout read: the profile sheet slides and
  scrolls, an avatar morphs); every other sprite measures once per
  ResizeObserver pass in its own component.
*/
import './fx.css';
import type { FxLayer, FxQuad, FxUv } from './types';

declare global {
  interface Window {
    /** Dev only: how many WebGL contexts the app has created. Must read 1. */
    __fxContexts?: number;
    /** Dev only: how many texture slots are live right now. */
    __fxSlots?: number;
  }
}

export type FxStatus = 'loading' | 'playing' | 'ended' | 'failed';

/** What a sprite is told when it is asked for its quads. */
export interface FxFrameCtx {
  /** Frame size in CSS pixels. */
  width: number;
  height: number;
  /** The stacked video's pixel size (colour half is videoW x videoH / 2). */
  videoW: number;
  videoH: number;
  layer: FxLayer;
  /** Top-left of an element in frame CSS pixels. One rect read per frame, shared by every sprite. */
  offsetOf(el: Element): { x: number; y: number };
}

export interface FxSprite {
  /** Set by the owner's IntersectionObserver; an invisible sprite is not drawn and does not keep the video playing. */
  visible: boolean;
  /** Reads layout every pass (its anchor moves under it). Others cache a rect and call invalidate() when it changes. */
  live: boolean;
  /** Avatar rings: hidden while a sheet is open over them (see suspendBase). */
  base?: boolean;
  quads(ctx: FxFrameCtx): readonly FxQuad[];
}

export interface FxEntry {
  readonly video: HTMLVideoElement;
  addSprite(sprite: FxSprite): void;
  removeSprite(sprite: FxSprite): void;
  /** A sprite's visibility or cached rect changed: wake the pass and the player. */
  invalidate(): void;
  /** Called at once with the current status, then on every change. Returns an unsubscribe. */
  onStatus(fn: (status: FxStatus) => void): () => void;
  /** Stop and give the texture back; a shared entry is only torn down by its last holder. */
  dispose(fadeMs?: number): void;
}

const FLOATS_PER_QUAD = 8;
const MAX_DPR = 2;

const VERT = `#version 300 es
in vec4 aDst;
in vec4 aSrc;
uniform vec2 uViewport;
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 px = aDst.xy + c * aDst.zw;
  gl_Position = vec4(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, 0.0, 1.0);
  vUv = aSrc.xy + c * aSrc.zw;
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uOpacity;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 rgb = texture(uTex, vec2(vUv.x, vUv.y * 0.5)).rgb;
  float a = texture(uTex, vec2(vUv.x, 0.5 + vUv.y * 0.5)).r;
  outColor = vec4(rgb * a, a) * uOpacity;
}`;

interface Gl {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  instances: WebGLBuffer;
  uViewport: WebGLUniformLocation;
  uOpacity: WebGLUniformLocation;
  data: Float32Array;
  lost: boolean;
}

interface Entry extends FxEntry {
  tex: WebGLTexture | null;
  gen: number;
  layer: FxLayer | null;
  show: boolean;
  opacity: number;
  active: boolean;
  upload: boolean;
  handle: number;
  disposed: boolean;
  closing: { start: number; ms: number } | null;
  status: FxStatus;
  listeners: Set<(s: FxStatus) => void>;
  sprites: Set<FxSprite>;
  /** Run on every presented frame (the sequencer's duration cutoff). */
  frameHook: (() => void) | null;
  /** The sequencer's play/pause switch, driven by sprite visibility. */
  setActive: ((on: boolean) => void) | null;
  teardown: () => void;
}

let gl: Gl | null = null;
let unsupported = false;
let generation = 0;
let created = 0;
let liveSlots = 0;
let frame: HTMLElement | null = null;
let frameObserver: ResizeObserver | null = null;
let raf = 0;
let suspended = 0;
const entries = new Set<Entry>();
const shared = new Map<string, { entry: Entry; refs: number }>();

/* ---- context and overlay ------------------------------------------------ */

function compile(g: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = g.createShader(type);
  if (!s) return null;
  g.shaderSource(s, src);
  g.compileShader(s);
  return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
}

function build(g: WebGL2RenderingContext): Pick<Gl, 'program' | 'vao' | 'instances' | 'uViewport' | 'uOpacity'> | null {
  const vs = compile(g, g.VERTEX_SHADER, VERT);
  const fs = compile(g, g.FRAGMENT_SHADER, FRAG);
  const program = g.createProgram();
  if (!vs || !fs || !program) return null;
  g.attachShader(program, vs);
  g.attachShader(program, fs);
  g.linkProgram(program);
  if (!g.getProgramParameter(program, g.LINK_STATUS)) return null;
  g.useProgram(program);
  const vao = g.createVertexArray();
  const instances = g.createBuffer();
  const uViewport = g.getUniformLocation(program, 'uViewport');
  const uOpacity = g.getUniformLocation(program, 'uOpacity');
  if (!vao || !instances || !uViewport || !uOpacity) return null;
  g.bindVertexArray(vao);
  g.bindBuffer(g.ARRAY_BUFFER, instances);
  const stride = FLOATS_PER_QUAD * 4;
  const dst = g.getAttribLocation(program, 'aDst');
  const src = g.getAttribLocation(program, 'aSrc');
  g.enableVertexAttribArray(dst);
  g.vertexAttribPointer(dst, 4, g.FLOAT, false, stride, 0);
  g.vertexAttribDivisor(dst, 1);
  g.enableVertexAttribArray(src);
  g.vertexAttribPointer(src, 4, g.FLOAT, false, stride, 16);
  g.vertexAttribDivisor(src, 1);
  g.uniform1i(g.getUniformLocation(program, 'uTex'), 0);
  g.disable(g.DEPTH_TEST);
  // Premultiplied source-over: a later (higher zIndex) entry composites over an earlier one.
  g.enable(g.BLEND);
  g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
  return { program, vao, instances, uViewport, uOpacity };
}

function ensure(): Gl | null {
  if (gl || unsupported) return gl;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
  if (!ctx) {
    unsupported = true;
    return null;
  }
  created += 1;
  if (import.meta.env.DEV) {
    window.__fxContexts = created;
    document.documentElement.dataset.fxContexts = String(created);
  }
  const built = build(ctx);
  if (!built) {
    unsupported = true;
    return null;
  }
  const g: Gl = { gl: ctx, canvas, ...built, data: new Float32Array(FLOATS_PER_QUAD * 32), lost: false };
  gl = g;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    g.lost = true;
    generation += 1;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    const rebuilt = build(ctx);
    if (!rebuilt) return;
    Object.assign(g, rebuilt);
    g.lost = false;
    request();
  });
  return g;
}

/** True when the browser can run the player at all (WebGL2). Creates the one context on first call. */
export function isFxSupported(): boolean {
  return ensure() !== null;
}

function sizeCanvas(): void {
  if (!gl || !frame) return;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = Math.max(1, Math.round(frame.clientWidth * dpr));
  const h = Math.max(1, Math.round(frame.clientHeight * dpr));
  if (gl.canvas.width !== w || gl.canvas.height !== h) {
    gl.canvas.width = w;
    gl.canvas.height = h;
  }
  request();
}

/** Lay the overlay over this frame (the app has one: [data-frame]). Idempotent. */
export function bindFrame(el: HTMLElement): boolean {
  const g = ensure();
  if (!g) return false;
  if (frame !== el) {
    frame = el;
    el.appendChild(g.canvas);
    frameObserver?.disconnect();
    frameObserver = new ResizeObserver(sizeCanvas);
    frameObserver.observe(el);
    sizeCanvas();
  } else if (g.canvas.parentElement !== el) {
    el.appendChild(g.canvas);
  }
  return true;
}

/** Top-left of `el` in the bound frame's CSS pixels (one rect read). Null before a frame is bound. */
export function offsetInFrame(el: Element): { x: number; y: number } | null {
  if (!frame) return null;
  const f = frame.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const k = f.width ? frame.clientWidth / f.width : 1;
  return { x: (r.left - f.left) * k, y: (r.top - f.top) * k };
}

/**
 * Hide every `base` sprite (avatar rings) while something opaque is open over
 * them, such as the profile sheet. Returns the release function.
 */
export function suspendBase(): () => void {
  suspended += 1;
  request();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    suspended -= 1;
    request();
  };
}

/* ---- the pass ------------------------------------------------------------ */

function request(): void {
  if (!raf) raf = requestAnimationFrame(tick);
}

function tick(): void {
  raf = 0;
  if (draw()) request();
}

function draw(): boolean {
  const g = gl;
  const host = frame;
  if (!g || g.lost || !host || entries.size === 0) {
    if (g && !g.lost) {
      g.gl.clearColor(0, 0, 0, 0);
      g.gl.clear(g.gl.COLOR_BUFFER_BIT);
    }
    return false;
  }
  const cssW = host.clientWidth;
  const cssH = host.clientHeight;
  const { gl: ctx, canvas } = g;
  if (!cssW || !cssH || canvas.width < 1) return false;

  const now = performance.now();
  let again = false;
  let hostRect: DOMRect | null = null;
  const offsetOf = (el: Element) => {
    hostRect ??= host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const k = hostRect.width ? cssW / hostRect.width : 1;
    return { x: (r.left - hostRect.left) * k, y: (r.top - hostRect.top) * k };
  };

  ctx.useProgram(g.program);
  ctx.bindVertexArray(g.vao);
  ctx.viewport(0, 0, canvas.width, canvas.height);
  ctx.clearColor(0, 0, 0, 0);
  ctx.clear(ctx.COLOR_BUFFER_BIT);
  ctx.uniform2f(g.uViewport, cssW, cssH);
  ctx.activeTexture(ctx.TEXTURE0);

  const order = [...entries].sort((a, b) => (a.layer?.zIndex ?? 0) - (b.layer?.zIndex ?? 0));
  for (const e of order) {
    if (e.closing) {
      const t = (now - e.closing.start) / e.closing.ms;
      if (t >= 1) {
        finalize(e);
        continue;
      }
      e.opacity = 1 - t;
      again = true;
    }
    const layer = e.layer;
    const video = e.video;
    if (!layer || !e.show || video.readyState < 2 || !video.videoWidth) continue;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const fctx: FxFrameCtx = { width: cssW, height: cssH, videoW: vw, videoH: vh, layer, offsetOf };
    let n = 0;
    for (const s of e.sprites) {
      if (!s.visible || (s.base && suspended > 0)) continue;
      if (s.live) again = true;
      for (const q of s.quads(fctx)) {
        const need = (n + 1) * FLOATS_PER_QUAD;
        if (g.data.length < need) {
          const grown = new Float32Array(need * 2);
          grown.set(g.data);
          g.data = grown;
        }
        const o = n * FLOATS_PER_QUAD;
        g.data[o] = q.x;
        g.data[o + 1] = q.y;
        g.data[o + 2] = q.w;
        g.data[o + 3] = q.h;
        g.data[o + 4] = q.uv[0];
        g.data[o + 5] = q.uv[1];
        g.data[o + 6] = q.uv[2];
        g.data[o + 7] = q.uv[3];
        n += 1;
      }
    }
    if (n === 0) continue;

    if (!e.tex || e.gen !== generation) {
      e.tex = ctx.createTexture();
      e.gen = generation;
      e.upload = true;
      ctx.bindTexture(ctx.TEXTURE_2D, e.tex);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
    } else {
      ctx.bindTexture(ctx.TEXTURE_2D, e.tex);
    }
    if (e.upload) {
      ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGB, ctx.RGB, ctx.UNSIGNED_BYTE, video);
      e.upload = false;
    }
    ctx.uniform1f(g.uOpacity, e.opacity);
    ctx.bindBuffer(ctx.ARRAY_BUFFER, g.instances);
    ctx.bufferData(ctx.ARRAY_BUFFER, g.data.subarray(0, n * FLOATS_PER_QUAD), ctx.DYNAMIC_DRAW);
    ctx.drawArraysInstanced(ctx.TRIANGLE_STRIP, 0, 4, n);
  }
  return again;
}

/* ---- entries --------------------------------------------------------------- */

const hasRvfc = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

function setStatus(e: Entry, s: FxStatus): void {
  if (e.status === s) return;
  e.status = s;
  for (const fn of [...e.listeners]) fn(s);
}

function arm(e: Entry): void {
  if (e.handle || e.disposed || e.video.paused) return;
  const cb = () => {
    e.handle = 0;
    if (e.disposed) return;
    e.upload = true;
    e.frameHook?.();
    if (e.status === 'loading') setStatus(e, 'playing');
    request();
    arm(e);
  };
  e.handle = hasRvfc ? e.video.requestVideoFrameCallback(cb) : requestAnimationFrame(cb);
}

function disarm(e: Entry): void {
  if (!e.handle) return;
  if (hasRvfc) e.video.cancelVideoFrameCallback(e.handle);
  else cancelAnimationFrame(e.handle);
  e.handle = 0;
}

function refreshActive(e: Entry): void {
  let on = false;
  for (const s of e.sprites) {
    if (s.visible && !(s.base && suspended > 0)) {
      on = true;
      break;
    }
  }
  if (on === e.active) return;
  e.active = on;
  e.setActive?.(on);
}

function finalize(e: Entry): void {
  if (e.disposed && !entries.has(e)) return;
  e.disposed = true;
  disarm(e);
  e.teardown();
  entries.delete(e);
  if (e.tex && gl && !gl.lost && e.gen === generation) gl.gl.deleteTexture(e.tex);
  e.tex = null;
  liveSlots -= 1;
  if (import.meta.env.DEV) window.__fxSlots = liveSlots;
  e.video.removeAttribute('src');
  e.video.load();
  e.video.remove();
  request();
}

function createEntry(host: HTMLElement, layers: readonly FxLayer[]): Entry | null {
  if (!bindFrame(host)) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.hidden = true;
  video.setAttribute('aria-hidden', 'true');
  video.disableRemotePlayback = true;
  host.appendChild(video);

  const e: Entry = {
    video,
    tex: null,
    gen: generation,
    layer: null,
    show: true,
    opacity: 1,
    active: true,
    upload: false,
    handle: 0,
    disposed: false,
    closing: null,
    status: 'loading',
    listeners: new Set(),
    sprites: new Set(),
    frameHook: null,
    setActive: null,
    teardown: () => undefined,
    addSprite(s) {
      e.sprites.add(s);
      refreshActive(e);
      request();
    },
    removeSprite(s) {
      e.sprites.delete(s);
      refreshActive(e);
      request();
    },
    invalidate() {
      refreshActive(e);
      request();
    },
    onStatus(fn) {
      e.listeners.add(fn);
      fn(e.status);
      return () => {
        e.listeners.delete(fn);
      };
    },
    dispose(fadeMs = 0) {
      if (e.disposed || e.closing) return;
      if (fadeMs > 0) {
        e.closing = { start: performance.now(), ms: fadeMs };
        request();
      } else finalize(e);
    },
  };
  liveSlots += 1;
  if (import.meta.env.DEV) window.__fxSlots = liveSlots;
  entries.add(e);
  e.teardown = sequence(e, layers);
  video.addEventListener('playing', () => arm(e));
  video.addEventListener('loadeddata', () => {
    e.upload = true;
    request();
  });
  video.addEventListener('error', () => {
    disarm(e);
    setStatus(e, 'failed');
  });
  return e;
}

/**
 * The Discord layer clock for one video: each non-looping layer hands over to
 * the next when it ends (or at its `duration`); a looping layer repeats, with
 * `loopDelay` of blank between passes, or natively when the delay is 0. The
 * last frame is held across a hand-over so the next clip's first frame replaces it.
 */
function sequence(e: Entry, layers: readonly FxLayer[]): () => void {
  const { video } = e;
  let index = -1;
  let timer = 0;
  let waiting = false;

  const tryPlay = () => {
    if (e.disposed || !e.active || waiting) return;
    void video.play().catch(() => {
      /* muted and inline: always allowed; real failures arrive as the error event */
    });
  };

  const startLayer = (i: number) => {
    const layer = layers[i];
    if (!layer) return;
    index = i;
    e.layer = layer;
    e.show = true;
    video.loop = layer.loop && !(layer.loopDelay && layer.loopDelay > 0);
    const abs = new URL(layer.src, document.baseURI).href;
    if (video.src !== abs) video.src = abs;
    else video.currentTime = 0;
    tryPlay();
    request();
  };

  const endLayer = () => {
    const layer = layers[index];
    if (!layer || e.disposed) return;
    if (layer.loop) {
      e.show = false;
      waiting = true;
      request();
      timer = window.setTimeout(() => {
        waiting = false;
        e.show = true;
        video.currentTime = 0;
        tryPlay();
      }, layer.loopDelay ?? 0);
    } else if (index + 1 < layers.length) {
      startLayer(index + 1);
    } else {
      e.show = false;
      request();
      setStatus(e, 'ended');
    }
  };

  const onEnded = () => endLayer();
  video.addEventListener('ended', onEnded);

  e.frameHook = () => {
    const layer = layers[index];
    if (!layer || video.loop || layer.duration <= 0) return;
    if (video.currentTime * 1000 >= layer.duration) {
      video.pause();
      endLayer();
    }
  };
  e.setActive = (on) => {
    if (on) tryPlay();
    else {
      disarm(e);
      video.pause();
    }
  };

  startLayer(0);
  return () => {
    window.clearTimeout(timer);
    video.removeEventListener('ended', onEnded);
    video.pause();
  };
}

/**
 * A new entry that plays `layers` in order on its own video. Null when the
 * browser has no WebGL2 (the caller falls back to the v5 CSS effect).
 */
export function openEntry(host: HTMLElement, layers: readonly FxLayer[]): FxEntry | null {
  return createEntry(host, layers);
}

/**
 * The entry for a clip shared by many sprites (avatar rings, the words atlas):
 * one video and one texture per src, however many consumers hold it.
 */
export function openSharedEntry(host: HTMLElement, layer: FxLayer): FxEntry | null {
  let slot = shared.get(layer.src);
  if (!slot) {
    const entry = createEntry(host, [layer]);
    if (!entry) return null;
    slot = { entry, refs: 0 };
    shared.set(layer.src, slot);
  }
  slot.refs += 1;
  const held = slot;
  let released = false;
  return {
    get video() {
      return held.entry.video;
    },
    addSprite: (s) => held.entry.addSprite(s),
    removeSprite: (s) => held.entry.removeSprite(s),
    invalidate: () => held.entry.invalidate(),
    onStatus: (fn) => held.entry.onStatus(fn),
    dispose: () => {
      if (released) return;
      released = true;
      held.refs -= 1;
      if (held.refs <= 0) {
        shared.delete(layer.src);
        held.entry.dispose();
      }
    },
  };
}

/* ---- UV helpers -------------------------------------------------------------- */

/**
 * UV rect of one cell of a cols x rows atlas, in colour-half space, trimmed by
 * `gutter` (a fraction of the cell, per edge) plus half a texel so bilinear
 * filtering never samples the neighbouring cell. `videoW` / `videoH` are the
 * whole stacked frame's pixels.
 */
export function cellUv(
  cols: number,
  rows: number,
  col: number,
  row: number,
  videoW: number,
  videoH: number,
  gutter = 0
): FxUv {
  const du = 1 / cols;
  const dv = 1 / rows;
  const tu = du * gutter + 0.5 / videoW;
  const tv = dv * gutter + 1 / videoH;
  return [col * du + tu, row * dv + tv, du - 2 * tu, dv - 2 * tv];
}

/** Pixel aspect (w / h) of a UV rect of a stacked video: the colour half is videoW x videoH / 2. */
export function uvAspect(uv: FxUv, videoW: number, videoH: number): number {
  return (uv[2] * videoW) / (uv[3] * (videoH / 2));
}

/** Crop a UV rect so a source of `srcAspect` covers a destination of `dstAspect` (object-fit: cover). */
export function coverUv(uv: FxUv, srcAspect: number, dstAspect: number): FxUv {
  const [u0, v0, du, dv] = uv;
  if (srcAspect > dstAspect) {
    const f = dstAspect / srcAspect;
    return [u0 + (du * (1 - f)) / 2, v0, du * f, dv];
  }
  const f = srcAspect / dstAspect;
  return [u0, v0 + (dv * (1 - f)) / 2, du, dv * f];
}
