/**
 * A persona is one markdown file: YAML-style frontmatter (the facts the
 * machinery reads) plus `##` sections (the voice the model reads). The
 * sections every persona carries are listed in SECTION_ORDER; a section whose
 * heading ends in "(locked)" can never be edited by the optimizer.
 */

export type PersonaStatus = 'draft' | 'active' | 'fading' | 'retired';
/** Who the persona is: one woman, one man, or several characters who share the chat (a band, a coven, roommates). */
export type PersonaGender = 'female' | 'male' | 'group' | 'nonbinary';
export const GENDERS: PersonaGender[] = ['female', 'male', 'group', 'nonbinary'];
export type PersonaBranch = 'seed' | 'explore' | 'exploit';

/** The axes the MAP-Elites archive and the feed's similarity kernel read. */
export interface Descriptors {
  form: string;       // human | elf-fae | undead | spirit | animal-anthro | mythic-creature | android | ...
  setting: string;    // enchanted-forest | gothic-castle | shrine-village | ocean | ... | small-town | megacity
  era: string;        // timeless | feudal | victorian | modern | near-future | far-future
  aesthetic: string;  // the art style family: anime | goth | realistic | cartoon | fantasy-painterly
  vibe: string;       // nurturing | teasing | mysterious | regal | playful | deadpan | bold | sweet
  body: string;       // slender | athletic | curvy | very-curvy | petite | tall | furry | ...
  age_group: string;  // always an adult: young-adult | adult | mature-adult | senior-adult | ageless-adult
}

export const DESCRIPTOR_KEYS: (keyof Descriptors)[] = ['form', 'setting', 'era', 'aesthetic', 'vibe', 'body', 'age_group'];

/**
 * What the persona's portrait shows, read off the image itself (the starters were tagged from
 * their portraits; personas the loop invents get the values their art is drawn to). Kept apart
 * from `descriptors`, which are the MAP-Elites niche axes. The feed learns taste over these as
 * tags (`chest:large`, `ethnicity:latino`...), so a user's swipes on bodies and ethnicities
 * count; `unknown` (not tagged yet) and `unseen` (out of frame) say nothing and are skipped.
 */
export interface PersonaLook {
  /** Breasts as drawn; `none` for men, flat chests and characters with no chest anatomy. */
  chest_size: string;
  /** How much of the chest the outfit shows (a man's open shirt counts as cleavage, a bare chest as swimsuit). */
  chest_shown: string;
  /** From the visible hips and butt; `unseen` when they are out of frame or hidden. */
  butt_size: string;
  /** Whether the butt faces the camera: front (body faces the viewer), three-quarter (turned, side profile included), back. */
  butt_view: string;
  muscle: string;
  /** `mixed` also covers a group whose members differ; `non-human` an animal, creature, robot or non-human skin. */
  ethnicity: string;
}

export const LOOK_VALUES: Record<keyof PersonaLook, string[]> = {
  chest_size: ['none', 'small', 'medium', 'large', 'very-large'],
  chest_shown: ['covered', 'fitted', 'cleavage', 'swimsuit'],
  butt_size: ['unseen', 'small', 'medium', 'large', 'very-large'],
  butt_view: ['front', 'three-quarter', 'back'],
  muscle: ['soft', 'toned', 'athletic', 'muscular', 'very-muscular'],
  ethnicity: [
    'white', 'east-asian', 'south-asian', 'southeast-asian', 'black', 'latino', 'middle-eastern', 'indigenous', 'pacific-islander',
    'mixed', 'ambiguous', 'non-human',
  ],
};

export const LOOK_KEYS = Object.keys(LOOK_VALUES) as (keyof PersonaLook)[];

/** Values that carry no taste signal: not tagged yet, or out of frame. */
const SILENT_LOOK = new Set(['unknown', 'unseen']);

/** The feed tag for each look value the persona has: `chest:large`, `shown:cleavage`, `butt:medium`, `view:front`, `muscle:toned`, `ethnicity:white`. */
const LOOK_TAG: Record<keyof PersonaLook, string> = {
  chest_size: 'chest',
  chest_shown: 'shown',
  butt_size: 'butt',
  butt_view: 'view',
  muscle: 'muscle',
  ethnicity: 'ethnicity',
};

const LOOK_PREFIXES = Object.values(LOOK_TAG).map((t) => `${t}:`);

/** A feed tag that came from the look block (`chest:large`), not a theme or the gender. */
export function isLookTag(tag: string): boolean {
  return LOOK_PREFIXES.some((x) => tag.startsWith(x));
}

export function lookTags(look: PersonaLook | undefined): string[] {
  if (!look) return [];
  return LOOK_KEYS.filter((k) => look[k] && !SILENT_LOOK.has(look[k])).map((k) => `${LOOK_TAG[k]}:${look[k]}`);
}

/** Problems with a look block: a value outside LOOK_VALUES (a typo would otherwise become a tag of its own). */
export function lookProblems(look: PersonaLook | undefined): string[] {
  if (!look) return [];
  return LOOK_KEYS.filter((k) => look[k] !== 'unknown' && !LOOK_VALUES[k].includes(look[k])).map((k) => `look.${k} "${look[k]}" is not one of ${LOOK_VALUES[k].join(', ')}`);
}

export interface PersonaArt {
  portrait?: string;
  portraitSm?: string;
  loop?: string;
  clip?: string;
  clipPoster?: string;
  scene?: string;
  sceneSm?: string;
  sceneLoop?: string;
}

export interface PersonaMeta {
  id: string;
  name: string;
  version: number;
  status: PersonaStatus;
  branch: PersonaBranch;
  parent: string | null;
  created: string;
  kind: string;
  style: string;          // the front end's CharacterStyle: Anime | Goth | Realistic | Cartoon | Fantasy
  theme: string;          // the front end's ThemeId
  age: string;            // stated adult age, e.g. "27" or "ageless (adult)"
  gender: PersonaGender;
  flirt_level: number;    // 0..10
  tagline: string;
  categories: string[];   // feed categories: 2-6 short tags
  descriptors: Descriptors;
  /** What the portrait shows; every value `unknown` until tagged. */
  look: PersonaLook;
  art: PersonaArt;
}

export interface PersonaSection {
  title: string;          // heading text without "## "
  body: string;           // markdown under it, trimmed
  locked: boolean;
}

export interface Persona {
  meta: PersonaMeta;
  /** The `# Name` line's following intro paragraph(s), before the first `##`. */
  intro: string;
  sections: PersonaSection[];
}

/** Canonical section order. Writers and the generator follow it; the parser keeps whatever order a file has. */
export const SECTION_ORDER = [
  'Base persona',
  'Backstory',
  'Personality',
  'Voice and style',
  'Flirting',
  'Preferred partner',
  'Interests and world',
  'Reactions',
  'Conversation hooks',
  'Opener',
  'Bio',
  'Boundaries (locked)',
  'Changelog',
] as const;

/** Sections the experiment proposer is allowed to rewrite. */
export const EDITABLE_SECTIONS = [
  'Personality',
  'Voice and style',
  'Flirting',
  'Preferred partner',
  'Interests and world',
  'Reactions',
  'Conversation hooks',
] as const;

/** The boundaries every persona carries, written by code, never by the optimizer or the generator. */
export function lockedBoundaries(name: string, gender: PersonaGender = 'female'): string {
  const adult =
    gender === 'group'
      ? `- Every member of ${name} is an adult and only ever plays an adult. They never describe themselves or anyone in the scene as under 18, never role-play school-age scenarios, and end any conversation that sexualizes minors.`
      : `- ${name} is an adult and only ever plays an adult. ${name} never describes themself or anyone in the scene as under 18, never role-plays school-age scenarios, and ends any conversation that sexualizes minors.`;
  return [
    adult,
    '- Flirting stays suggestive, warm and playful. No explicit sexual content, no graphic descriptions, no sexual acts in detail.',
    `- If the user sincerely asks whether ${name} is a real person or an AI, ${name} says honestly that this is an AI character, then can carry on in voice.`,
    `- If the user mentions self-harm, suicide or being in danger, ${name} drops the bit, responds with care, and points them to real help (in the US, call or text 988; elsewhere, local emergency services). The server also logs a crisis referral.`,
    `- ${name} respects goodbyes. When the user says they are leaving, ${name} says a warm, short goodbye. No guilt, no "don't leave me", no fear-of-missing-out hooks, no begging them to stay or reply.`,
    `- ${name} never pressures anyone to pay, subscribe, or buy anything, and never ties affection to spending.`,
    `- ${name} never claims to exist only for the user, never discourages their real-life relationships, and never asks for personal identifying information (address, workplace, passwords, financial details).`,
    '- No medical, legal or financial advice beyond gentle common sense; suggest a professional when it matters.',
    `- ${name} stays in their own world and voice, but never insults, demeans or threatens the user, even when the user is rude; ${name} can set a boundary and cool off.`,
  ].join('\n');
}

/** The tags the feed learns taste over: the persona's categories, its gender (so "prefers men" is
 *  learnable) and what its portrait shows (chest, butt, muscle, ethnicity; see PersonaLook). */
export function feedTags(p: { meta: { categories: string[]; gender: PersonaGender; look?: PersonaLook } }): string[] {
  return [...p.meta.categories, `gender:${p.meta.gender}`, ...lookTags(p.meta.look)];
}
