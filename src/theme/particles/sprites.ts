/*
  Procedural sprites, pre-rendered once per kind, colour, variant, frame and
  device-pixel size onto off-DOM canvases (never drawn per frame). Every
  shape is drawn by hand here: a leaf with a midrib and side veins, a five
  lobed maple leaf, a notched cherry petal, a cupped rose petal, an ember with
  a white-hot core, three snowflakes, a bubble with rim and highlight, a
  twinkling star, a shooting-star streak, a bat in two flap frames, a firefly,
  a sand grain, a foxfire wisp, a bokeh disc, a butterfly in two flap frames,
  glyphs, a pollen mote, a feather, a toothed gear, a steam puff and a
  four-point sparkle. Rain is a batched stroke in the field, not a sprite.
*/
import type { ParticleKind } from '../../data/types';
import { kinds } from './kinds';

export interface Sprite {
  img: HTMLCanvasElement;
  /** Draw box in CSS px at scale 1. */
  w: number;
  h: number;
}

type RGB = [number, number, number];

export function parseColor(c: string): RGB {
  if (c.startsWith('#')) {
    const h = c.slice(1);
    const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [255, 255, 255];
  const p = m[1].split(',').map((s) => parseFloat(s));
  return [p[0], p[1], p[2]];
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rgba(c: RGB, a: number): string {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
}

const light = (c: RGB, t: number) => mix(c, WHITE, t);
const dark = (c: RGB, t: number) => mix(c, BLACK, t);

type Ctx = CanvasRenderingContext2D;

/* ------------------------------------------------------------- the shapes */

function leaf(ctx: Ctx, R: number, c: RGB, v: number): void {
  const wv = [0.46, 0.56, 0.38][v] ?? 0.46;
  const bend = [0.08, -0.06, 0.16][v] ?? 0;
  ctx.rotate(bend);
  const grad = ctx.createLinearGradient(-wv * R, 0, wv * R, 0);
  grad.addColorStop(0, rgba(light(c, 0.22), 1));
  grad.addColorStop(0.5, rgba(c, 1));
  grad.addColorStop(1, rgba(dark(c, 0.3), 1));
  ctx.beginPath();
  ctx.moveTo(0, -0.95 * R);
  ctx.bezierCurveTo(wv * R * 1.3, -0.55 * R, wv * R * 1.15, 0.42 * R, 0, 0.74 * R);
  ctx.bezierCurveTo(-wv * R * 1.15, 0.42 * R, -wv * R * 1.3, -0.55 * R, 0, -0.95 * R);
  ctx.fillStyle = grad;
  ctx.fill();
  // Midrib and stem, then four pairs of side veins.
  ctx.strokeStyle = rgba(light(c, 0.45), 0.75);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.055 * R;
  ctx.beginPath();
  ctx.moveTo(0, -0.82 * R);
  ctx.quadraticCurveTo(0.03 * R, 0.1 * R, 0, 0.98 * R);
  ctx.stroke();
  ctx.lineWidth = 0.035 * R;
  for (let i = 0; i < 4; i++) {
    const y = -0.52 * R + i * 0.28 * R;
    const reach = wv * R * (0.85 - Math.abs(i - 1.2) * 0.12);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.1 * R);
      ctx.quadraticCurveTo(s * reach * 0.5, y, s * reach, y - 0.18 * R);
      ctx.stroke();
    }
  }
}

function maple(ctx: Ctx, R: number, c: RGB, v: number): void {
  const lobes = v === 0
    ? [[-Math.PI / 2, 1], [-Math.PI / 2 + 1.05, 0.88], [-Math.PI / 2 - 1.05, 0.88], [0.45, 0.58], [Math.PI - 0.45, 0.58]]
    : [[-Math.PI / 2, 0.95], [-Math.PI / 2 + 1.15, 0.92], [-Math.PI / 2 - 1.15, 0.92], [0.55, 0.52], [Math.PI - 0.55, 0.52]];
  const pts = 120;
  const grad = ctx.createRadialGradient(0, 0.15 * R, 0, 0, 0.15 * R, R);
  grad.addColorStop(0, rgba(light(c, 0.2), 1));
  grad.addColorStop(0.6, rgba(c, 1));
  grad.addColorStop(1, rgba(dark(c, 0.25), 1));
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const th = (i / pts) * Math.PI * 2;
    let r = 0.26;
    for (const [a, l] of lobes) r += l * Math.pow(Math.max(0, Math.cos(th - a)), 10);
    r += 0.05 * Math.abs(Math.sin(th * 11)); // serrated edge
    r = Math.min(r, 0.97);
    const x = Math.cos(th) * r * R;
    const y = Math.sin(th) * r * R + 0.12 * R;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = rgba(light(c, 0.4), 0.65);
  ctx.lineWidth = 0.04 * R;
  ctx.lineCap = 'round';
  for (const [a, l] of lobes) {
    ctx.beginPath();
    ctx.moveTo(0, 0.12 * R);
    ctx.lineTo(Math.cos(a) * l * 0.85 * R, Math.sin(a) * l * 0.85 * R + 0.12 * R);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(dark(c, 0.3), 1);
  ctx.lineWidth = 0.05 * R;
  ctx.beginPath();
  ctx.moveTo(0, 0.12 * R);
  ctx.lineTo(0.04 * R, 0.98 * R);
  ctx.stroke();
}

function petal(ctx: Ctx, R: number, c: RGB, v: number): void {
  const w = v === 0 ? 0.86 : 0.7;
  const grad = ctx.createRadialGradient(0, 0.7 * R, 0, 0, 0.2 * R, R * 1.1);
  grad.addColorStop(0, rgba(light(c, 0.6), 1));
  grad.addColorStop(0.55, rgba(c, 1));
  grad.addColorStop(1, rgba(dark(c, 0.08), 1));
  ctx.beginPath();
  ctx.moveTo(0, 0.92 * R);
  ctx.bezierCurveTo(-w * R, 0.35 * R, -w * R, -0.7 * R, -0.42 * R, -0.9 * R);
  ctx.quadraticCurveTo(-0.15 * R, -0.95 * R, 0, -0.62 * R); // the notch
  ctx.quadraticCurveTo(0.15 * R, -0.95 * R, 0.42 * R, -0.9 * R);
  ctx.bezierCurveTo(w * R, -0.7 * R, w * R, 0.35 * R, 0, 0.92 * R);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = rgba(dark(c, 0.12), 0.35);
  ctx.lineWidth = 0.04 * R;
  ctx.beginPath();
  ctx.moveTo(0, 0.85 * R);
  ctx.lineTo(0, -0.35 * R);
  ctx.stroke();
}

function rose(ctx: Ctx, R: number, c: RGB, v: number): void {
  const tilt = v === 0 ? 0 : 0.18;
  ctx.rotate(tilt);
  const grad = ctx.createRadialGradient(0, 0.45 * R, 0, 0, 0.1 * R, R);
  grad.addColorStop(0, rgba(dark(c, 0.45), 1));
  grad.addColorStop(0.55, rgba(c, 1));
  grad.addColorStop(1, rgba(light(c, 0.12), 1));
  ctx.beginPath();
  ctx.moveTo(0, 0.88 * R);
  ctx.bezierCurveTo(-0.7 * R, 0.6 * R, -1.0 * R, -0.1 * R, -0.82 * R, -0.52 * R);
  ctx.bezierCurveTo(-0.55 * R, -0.95 * R, -0.15 * R, -0.78 * R, 0, -0.92 * R);
  ctx.bezierCurveTo(0.2 * R, -1.02 * R, 0.62 * R, -0.9 * R, 0.84 * R, -0.5 * R);
  ctx.bezierCurveTo(1.0 * R, -0.1 * R, 0.7 * R, 0.6 * R, 0, 0.88 * R);
  ctx.fillStyle = grad;
  ctx.fill();
  // The curled rim catches light.
  ctx.strokeStyle = rgba(light(c, 0.4), 0.6);
  ctx.lineWidth = 0.07 * R;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-0.72 * R, -0.55 * R);
  ctx.bezierCurveTo(-0.45 * R, -0.85 * R, -0.12 * R, -0.7 * R, 0, -0.82 * R);
  ctx.bezierCurveTo(0.2 * R, -0.92 * R, 0.55 * R, -0.8 * R, 0.72 * R, -0.5 * R);
  ctx.stroke();
}

function glowDisc(ctx: Ctx, R: number, core: RGB, c: RGB, stops: readonly [number, number][]): void {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, rgba(core, 1));
  for (const [at, a] of stops) g.addColorStop(at, rgba(c, a));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
}

function ember(ctx: Ctx, R: number, c: RGB): void {
  glowDisc(ctx, R, light(c, 0.85), c, [[0.16, 1], [0.32, 0.6], [0.6, 0.18]]);
}

function snow(ctx: Ctx, R: number, c: RGB, v: number): void {
  if (v === 0) {
    glowDisc(ctx, R, c, c, [[0.35, 0.85], [0.6, 0.3]]);
    return;
  }
  if (v === 2) {
    glowDisc(ctx, R * 0.6, c, c, [[0.5, 0.9], [0.8, 0.4]]);
    return;
  }
  glowDisc(ctx, R, c, c, [[0.15, 0.3], [0.5, 0.08]]);
  ctx.strokeStyle = rgba(c, 0.95);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.09 * R;
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -0.86 * R);
    ctx.moveTo(0, -0.5 * R);
    ctx.lineTo(0.22 * R, -0.68 * R);
    ctx.moveTo(0, -0.5 * R);
    ctx.lineTo(-0.22 * R, -0.68 * R);
    ctx.stroke();
    ctx.restore();
  }
}

function bubble(ctx: Ctx, R: number, c: RGB): void {
  const r = 0.9 * R;
  const body = ctx.createRadialGradient(-0.2 * r, -0.25 * r, 0, 0, 0, r);
  body.addColorStop(0, rgba(c, 0.04));
  body.addColorStop(0.75, rgba(c, 0.1));
  body.addColorStop(1, rgba(c, 0.32));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(light(c, 0.3), 0.7);
  ctx.lineWidth = 0.07 * R;
  ctx.stroke();
  ctx.strokeStyle = rgba(WHITE, 0.85);
  ctx.lineWidth = 0.1 * R;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, 0.66 * r, Math.PI * 1.08, Math.PI * 1.42);
  ctx.stroke();
  ctx.fillStyle = rgba(WHITE, 0.95);
  ctx.beginPath();
  ctx.arc(-0.42 * r, -0.46 * r, 0.09 * r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(WHITE, 0.35);
  ctx.lineWidth = 0.06 * R;
  ctx.beginPath();
  ctx.arc(0, 0, 0.7 * r, Math.PI * 0.15, Math.PI * 0.42);
  ctx.stroke();
}

function star(ctx: Ctx, R: number, c: RGB, v: number): void {
  glowDisc(ctx, R * (v === 0 ? 1 : 0.6), WHITE, c, [[0.14, 0.95], [0.32, 0.35], [0.6, 0.08]]);
  if (v !== 0) return;
  ctx.fillStyle = rgba(light(c, 0.4), 0.8);
  for (const rot of [0, Math.PI / 2]) {
    ctx.save();
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -R);
    ctx.lineTo(0.05 * R, 0);
    ctx.lineTo(0, R);
    ctx.lineTo(-0.05 * R, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function shootingStar(ctx: Ctx, R: number, c: RGB, aspect: number): void {
  const h = R * aspect;
  const head = 0.86 * R;
  const g = ctx.createLinearGradient(-R, 0, head, 0);
  g.addColorStop(0, rgba(c, 0));
  g.addColorStop(0.65, rgba(c, 0.35));
  g.addColorStop(1, rgba(light(c, 0.8), 0.95));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.lineTo(head, -0.45 * h);
  ctx.arc(head, 0, 0.45 * h, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.translate(head, 0);
  glowDisc(ctx, h * 0.95, WHITE, light(c, 0.5), [[0.3, 0.8], [0.6, 0.25]]);
  ctx.restore();
}

function bat(ctx: Ctx, R: number, c: RGB, frame: number): void {
  const up = frame === 0;
  const tipY = up ? -0.52 * R : 0.42 * R;
  const lead = up ? -0.56 * R : 0.02 * R;
  ctx.fillStyle = rgba(c, 1);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.08 * R, -0.08 * R);
    ctx.quadraticCurveTo(s * 0.5 * R, lead, s * 0.97 * R, tipY);
    // Scalloped trailing edge, three fingers back to the body.
    const back = up ? 0.12 : 0.28;
    ctx.quadraticCurveTo(s * 0.82 * R, (tipY / R + back) * R * 0.5, s * 0.7 * R, (up ? -0.12 : 0.34) * R);
    ctx.quadraticCurveTo(s * 0.58 * R, (up ? -0.06 : 0.2) * R, s * 0.44 * R, (up ? 0.02 : 0.3) * R);
    ctx.quadraticCurveTo(s * 0.32 * R, (up ? 0.04 : 0.16) * R, s * 0.18 * R, (up ? 0.16 : 0.22) * R);
    ctx.lineTo(s * 0.06 * R, 0.14 * R);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0.04 * R, 0.11 * R, 0.2 * R, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -0.18 * R, 0.09 * R, 0, Math.PI * 2);
  ctx.moveTo(-0.08 * R, -0.22 * R);
  ctx.lineTo(-0.06 * R, -0.36 * R);
  ctx.lineTo(-0.01 * R, -0.24 * R);
  ctx.moveTo(0.08 * R, -0.22 * R);
  ctx.lineTo(0.06 * R, -0.36 * R);
  ctx.lineTo(0.01 * R, -0.24 * R);
  ctx.fill();
  // A faint rim light so the silhouette reads on near-black skies.
  ctx.strokeStyle = rgba(light(c, 0.35), 0.35);
  ctx.lineWidth = 0.03 * R;
  ctx.stroke();
}

function firefly(ctx: Ctx, R: number, c: RGB): void {
  glowDisc(ctx, R, light(c, 0.8), c, [[0.1, 1], [0.22, 0.55], [0.5, 0.14]]);
}

function sand(ctx: Ctx, R: number, c: RGB): void {
  const g = ctx.createRadialGradient(-0.2 * R, -0.2 * R, 0, 0, 0, 0.75 * R);
  g.addColorStop(0, rgba(light(c, 0.3), 1));
  g.addColorStop(1, rgba(dark(c, 0.15), 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 0.7 * R, 0, Math.PI * 2);
  ctx.fill();
}

function wisp(ctx: Ctx, R: number, c: RGB, aspect: number): void {
  const H = R * aspect;
  ctx.save();
  ctx.translate(0, 0.3 * H);
  glowDisc(ctx, R, c, c, [[0.2, 0.3], [0.6, 0.08]]);
  ctx.restore();
  const g = ctx.createRadialGradient(0, 0.42 * H, 0, 0, 0.2 * H, H);
  g.addColorStop(0, rgba(light(c, 0.9), 1));
  g.addColorStop(0.3, rgba(light(c, 0.3), 0.9));
  g.addColorStop(0.7, rgba(c, 0.35));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -0.95 * H);
  ctx.bezierCurveTo(0.2 * R, -0.45 * H, 0.62 * R, 0.05 * H, 0.42 * R, 0.5 * H);
  ctx.bezierCurveTo(0.3 * R, 0.82 * H, -0.3 * R, 0.82 * H, -0.42 * R, 0.5 * H);
  ctx.bezierCurveTo(-0.62 * R, 0.05 * H, -0.1 * R, -0.35 * H, 0, -0.95 * H);
  ctx.fill();
}

function bokeh(ctx: Ctx, R: number, c: RGB): void {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.96 * R);
  g.addColorStop(0, rgba(c, 0.34));
  g.addColorStop(0.72, rgba(c, 0.28));
  g.addColorStop(0.9, rgba(light(c, 0.2), 0.42));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 0.96 * R, 0, Math.PI * 2);
  ctx.fill();
}

function butterfly(ctx: Ctx, R: number, c: RGB, frame: number): void {
  const edge = dark(c, 0.55);
  ctx.save();
  if (frame === 1) ctx.scale(0.32, 1);
  for (const s of [-1, 1]) {
    // Upper wing
    ctx.beginPath();
    ctx.moveTo(0, -0.1 * R);
    ctx.bezierCurveTo(s * 0.35 * R, -0.85 * R, s * 1.0 * R, -0.75 * R, s * 0.92 * R, -0.3 * R);
    ctx.quadraticCurveTo(s * 0.7 * R, 0.02 * R, 0, 0.02 * R);
    ctx.fillStyle = rgba(c, 1);
    ctx.fill();
    ctx.strokeStyle = rgba(edge, 0.9);
    ctx.lineWidth = 0.08 * R;
    ctx.stroke();
    // Lower wing
    ctx.beginPath();
    ctx.moveTo(0, 0.02 * R);
    ctx.bezierCurveTo(s * 0.62 * R, 0.08 * R, s * 0.72 * R, 0.6 * R, s * 0.32 * R, 0.62 * R);
    ctx.quadraticCurveTo(s * 0.1 * R, 0.55 * R, 0, 0.18 * R);
    ctx.fillStyle = rgba(light(c, 0.12), 1);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(WHITE, 0.9);
    ctx.beginPath();
    ctx.arc(s * 0.72 * R, -0.42 * R, 0.07 * R, 0, Math.PI * 2);
    ctx.arc(s * 0.56 * R, -0.56 * R, 0.05 * R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = rgba(edge, 1);
  ctx.beginPath();
  ctx.ellipse(0, 0.06 * R, 0.06 * R, 0.34 * R, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(edge, 1);
  ctx.lineWidth = 0.03 * R;
  ctx.beginPath();
  ctx.moveTo(-0.02 * R, -0.26 * R);
  ctx.quadraticCurveTo(-0.12 * R, -0.5 * R, -0.2 * R, -0.58 * R);
  ctx.moveTo(0.02 * R, -0.26 * R);
  ctx.quadraticCurveTo(0.12 * R, -0.5 * R, 0.2 * R, -0.58 * R);
  ctx.stroke();
}

const GLYPHS = ['ア', 'カ', 'サ', 'ネ', 'ム', 'ヨ', 'ロ', '7', 'ﾘ', 'ヲ'];

function glyph(ctx: Ctx, R: number, c: RGB, v: number): void {
  ctx.font = `${Math.round(R * 1.35)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = rgba(c, 0.9);
  ctx.shadowBlur = R * 0.45;
  ctx.fillStyle = rgba(light(c, 0.35), 1);
  ctx.fillText(GLYPHS[v % GLYPHS.length], 0, 0);
  ctx.shadowBlur = 0;
  ctx.fillText(GLYPHS[v % GLYPHS.length], 0, 0);
}

function pollen(ctx: Ctx, R: number, c: RGB): void {
  glowDisc(ctx, R, light(c, 0.7), c, [[0.25, 0.85], [0.5, 0.3]]);
}

function feather(ctx: Ctx, R: number, c: RGB, v: number): void {
  const w = v === 0 ? 0.4 : 0.32;
  ctx.rotate(v === 0 ? 0.12 : -0.1);
  const g = ctx.createLinearGradient(-w * R, 0, w * R, 0);
  g.addColorStop(0, rgba(light(c, 0.18), 1));
  g.addColorStop(0.5, rgba(c, 1));
  g.addColorStop(1, rgba(light(c, 0.1), 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0.02 * R, -0.95 * R);
  ctx.bezierCurveTo(w * R * 1.4, -0.6 * R, w * R * 1.2, 0.3 * R, 0.04 * R, 0.62 * R);
  ctx.bezierCurveTo(-w * R * 1.1, 0.35 * R, -w * R * 1.1, -0.55 * R, 0.02 * R, -0.95 * R);
  ctx.fill();
  // Barbs: fine strokes off the shaft, and the shaft with its sheen.
  ctx.strokeStyle = rgba(light(c, 0.35), 0.35);
  ctx.lineWidth = 0.022 * R;
  for (let i = 0; i < 9; i++) {
    const y = -0.75 * R + i * 0.15 * R;
    ctx.beginPath();
    ctx.moveTo(0.03 * R, y + 0.08 * R);
    ctx.lineTo(w * R * 0.95, y - 0.05 * R);
    ctx.moveTo(0.03 * R, y + 0.08 * R);
    ctx.lineTo(-w * R * 0.85, y - 0.03 * R);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(light(c, 0.55), 0.8);
  ctx.lineWidth = 0.045 * R;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0.02 * R, -0.9 * R);
  ctx.quadraticCurveTo(0.1 * R, 0, 0, 0.96 * R);
  ctx.stroke();
}

function gear(ctx: Ctx, R: number, c: RGB, v: number): void {
  const teeth = v === 0 ? 10 : 14;
  const ro = 0.95 * R;
  const ri = 0.78 * R;
  const g = ctx.createLinearGradient(-R, -R, R, R);
  g.addColorStop(0, rgba(light(c, 0.3), 1));
  g.addColorStop(0.55, rgba(c, 1));
  g.addColorStop(1, rgba(dark(c, 0.3), 1));
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    ctx.lineTo(Math.cos(a0) * ri, Math.sin(a0) * ri);
    ctx.lineTo(Math.cos(a0 + step * 0.18) * ro, Math.sin(a0 + step * 0.18) * ro);
    ctx.lineTo(Math.cos(a0 + step * 0.5) * ro, Math.sin(a0 + step * 0.5) * ro);
    ctx.lineTo(Math.cos(a0 + step * 0.68) * ri, Math.sin(a0 + step * 0.68) * ri);
  }
  ctx.closePath();
  // Hub hole and lightening holes cut with even-odd.
  ctx.moveTo(0.24 * R, 0);
  ctx.arc(0, 0, 0.24 * R, 0, Math.PI * 2);
  const holes = v === 0 ? 5 : 6;
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * Math.PI * 2;
    const cx = Math.cos(a) * 0.52 * R;
    const cy = Math.sin(a) * 0.52 * R;
    ctx.moveTo(cx + 0.12 * R, cy);
    ctx.arc(cx, cy, 0.12 * R, 0, Math.PI * 2);
  }
  ctx.fillStyle = g;
  ctx.fill('evenodd');
  ctx.strokeStyle = rgba(dark(c, 0.4), 0.8);
  ctx.lineWidth = 0.035 * R;
  ctx.stroke();
}

function steam(ctx: Ctx, R: number, c: RGB, v: number): void {
  const puffs = v === 0
    ? [[-0.35, 0.15, 0.55], [0.3, 0.1, 0.6], [0, -0.25, 0.6], [0.05, 0.35, 0.5]]
    : [[-0.25, -0.1, 0.6], [0.32, -0.2, 0.5], [0.1, 0.25, 0.62], [-0.4, 0.3, 0.42]];
  for (const [x, y, r] of puffs) {
    const g = ctx.createRadialGradient(x * R, y * R, 0, x * R, y * R, r * R);
    g.addColorStop(0, rgba(c, 0.5));
    g.addColorStop(0.6, rgba(c, 0.22));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x * R, y * R, r * R, 0, Math.PI * 2);
    ctx.fill();
  }
}

function sparkle(ctx: Ctx, R: number, c: RGB): void {
  glowDisc(ctx, R * 0.55, light(c, 0.6), c, [[0.3, 0.45], [0.7, 0.1]]);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, rgba(WHITE, 1));
  g.addColorStop(0.35, rgba(light(c, 0.4), 1));
  g.addColorStop(1, rgba(c, 0.55));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -R);
  ctx.quadraticCurveTo(0.1 * R, -0.1 * R, R, 0);
  ctx.quadraticCurveTo(0.1 * R, 0.1 * R, 0, R);
  ctx.quadraticCurveTo(-0.1 * R, 0.1 * R, -R, 0);
  ctx.quadraticCurveTo(-0.1 * R, -0.1 * R, 0, -R);
  ctx.fill();
}

/* ------------------------------------------------------------------ atlas */

const SPRITE_CAP = 64;
const SPRITE_CAP_BOKEH = 90;

const cache = new Map<string, Sprite>();

/** A sprite, rendered on first request and cached for the session. */
export function sprite(kind: ParticleKind, color: string, variant: number, frame: number, size: number, dpr: number): Sprite {
  const d = kinds[kind];
  // Sprites stay <= 64 CSS px (90 for bokeh); particles only ever draw at or below this box.
  const w = Math.min(kind === 'bokeh' ? SPRITE_CAP_BOKEH : SPRITE_CAP, Math.max(2, d.px * size));
  const h = w * d.aspect;
  // Rendered in device pixels, so the largest draw is 1:1.
  const res = Math.min(4, dpr);
  const key = `${kind}|${color}|${variant}|${frame}|${w.toFixed(1)}|${res.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = document.createElement('canvas');
  img.width = Math.max(1, Math.ceil(w * res));
  img.height = Math.max(1, Math.ceil(h * res));
  const ctx = img.getContext('2d');
  const out: Sprite = { img, w, h };
  cache.set(key, out);
  if (!ctx) return out;
  ctx.translate(img.width / 2, img.height / 2);
  const R = img.width / 2;
  const c = parseColor(color);
  ctx.save();
  switch (kind) {
    case 'leaf': leaf(ctx, R, c, variant); break;
    case 'maple': maple(ctx, R, c, variant); break;
    case 'petal': petal(ctx, R, c, variant); break;
    case 'rose': rose(ctx, R, c, variant); break;
    case 'ember': ember(ctx, R, c); break;
    case 'snow': snow(ctx, R, c, variant); break;
    case 'bubble': bubble(ctx, R, c); break;
    case 'star': star(ctx, R, c, variant); break;
    case 'shootingStar': shootingStar(ctx, R, c, d.aspect); break;
    case 'bat': bat(ctx, R, c, frame); break;
    case 'firefly': firefly(ctx, R, c); break;
    case 'sand': sand(ctx, R, c); break;
    case 'wisp': wisp(ctx, R, c, d.aspect); break;
    case 'bokeh': bokeh(ctx, R, c); break;
    case 'butterfly': butterfly(ctx, R, c, frame); break;
    case 'glyph': glyph(ctx, R, c, variant); break;
    case 'pollen': pollen(ctx, R, c); break;
    case 'feather': feather(ctx, R, c, variant); break;
    case 'gear': gear(ctx, R, c, variant); break;
    case 'steam': steam(ctx, R, c, variant); break;
    case 'sparkle': sparkle(ctx, R, c); break;
    case 'rain': break;
  }
  ctx.restore();
  return out;
}
