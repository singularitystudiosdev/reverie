// Records in each starter's persona file the assets it actually has on disk:
// art.portrait / portraitSm (profile still), art.loop (profile video),
// art.scene / sceneSm (background). Nothing else: starters have no video
// message and no animated background.
//   node scripts/starters/sync-art.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePersona, serializePersona } from '../../server/src/personas/markdown.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const roster = JSON.parse(fs.readFileSync(path.join(root, 'server/starters/roster.json'), 'utf8')).personas;
const has = (f) => fs.existsSync(path.join(root, 'public/characters', f));
let changed = 0;
const counts = { still: 0, loop: 0, scene: 0 };
for (const r of roster) {
  const file = path.join(root, 'server/personas', `${r.id}.md`);
  if (!fs.existsSync(file)) continue;
  const md = fs.readFileSync(file, 'utf8');
  const p = parsePersona(md);
  const art = {};
  if (has(`${r.id}.webp`)) {
    art.portrait = `/characters/${r.id}.webp`;
    art.portraitSm = `/characters/${r.id}-sm.webp`;
    counts.still++;
  }
  if (has(`${r.id}-loop.mp4`)) {
    art.loop = `/characters/${r.id}-loop.mp4`;
    counts.loop++;
  }
  if (has(`${r.id}-scene.webp`)) {
    art.scene = `/characters/${r.id}-scene.webp`;
    art.sceneSm = `/characters/${r.id}-scene-sm.webp`;
    counts.scene++;
  }
  const next = serializePersona({ ...p, meta: { ...p.meta, art } });
  if (next !== md) {
    fs.writeFileSync(file, next);
    changed++;
  }
}
console.log(`synced ${changed} persona files; on disk: ${counts.still} stills, ${counts.loop} profile videos, ${counts.scene} backgrounds`);
