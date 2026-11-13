/**
 * The persona registry: every `personas/*.md` file, loaded, validated and kept
 * in memory. Writes go through `save()`, which rewrites the file atomically,
 * records the full text in `persona_versions`, and keeps the in-memory copy in
 * step. The markdown file is the one global definition of each persona.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db.ts';
import { bumpVersion, ensureBoundaries, parsePersona, serializePersona } from './markdown.ts';
import { ageIsAdult, lintPersonaText } from './safety.ts';
import { lookProblems, type Persona, type PersonaStatus } from './schema.ts';

export class PersonaRegistry {
  private byId = new Map<string, Persona>();
  readonly dir: string;
  private db: DB;
  private now: () => number;

  constructor(dir: string, db: DB, now: () => number = Date.now) {
    this.dir = dir;
    this.db = db;
    this.now = now;
  }

  load(): this {
    fs.mkdirSync(this.dir, { recursive: true });
    this.byId.clear();
    for (const f of fs.readdirSync(this.dir).sort()) {
      if (!f.endsWith('.md') || f.startsWith('_') || f.toUpperCase() === 'README.MD') continue;
      const file = path.join(this.dir, f);
      const md = fs.readFileSync(file, 'utf8');
      let p: Persona;
      try {
        p = parsePersona(md);
      } catch (e) {
        console.warn(`[personas] skipped ${f}: ${(e as Error).message}`);
        continue;
      }
      const problems = validate(p);
      if (problems.length) {
        console.warn(`[personas] ${p.meta.id} quarantined as draft: ${problems.join('; ')}`);
        p = { ...p, meta: { ...p.meta, status: 'draft' } };
      }
      const repaired = ensureBoundaries(p);
      this.byId.set(p.meta.id, repaired);
      this.recordVersion(repaired, 'loaded from disk', false);
    }
    return this;
  }

  all(): Persona[] {
    return [...this.byId.values()];
  }

  get(id: string): Persona | undefined {
    return this.byId.get(id);
  }

  /** Personas the feed may serve. Fading personas are still served, at a decaying rate. */
  servable(): Persona[] {
    return this.all().filter((p) => p.meta.status === 'active' || p.meta.status === 'fading');
  }

  active(): Persona[] {
    return this.all().filter((p) => p.meta.status === 'active');
  }

  file(id: string): string {
    return path.join(this.dir, `${id}.md`);
  }

  /** Validate, write the file atomically, version it in the DB. */
  save(p: Persona, reason: string): Persona {
    const problems = validate(p);
    if (problems.length) throw new Error(`refusing to save ${p.meta.id}: ${problems.join('; ')}`);
    const fixed = ensureBoundaries(p);
    const md = serializePersona(fixed);
    const file = this.file(fixed.meta.id);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, md);
    fs.renameSync(tmp, file);
    this.byId.set(fixed.meta.id, fixed);
    this.recordVersion(fixed, reason, true);
    return fixed;
  }

  /** Change status (fade, retire, activate) with a changelog line and a version bump. */
  setStatus(id: string, status: PersonaStatus, why: string, now = Date.now()): Persona | undefined {
    const p = this.get(id);
    if (!p || p.meta.status === status) return p;
    const next = bumpVersion({ ...p, meta: { ...p.meta, status } }, `status ${p.meta.status} -> ${status}: ${why}`, new Date(now));
    return this.save(next, `status ${status}`);
  }

  private recordVersion(p: Persona, reason: string, overwrite: boolean): void {
    const md = serializePersona(p);
    const sql = overwrite
      ? 'INSERT OR REPLACE INTO persona_versions (persona_id, version, ts, reason, md) VALUES (?, ?, ?, ?, ?)'
      : 'INSERT OR IGNORE INTO persona_versions (persona_id, version, ts, reason, md) VALUES (?, ?, ?, ?, ?)';
    this.db.prepare(sql).run(p.meta.id, p.meta.version, this.now(), reason, md);
    // The gate's clock for this persona starts when it can first be served.
    if (p.meta.status === 'active' || p.meta.status === 'fading') {
      this.db.prepare('INSERT OR IGNORE INTO persona_state (persona_id, first_seen_at) VALUES (?, ?)').run(p.meta.id, this.now());
      this.db.prepare('UPDATE persona_state SET first_seen_at = ? WHERE persona_id = ? AND first_seen_at IS NULL').run(this.now(), p.meta.id);
    } else this.db.prepare('INSERT OR IGNORE INTO persona_state (persona_id, first_seen_at) VALUES (?, NULL)').run(p.meta.id);
  }
}

export function validate(p: Persona): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(p.meta.id)) out.push(`bad id "${p.meta.id}"`);
  if (!p.meta.name) out.push('missing name');
  if (!ageIsAdult(p.meta.age)) out.push(`age "${p.meta.age}" does not read as an adult`);
  if (!p.meta.categories.length) out.push('no categories');
  out.push(...lookProblems(p.meta.look));
  const issues = lintPersonaText(serializePersona(p));
  for (const i of issues) out.push(`lint ${i.rule}: "${i.match}"`);
  return out;
}
