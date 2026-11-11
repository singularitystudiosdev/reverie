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
import type { Descriptors, Persona } from '../personas/schema.ts';
import type { PersonaStats } from '../telemetry/rollups.ts';

export const DESCRIPTOR_SPACE: Record<keyof Descriptors, string[]> = {
  form: [
    'human', 'elf-fae', 'undead', 'spirit', 'mermaid-siren', 'elemental-mage', 'witch', 'android', 'animal-anthro',
    'kitsune-yokai', 'djinn', 'angel', 'demon', 'dragon-kin', 'werewolf', 'ghost', 'alien', 'cat-person', 'centaur', 'goddess',
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
