// Builds the three generation prompts per starter persona (profile still,
// profile video, background) from server/starters/roster.json and writes
// server/starters/prompts.json, kept beside the roster as provenance.
//   node scripts/starters/prompts.mjs
import fs from 'node:fs';
// The builder is shared with the server's art job (server/src/art/prompts.ts), so a
// persona the server invents is drawn the same way a starter is.
import { buildPrompts } from '../../server/src/art/prompts.ts';

const roster = JSON.parse(fs.readFileSync('server/starters/roster.json', 'utf8')).personas;

const out = {};
for (const p of roster) {
  out[p.id] = buildPrompts({
    name: p.name,
    kind: p.kind,
    style: p.style,
    age: p.age,
    gender: p.gender,
    form: p.d.form,
    look: p.look,
    scene: p.scene,
    spicy: p.group === 'spicy',
  });
}
fs.writeFileSync('server/starters/prompts.json', JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${Object.keys(out).length} prompt sets`);
