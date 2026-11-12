// Turns face boxes (faces.swift output on stdin or a file) into round-avatar crops
// with the same maths as cropFor() in src/data/characters.ts: the face (or the
// group's faces) centred, filling about half of the circle. Writes
// .tmp/starters-raw/faces.json for export.mjs.
//   swift scripts/starters/faces.swift public/characters/*.webp | node scripts/starters/crops.mjs
import fs from 'node:fs';

const W = 357;
const H = 640;
const aspect = H / W;
const boxes = JSON.parse(fs.readFileSync(0, 'utf8'));
const pct = (n) => `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`;
const out = {};
for (const [id, b] of Object.entries(boxes)) {
  if (id.endsWith('-sm') || id.includes('-scene')) continue;
  const fx = b.x + b.w / 2;
  const fy = b.y + b.h / 2;
  // Face height as a share of the circle's diameter (W / zoom, in image-width units).
  const target = b.n > 1 ? 0.8 : 0.5;
  const faceSpan = Math.max(b.h * aspect, b.w);
  // Clamped to the range the launch roster's hand-tuned crops use (anime faces box small in Vision).
  const zoom = b.n > 1 ? Math.min(2.2, Math.max(1.4, target / faceSpan)) : Math.min(2.8, Math.max(2.0, target / faceSpan));
  const ox = (zoom * fx - 0.5) / (zoom - 1);
  const oy = (aspect * zoom * fy - 0.5) / (aspect * zoom - 1);
  out[id] = { position: `${pct(ox)} ${pct(oy)}`, scale: Math.round(zoom * 100) / 100 };
}
fs.mkdirSync('.tmp/starters-raw', { recursive: true });
fs.writeFileSync('.tmp/starters-raw/faces.json', JSON.stringify(out, null, 1));
console.log(`crops for ${Object.keys(out).length} portraits`);
