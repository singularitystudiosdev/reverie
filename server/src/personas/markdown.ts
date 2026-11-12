/**
 * Persona markdown <-> Persona. The frontmatter is a small YAML subset
 * (scalars, inline [a, b] lists, one nested level of maps) so the files stay
 * hand-editable and diff cleanly; parse(serialize(p)) round-trips exactly.
 */
import {
  DESCRIPTOR_KEYS,
  GENDERS,
  lockedBoundaries,
  type PersonaGender,
  type Descriptors,
  type Persona,
  type PersonaArt,
  type PersonaMeta,
  type PersonaSection,
} from './schema.ts';

type Scalar = string | number | boolean | null;
type FrontValue = Scalar | Scalar[] | Record<string, Scalar | Scalar[]>;

/* ------------------------------------------------------------ frontmatter */

function parseScalar(raw: string): Scalar {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    return s.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
  }
  return s;
}

function splitInlineList(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseValue(raw: string): Scalar | Scalar[] {
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) return splitInlineList(s.slice(1, -1)).map(parseScalar);
  return parseScalar(s);
}

/** Strip a trailing ` # comment` that is not inside quotes. */
function stripComment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '#' && (i === 0 || line[i - 1] === ' ')) return line.slice(0, i).trimEnd();
  }
  return line;
}

export function parseFrontmatter(text: string): Record<string, FrontValue> {
  const out: Record<string, FrontValue> = {};
  let nested: Record<string, Scalar | Scalar[]> | null = null;
  for (const rawLine of text.split('\n')) {
    const line = stripComment(rawLine);
    if (!line.trim()) continue;
    const indented = /^\s+/.test(line);
    const m = /^\s*([A-Za-z0-9_]+):\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rest] = m;
    if (indented && nested) {
      nested[key] = parseValue(rest);
    } else if (rest.trim() === '') {
      nested = {};
      out[key] = nested;
    } else {
      nested = null;
      out[key] = parseValue(rest);
    }
  }
  return out;
}

function fmtScalar(v: Scalar): string {
  if (v === null) return 'null';
  if (typeof v !== 'string') return String(v);
  if (v === '' || /^[\s]|[\s]$|[:#\[\]{},"']|^(true|false|null|~|-?\d+(\.\d+)?)$/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}

function fmtValue(v: Scalar | Scalar[]): string {
  return Array.isArray(v) ? `[${v.map(fmtScalar).join(', ')}]` : fmtScalar(v);
}

export function serializeFrontmatter(obj: Record<string, FrontValue>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) if (v2 !== undefined) lines.push(`  ${k2}: ${fmtValue(v2)}`);
    } else lines.push(`${k}: ${fmtValue(v as Scalar | Scalar[])}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------ persona */

const str = (v: unknown, d = ''): string => (v === null || v === undefined ? d : String(v));

export function metaFromFront(f: Record<string, FrontValue>): PersonaMeta {
  const d = (f.descriptors ?? {}) as Record<string, Scalar>;
  const descriptors = Object.fromEntries(DESCRIPTOR_KEYS.map((k) => [k, str(d[k], 'unknown')])) as unknown as Descriptors;
  const artRaw = (f.art ?? {}) as Record<string, Scalar>;
  const art: PersonaArt = {};
  for (const [k, v] of Object.entries(artRaw)) if (v) (art as Record<string, string>)[k] = String(v);
  const cats = Array.isArray(f.categories) ? f.categories.map((c) => str(c)).filter(Boolean) : [];
  return {
    id: str(f.id),
    name: str(f.name),
    version: Number(f.version ?? 1) || 1,
    status: (str(f.status, 'active') as PersonaMeta['status']),
    branch: (str(f.branch, 'seed') as PersonaMeta['branch']),
    parent: f.parent ? str(f.parent) : null,
    created: str(f.created),
    kind: str(f.kind),
    style: str(f.style, 'Fantasy'),
    theme: str(f.theme, 'base'),
    age: str(f.age),
    gender: (GENDERS as string[]).includes(str(f.gender)) ? (str(f.gender) as PersonaGender) : 'female',
    flirt_level: Math.max(0, Math.min(10, Number(f.flirt_level ?? 5) || 0)),
    tagline: str(f.tagline),
    categories: cats,
    descriptors,
    art,
  };
}

export function frontFromMeta(m: PersonaMeta): Record<string, FrontValue> {
  const art: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(m.art)) if (v) art[k] = v;
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    status: m.status,
    branch: m.branch,
    parent: m.parent,
    created: m.created,
    kind: m.kind,
    style: m.style,
    theme: m.theme,
    age: m.age,
    gender: m.gender,
    flirt_level: m.flirt_level,
    tagline: m.tagline,
    categories: m.categories,
    descriptors: { ...m.descriptors } as unknown as Record<string, Scalar>,
    art,
  };
}

export function parsePersona(md: string): Persona {
  const text = md.replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!fm) throw new Error('persona markdown has no frontmatter');
  const meta = metaFromFront(parseFrontmatter(fm[1]));
  const body = text.slice(fm[0].length);
  const parts = body.split(/^## /m);
  const head = parts.shift() ?? '';
  const intro = head.replace(/^# .*\n?/m, '').trim();
  const sections: PersonaSection[] = parts.map((p) => {
    const nl = p.indexOf('\n');
    const title = (nl === -1 ? p : p.slice(0, nl)).trim();
    const sbody = (nl === -1 ? '' : p.slice(nl + 1)).trim();
    return { title, body: sbody, locked: /\(locked\)\s*$/i.test(title) };
  });
  return { meta, intro, sections };
}

export function serializePersona(p: Persona): string {
  const out = [`---\n${serializeFrontmatter(frontFromMeta(p.meta))}\n---`, `# ${p.meta.name}`];
  if (p.intro) out.push(p.intro);
  for (const s of p.sections) out.push(`## ${s.title}\n\n${s.body}`);
  return out.join('\n\n') + '\n';
}

export function getSection(p: Persona, title: string): PersonaSection | undefined {
  const t = title.toLowerCase();
  return p.sections.find((s) => s.title.toLowerCase() === t || s.title.toLowerCase().replace(/\s*\(locked\)\s*$/, '') === t);
}

export function setSection(p: Persona, title: string, body: string): Persona {
  const existing = getSection(p, title);
  if (existing?.locked) throw new Error(`section "${existing.title}" is locked`);
  const sections = existing
    ? p.sections.map((s) => (s === existing ? { ...s, body: body.trim() } : s))
    : insertBefore(p.sections, { title, body: body.trim(), locked: false }, 'Boundaries (locked)');
  return { ...p, sections };
}

function insertBefore(list: PersonaSection[], item: PersonaSection, beforeTitle: string): PersonaSection[] {
  const i = list.findIndex((s) => s.title === beforeTitle);
  if (i === -1) return [...list, item];
  return [...list.slice(0, i), item, ...list.slice(i)];
}

/** Append a dated changelog line and bump the version. */
export function bumpVersion(p: Persona, line: string, date = new Date()): Persona {
  const version = p.meta.version + 1;
  const stamp = date.toISOString().slice(0, 10);
  const entry = `- v${version} ${stamp}: ${line}`;
  const log = getSection(p, 'Changelog');
  const sections = log
    ? p.sections.map((s) => (s === log ? { ...s, body: `${s.body}\n${entry}`.trim() } : s))
    : [...p.sections, { title: 'Changelog', body: entry, locked: false }];
  return { ...p, meta: { ...p.meta, version }, sections };
}

/** Guarantee the locked boundaries are present and canonical (repairs a hand edit that dropped them). */
export function ensureBoundaries(p: Persona): Persona {
  const body = lockedBoundaries(p.meta.name, p.meta.gender);
  const existing = p.sections.find((s) => s.locked);
  if (existing && existing.body === body) return p;
  const without = p.sections.filter((s) => !s.locked);
  return { ...p, sections: insertBefore(without, { title: 'Boundaries (locked)', body, locked: true }, 'Changelog') };
}
