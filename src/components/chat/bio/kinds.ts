/** The eighteen word effects a bio can tag: `{kind:words}`. */
export const FX_KINDS = [
  'bats',
  'petals',
  'fireflies',
  'bubbles',
  'embers',
  'frost',
  'neon',
  'stars',
  'foxfire',
  'smoke',
  'feathers',
  'sand',
  'sparks',
  'butterflies',
  'bokeh',
  'glow',
  'gradient',
  'shimmer',
] as const;

export type FxKind = (typeof FX_KINDS)[number];

export function isFxKind(value: string): value is FxKind {
  return (FX_KINDS as readonly string[]).includes(value);
}

/**
 * Each character may own one signature effect: a tag whose kind is her id,
 * `{vesper:words}`, rendered by bio/custom/<id>.tsx when that file exists
 * (see bio/index.tsx) and by Glow until then.
 */
export const CHARACTER_FX_IDS = [
  'sylvara',
  'vesper',
  'hanami',
  'nerissa',
  'cinder',
  'isolde',
  'nova',
  'luna',
  'clementine',
  'maya',
  'kiyo',
  'zahra',
  'raven',
  'ada',
] as const;

export type CharacterFxId = (typeof CHARACTER_FX_IDS)[number];

export function isCharacterFxId(value: string): value is CharacterFxId {
  return (CHARACTER_FX_IDS as readonly string[]).includes(value);
}

export type BioSegment = { type: 'text'; text: string } | { type: 'fx'; kind: FxKind | CharacterFxId; text: string };

const TAG = /\{([a-z]+):([^{}]+)\}/g;

/**
 * Split a bio into plain runs and tagged phrases. A tag whose kind is not one
 * of the eighteen or a character id stays plain text (the words, without the braces), so a typo
 * in the copy never shows markup to the reader.
 */
export function parseBio(raw: string): BioSegment[] {
  const out: BioSegment[] = [];
  let last = 0;
  for (const m of raw.matchAll(TAG)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: 'text', text: raw.slice(last, at) });
    const kind = m[1] ?? '';
    const text = (m[2] ?? '').trim();
    if (isFxKind(kind) || isCharacterFxId(kind)) out.push({ type: 'fx', kind, text });
    else out.push({ type: 'text', text });
    last = at + m[0].length;
  }
  if (last < raw.length) out.push({ type: 'text', text: raw.slice(last) });
  return out;
}
