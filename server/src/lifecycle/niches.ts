/**
 * The descriptor space new personas are drawn from, and the MAP-Elites
 * archive over it (Mouret & Clune 2015, "Illuminating search spaces by
 * mapping elites", arXiv 1504.04909): each niche is a combination of
 * descriptors; the archive keeps the best persona found in each niche, and
 * the explore branch targets niches nobody occupies yet.
 *
 * The vocabulary deliberately reaches far past the launch roster, including
 * the kinds of categories the product wants tried: animal characters (a
 * dancing cat), body types (very curvy), ages (a grandma), professions and
 * eras. Every value describes an adult; there is no age value below adult.
 */
import type { Ctx } from '../context.ts';
import { json } from '../db.ts';
import { lintText } from '../personas/safety.ts';
import { LOOK_VALUES, type Descriptors, type Persona, type PersonaGender, type PersonaLook } from '../personas/schema.ts';
import type { Rng } from '../stats/random.ts';
import type { PersonaStats } from '../telemetry/rollups.ts';

export const DESCRIPTOR_SPACE: Record<keyof Descriptors, string[]> = {
  form: [
    'human', 'elf-fae', 'undead', 'spirit', 'mermaid-siren', 'elemental-mage', 'witch', 'android', 'animal-anthro',
    'kitsune-yokai', 'djinn', 'angel', 'demon', 'dragon-kin', 'werewolf', 'ghost', 'alien', 'cat-person', 'centaur', 'goddess',
    // Forms the starter roster added.
    'robot', 'dragon', 'minotaur', 'yeti', 'dinosaur', 'toy', 'candy-creature', 'plant-spirit', 'sea-creature', 'cryptid', 'npc',
  ],
  setting: [
    'enchanted-forest', 'gothic-castle', 'shrine-village', 'ocean-depths', 'volcanic-ruins', 'ice-palace', 'cyber-city', 'star-tower',
    'farm-town', 'rooftop-city', 'maple-forest', 'desert-dunes', 'rock-club', 'airship', 'dance-studio', 'beach-town', 'space-station',
    'old-library', 'bakery', 'samurai-dojo', 'wild-west-saloon', 'pop-idol-stage', 'vineyard', 'ski-lodge', 'jungle-temple',
    'cozy-cottage', 'boxing-gym', 'pirate-ship', 'university-campus', 'retirement-village',
  ],
  era: ['timeless', 'ancient', 'feudal', 'victorian', 'roaring-twenties', 'retro-80s', 'modern', 'near-future', 'far-future', 'steampunk'],
  aesthetic: ['anime', 'goth', 'realistic', 'cartoon', 'fantasy-painterly'],
  vibe: [
    'nurturing', 'teasing', 'mysterious', 'regal', 'playful', 'deadpan', 'bold', 'sweet', 'shy', 'chaotic', 'wholesome', 'sarcastic',
    'adventurous', 'intellectual', 'confident', 'dramatic',
  ],
  body: ['slender', 'athletic', 'curvy', 'very-curvy', 'petite', 'tall', 'plus-size', 'muscular', 'furry'],
  age_group: ['young-adult', 'adult', 'mature-adult', 'senior-adult', 'ageless-adult'],
};

/**
 * The vocabulary grows. The explore branch needs an untried form, setting, body or age value, and
 * a roster this broad uses up the fixed lists, so when fewer than `MIN_UNTRIED` form or setting
 * values are left untried the LLM proposes new wide-reaching ones (validated and linted), stored in
 * the `vocab` table. Without an LLM it draws from this reserve, so the loop never runs dry.
 */
export const VOCAB_RESERVE: Record<'form' | 'setting', string[]> = {
  form: [
    'harpy', 'gargoyle', 'golem', 'phoenix', 'sphinx', 'lamia', 'satyr', 'banshee', 'slime', 'cyborg', 'mushroom-folk', 'kraken',
    'snow-spirit', 'bear-person', 'fox-person', 'bunny-person', 'storm-spirit', 'clockwork-automaton', 'living-statue', 'shadow-being',
  ],
  setting: [
    'casino', 'cruise-ship', 'hot-spring', 'carnival', 'observatory', 'greenhouse', 'lighthouse', 'night-market', 'sleeper-train',
    'arcade', 'opera-house', 'mountain-monastery', 'underground-club', 'treehouse-village', 'haunted-manor', 'tattoo-parlor',
    'yacht', 'ranch', 'fashion-runway', 'recording-studio', 'surf-camp', 'desert-oasis', 'floating-market', 'film-set',
  ],
};
export const MIN_UNTRIED = 3;
const VOCAB_VALUE = /^[a-z][a-z0-9]*(-[a-z0-9]+){0,3}$/;

/** The descriptor space: the fixed lists plus every value the vocabulary has grown. */
export function descriptorSpace(ctx: Ctx): Record<keyof Descriptors, string[]> {
  const space = Object.fromEntries(Object.entries(DESCRIPTOR_SPACE).map(([k, v]) => [k, [...v]])) as Record<keyof Descriptors, string[]>;
  for (const r of ctx.db.prepare('SELECT axis, value FROM vocab ORDER BY id').all() as { axis: keyof Descriptors; value: string }[]) {
    if (space[r.axis] && !space[r.axis].includes(r.value)) space[r.axis].push(r.value);
  }
  return space;
}

/** Values of an axis no persona (active, fading or retired) has carried. */
export function untried(ctx: Ctx, axis: keyof Descriptors, space = descriptorSpace(ctx)): string[] {
  const used = new Set(ctx.personas.all().map((p) => p.meta.descriptors[axis]));
  return space[axis].filter((v) => !used.has(v));
}

/** Top up the form and setting vocabulary when it is nearly used up. Returns the values added. */
export async function growVocabulary(ctx: Ctx, count = 6): Promise<{ axis: string; value: string; source: string }[]> {
  const added: { axis: string; value: string; source: string }[] = [];
  for (const axis of ['form', 'setting'] as const) {
    const space = descriptorSpace(ctx);
    if (untried(ctx, axis, space).length >= MIN_UNTRIED) continue;
    const have = new Set(space[axis]);
    const ok = (v: string, note = '') => VOCAB_VALUE.test(v) && v.length <= 30 && !have.has(v) && lintText(`${v} ${note}`).length === 0;
    const fresh: { value: string; source: string }[] = [];
    if (ctx.llm.enabled) {
      const what = axis === 'form'
        ? 'new KINDS OF CHARACTER (species, creature, being or archetype) for adult companion personas'
        : 'new SETTINGS (a place or world a character lives in)';
      const r = await ctx.llm.json<{ values: { value: string; why: string }[] }>(
        'You extend the category vocabulary of an AI-companion app whose personas are all adults. Reply with JSON only.',
        `Propose ${count} ${what} that are wide-reaching and unlike these existing ones: ${space[axis].join(', ')}. ` +
          'Each value is lowercase kebab-case, 1-4 words, no brand or franchise names, nothing involving minors, nothing explicit.',
        {
          type: 'object',
          properties: { values: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, why: { type: 'string' } }, required: ['value', 'why'], additionalProperties: false } } },
          required: ['values'],
          additionalProperties: false,
        },
      );
      for (const v of r?.values ?? []) if (ok(v.value, v.why) && !fresh.some((f) => f.value === v.value)) fresh.push({ value: v.value, source: 'llm' });
    }
    for (const v of VOCAB_RESERVE[axis]) {
      if (fresh.length >= count) break;
      if (ok(v) && !fresh.some((f) => f.value === v)) fresh.push({ value: v, source: 'reserve' });
    }
    const ins = ctx.db.prepare('INSERT INTO vocab (axis, value, source, ts) VALUES (?, ?, ?, ?)');
    for (const f of fresh.slice(0, count)) {
      ins.run(axis, f.value, f.source, ctx.now());
      added.push({ axis, ...f });
    }
    if (added.length) {
      ctx.db.prepare('INSERT INTO lifecycle_log (ts, kind, detail) VALUES (?, ?, ?)').run(ctx.now(), 'vocab_grow', JSON.stringify(added.filter((a) => a.axis === axis)));
    }
  }
  return added;
}

/** Axes that define a niche. Aesthetic and era are varied freely inside a niche. */
export const NICHE_AXES: (keyof Descriptors)[] = ['form', 'setting', 'vibe', 'body', 'age_group'];
/** Axes the exploit branch mutates; form and age stay with the parent so the archetype survives. */
export const EXPLOIT_AXES: (keyof Descriptors)[] = ['setting', 'era', 'vibe', 'aesthetic', 'body'];

export function nicheKey(d: Descriptors): string {
  return NICHE_AXES.map((k) => d[k]).join('|');
}

/** The front end's CharacterStyle for an aesthetic. */
export function styleFor(aesthetic: string): string {
  return ({ anime: 'Anime', goth: 'Goth', realistic: 'Realistic', cartoon: 'Cartoon', 'fantasy-painterly': 'Fantasy' } as Record<string, string>)[aesthetic] ?? 'Fantasy';
}

/** Feed categories for a descriptor set: one aesthetic tag, one form tag, then vibe/setting/body/age tags. */
export function categoriesFor(d: Descriptors): string[] {
  const aesthetic = d.aesthetic === 'fantasy-painterly' ? 'fantasy-art' : d.aesthetic;
  const form =
    d.form === 'human' ? 'human' :
    d.form === 'android' ? 'android-cyber' :
    d.form === 'animal-anthro' || d.form === 'cat-person' || d.form === 'werewolf' ? 'animal-anthro' :
    d.form === 'goddess' || d.form === 'angel' || d.form === 'demon' ? 'mythic-deity' :
    d.form === 'undead' || d.form === 'ghost' || d.form === 'spirit' ? 'supernatural' : 'fantasy-creature';
  const extra: string[] = [d.vibe];
  const settingTag: Record<string, string> = {
    'dance-studio': 'dance', 'pop-idol-stage': 'music', 'rock-club': 'music', 'bakery': 'food', 'farm-town': 'cottagecore',
    'cozy-cottage': 'cozy', 'ocean-depths': 'ocean', 'beach-town': 'ocean', 'cyber-city': 'tech', 'space-station': 'sci-fi',
    'samurai-dojo': 'japanese-folklore', 'shrine-village': 'japanese-folklore', 'gothic-castle': 'dark-romance', 'old-library': 'intellectual',
    'boxing-gym': 'sporty', 'pirate-ship': 'adventure', 'airship': 'steampunk', 'wild-west-saloon': 'western', 'vineyard': 'romantic',
    'ice-palace': 'royalty', 'desert-dunes': 'desert', 'enchanted-forest': 'nature', 'maple-forest': 'nature', 'star-tower': 'celestial',
  };
  if (settingTag[d.setting]) extra.push(settingTag[d.setting]);
  if (d.body === 'very-curvy' || d.body === 'curvy' || d.body === 'plus-size') extra.push('curvy');
  if (d.body === 'muscular' || d.body === 'athletic') extra.push('sporty');
  if (d.age_group === 'mature-adult' || d.age_group === 'senior-adult') extra.push('mature');
  return [...new Set([aesthetic, form, ...extra])].slice(0, 6);
}

/** Rebuild the archive from the current roster and its scores. */
/** Forms drawn with human skin, so a human ethnicity applies (the starters were tagged the same way). */
const HUMAN_SKIN_FORMS = new Set(['human', 'elf-fae', 'undead', 'witch', 'angel', 'demon', 'goddess', 'mermaid-siren', 'elemental-mage', 'djinn', 'ghost']);
/** The physique each body descriptor is drawn with (a man's chest is always `none`). */
const BODY_LOOK: Record<string, Pick<PersonaLook, 'chest_size' | 'butt_size' | 'muscle'>> = {
  slender: { chest_size: 'small', butt_size: 'small', muscle: 'soft' },
  petite: { chest_size: 'small', butt_size: 'small', muscle: 'soft' },
  athletic: { chest_size: 'medium', butt_size: 'medium', muscle: 'athletic' },
  tall: { chest_size: 'medium', butt_size: 'medium', muscle: 'toned' },
  curvy: { chest_size: 'large', butt_size: 'large', muscle: 'soft' },
  'very-curvy': { chest_size: 'very-large', butt_size: 'very-large', muscle: 'soft' },
  'plus-size': { chest_size: 'large', butt_size: 'large', muscle: 'soft' },
  muscular: { chest_size: 'medium', butt_size: 'medium', muscle: 'muscular' },
  furry: { chest_size: 'none', butt_size: 'medium', muscle: 'soft' },
};
/** Ethnicities a new explore persona draws from, uniformly: the starters are mostly white and East Asian. */
export const SPAWN_ETHNICITIES = LOOK_VALUES.ethnicity.filter((e) => e !== 'ambiguous' && e !== 'non-human');

/**
 * The look a persona the loop invents is drawn with (its art prompt says it, so its tags are true
 * of its portrait): physique from the body descriptor, a modest outfit (the server's art is always
 * fully and modestly clothed), facing the viewer (the portrait framing), and an ethnicity kept from
 * the parent when the form still has human skin, else drawn.
 */
export function lookFor(gender: PersonaGender, d: Descriptors, rng: Rng, parent?: Persona | null): PersonaLook {
  const body = BODY_LOOK[d.body] ?? BODY_LOOK.slender;
  const humanSkin = HUMAN_SKIN_FORMS.has(d.form);
  const inherited = parent?.meta.look?.ethnicity;
  const ethnicity = !humanSkin
    ? 'non-human'
    : inherited && SPAWN_ETHNICITIES.includes(inherited)
      ? inherited
      : rng.pick(SPAWN_ETHNICITIES);
  return {
    chest_size: gender === 'male' ? 'none' : body.chest_size,
    chest_shown: 'covered',
    butt_size: body.butt_size,
    butt_view: 'front',
    muscle: body.muscle,
    ethnicity,
  };
}

const ETHNICITY_WORDS: Record<string, string> = {
  white: 'white', 'east-asian': 'East Asian', 'south-asian': 'South Asian', 'southeast-asian': 'Southeast Asian', black: 'Black',
  'middle-eastern': 'Middle Eastern', indigenous: 'Indigenous', 'pacific-islander': 'Pacific Islander', mixed: 'mixed-heritage',
};
const MUSCLE_WORDS: Record<string, string> = { toned: 'toned', athletic: 'athletic', muscular: 'muscular', 'very-muscular': 'very muscular' };

/** The look in words for an image or writing prompt ("Latina, athletic"); empty when nothing applies. */
export function lookPhrase(look: PersonaLook | undefined, gender: PersonaGender): string {
  if (!look) return '';
  const e = look.ethnicity === 'latino' ? (gender === 'female' ? 'Latina' : 'Latino') : ETHNICITY_WORDS[look.ethnicity];
  return [e, MUSCLE_WORDS[look.muscle]].filter(Boolean).join(', ');
}

export function rebuildArchive(ctx: Ctx, stats: PersonaStats[]): void {
  const score = new Map(stats.map((s) => [s.personaId, s.score?.score ?? null]));
  const cells = new Map<string, { descriptors: Descriptors; ids: string[]; best: number | null }>();
  for (const p of ctx.personas.all()) {
    if (p.meta.status === 'retired') continue;
    const key = nicheKey(p.meta.descriptors);
    const cell = cells.get(key) ?? { descriptors: p.meta.descriptors, ids: [], best: null };
    cell.ids.push(p.meta.id);
    const s = score.get(p.meta.id);
    if (s !== null && s !== undefined && (cell.best === null || s > cell.best)) cell.best = s;
    cells.set(key, cell);
  }
  const keep = ctx.db.prepare('SELECT key, tried FROM niches').all() as { key: string; tried: number }[];
  const tried = new Map(keep.map((r) => [r.key, r.tried]));
  ctx.db.exec('DELETE FROM niches');
  const ins = ctx.db.prepare('INSERT INTO niches (key, descriptors, persona_ids, best_score, tried) VALUES (?, ?, ?, ?, ?)');
  for (const [key, c] of cells) ins.run(key, JSON.stringify(c.descriptors), JSON.stringify(c.ids), c.best, tried.get(key) ?? 1);
  // Remember niches that were tried and emptied (retired), so explore does not retry them blindly.
  for (const [key, n] of tried) if (!cells.has(key)) ins.run(key, '{}', '[]', null, n);
}

/** Marginal performance of each axis value: mean score and count over personas carrying it. */
export function axisMarginals(personas: Persona[], stats: PersonaStats[]): Map<string, { mean: number; n: number }> {
  const score = new Map(stats.map((s) => [s.personaId, s.score?.score]));
  const acc = new Map<string, { sum: number; n: number }>();
  for (const p of personas) {
    const s = score.get(p.meta.id);
    if (s === undefined) continue;
    for (const k of Object.keys(DESCRIPTOR_SPACE) as (keyof Descriptors)[]) {
      const key = `${k}=${p.meta.descriptors[k]}`;
      const a = acc.get(key) ?? { sum: 0, n: 0 };
      a.sum += s;
      a.n++;
      acc.set(key, a);
    }
  }
  return new Map([...acc].map(([k, v]) => [k, { mean: v.sum / v.n, n: v.n }]));
}

export function occupiedOrTried(ctx: Ctx): Set<string> {
  return new Set((ctx.db.prepare('SELECT key FROM niches').all() as { key: string }[]).map((r) => r.key));
}

export function archive(ctx: Ctx): { key: string; descriptors: Descriptors; personaIds: string[]; best: number | null }[] {
  return (ctx.db.prepare('SELECT * FROM niches ORDER BY best_score DESC').all() as { key: string; descriptors: string; persona_ids: string; best_score: number | null }[]).map(
    (r) => ({ key: r.key, descriptors: json<Descriptors>(r.descriptors, {} as Descriptors), personaIds: json<string[]>(r.persona_ids, []), best: r.best_score }),
  );
}
