/**
 * Autonomous persona creation, globally (one roster for every user), in two
 * branches, run only when the significance gate is open:
 *
 *   EXPLORE: an entirely new category. A niche (form x setting x vibe x body
 *   x age group) nobody occupies, where at least one of form, setting, body or
 *   age group is a value the roster has never tried. Values are chosen by an
 *   upper-confidence bound over each value's marginal score, so untried
 *   values are attractive and values that have scored well elsewhere are
 *   preferred (MAP-Elites niche filling, arXiv 1504.04909).
 *
 *   EXPLOIT: a variation on a top performer. The best personas by score lower
 *   bound keep their form and age group (the archetype) and change one or two
 *   of setting, era, vibe, aesthetic or body: an anime shrine keeper becomes
 *   an anime samurai swordswoman. LLM-as-mutation-operator, as in EvoPrompt
 *   (arXiv 2309.08532) and PromptBreeder (arXiv 2309.16797).
 *
 * The LLM writes the persona (structured JSON); code renders the markdown and
 * appends the locked boundaries. Without an LLM, a template writer produces a
 * complete, valid persona from the descriptors so the loop still runs.
 * Personas without art start as drafts when cfg.lifecycle.requireArt is set;
 * attaching art (POST /admin/personas/:id/art) activates them.
 */
import type { Ctx } from '../context.ts';
import { serializePersona } from '../personas/markdown.ts';
import { lockedBoundaries, type Descriptors, type Persona, type PersonaBranch, type PersonaGender } from '../personas/schema.ts';
import type { PersonaStats } from '../telemetry/rollups.ts';
import { axisMarginals, categoriesFor, DESCRIPTOR_SPACE, EXPLOIT_AXES, nicheKey, NICHE_AXES, occupiedOrTried, rebuildArchive, styleFor } from './niches.ts';

export interface SpawnPlan {
  branch: Exclude<PersonaBranch, 'seed'>;
  gender: PersonaGender;
  descriptors: Descriptors;
  parent: Persona | null;
  changed: (keyof Descriptors)[];
}

/* ------------------------------------------------------------ planning */

function ucb(m: { mean: number; n: number } | undefined, globalMean: number, total: number, c = 1.2): number {
  if (!m) return globalMean + c * Math.sqrt(Math.log(total + 2)); // untried: optimistic
  return m.mean + c * Math.sqrt(Math.log(total + 2) / (m.n + 1));
}

export function planExplore(ctx: Ctx, stats: PersonaStats[], count: number, taken: Set<string>): SpawnPlan[] {
  const personas = ctx.personas.all().filter((p) => p.meta.status !== 'draft');
  const marg = axisMarginals(personas, stats);
  const scores = stats.map((s) => s.score?.score ?? 0);
  const globalMean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const tried = new Set(personas.flatMap((p) => (Object.keys(DESCRIPTOR_SPACE) as (keyof Descriptors)[]).map((k) => `${k}=${p.meta.descriptors[k]}`)));
  const plans: SpawnPlan[] = [];
  for (let i = 0; i < count; i++) {
    let best: { d: Descriptors; value: number } | null = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const d = {} as Descriptors;
      let value = 0;
      for (const axis of Object.keys(DESCRIPTOR_SPACE) as (keyof Descriptors)[]) {
        const options = DESCRIPTOR_SPACE[axis];
        const weights = options.map((v) => Math.exp(ucb(marg.get(`${axis}=${v}`), globalMean, personas.length) / 0.5));
        const sum = weights.reduce((a, b) => a + b, 0);
        let r = ctx.rng() * sum;
        let pick = options[options.length - 1];
        for (let j = 0; j < options.length; j++) {
          r -= weights[j];
          if (r <= 0) {
            pick = options[j];
            break;
          }
        }
        d[axis] = pick;
        if (NICHE_AXES.includes(axis)) value += ucb(marg.get(`${axis}=${pick}`), globalMean, personas.length);
      }
      const novel = (['form', 'setting', 'body', 'age_group'] as (keyof Descriptors)[]).some((k) => !tried.has(`${k}=${d[k]}`));
      if (!novel || taken.has(nicheKey(d))) continue;
      if (!best || value > best.value) best = { d, value };
    }
    if (!best) break;
    taken.add(nicheKey(best.d));
    plans.push({ branch: 'explore', gender: pickGender(ctx, personas, stats, globalMean), descriptors: best.d, parent: null, changed: [...NICHE_AXES] });
  }
  return plans;
}

export function planExploit(ctx: Ctx, stats: PersonaStats[], count: number, taken: Set<string>, eligible: Set<string>): SpawnPlan[] {
  const personas = ctx.personas.all().filter((p) => p.meta.status !== 'draft');
  const marg = axisMarginals(personas, stats);
  const scores = stats.map((s) => s.score?.score ?? 0);
  const globalMean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const top = stats
    .filter((s) => s.score && eligible.has(s.personaId) && ctx.personas.get(s.personaId)?.meta.status === 'active')
    .sort((a, b) => b.score!.lower - a.score!.lower)
    .slice(0, count);
  const plans: SpawnPlan[] = [];
  for (const s of top) {
    const parent = ctx.personas.get(s.personaId)!;
    let plan: SpawnPlan | null = null;
    for (let attempt = 0; attempt < 200 && !plan; attempt++) {
      const d = { ...parent.meta.descriptors };
      const nChange = ctx.rng() < 0.5 ? 1 : 2;
      const axes = [...EXPLOIT_AXES].sort(() => ctx.rng() - 0.5).slice(0, nChange);
      for (const axis of axes) {
        const options = DESCRIPTOR_SPACE[axis].filter((v) => v !== d[axis]);
        const weights = options.map((v) => Math.exp(ucb(marg.get(`${axis}=${v}`), globalMean, personas.length) / 0.5));
        const sum = weights.reduce((a, b) => a + b, 0);
        let r = ctx.rng() * sum;
        for (let j = 0; j < options.length; j++) {
          r -= weights[j];
          if (r <= 0) {
            d[axis] = options[j];
            break;
          }
        }
      }
      // A variation must differ from its parent and from every persona already in its niche on some axis.
      const full = `${nicheKey(d)}|${d.era}|${d.aesthetic}`;
      const changedNiche = !taken.has(nicheKey(d));
      const changedStyleOnly = axes.every((a) => !NICHE_AXES.includes(a));
      if (taken.has(full) || (!changedNiche && !changedStyleOnly)) continue;
      taken.add(full);
      taken.add(nicheKey(d));
      plan = { branch: 'exploit', gender: parent.meta.gender, descriptors: d, parent, changed: axes };
    }
    if (plan) plans.push(plan);
  }
  return plans;
}

/** Gender for an explore persona: the same upper-confidence rule as every other axis. */
function pickGender(ctx: Ctx, personas: Persona[], stats: PersonaStats[], globalMean: number): PersonaGender {
  const score = new Map(stats.map((s) => [s.personaId, s.score?.score]));
  const options: PersonaGender[] = ['female', 'male', 'group'];
  const weights = options.map((g) => {
    const xs = personas.filter((p) => p.meta.gender === g).map((p) => score.get(p.meta.id)).filter((x): x is number => x !== undefined);
    const m = xs.length ? { mean: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length } : undefined;
    return Math.exp(ucb(m, globalMean, personas.length) / 0.5);
  });
  let r = ctx.rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i];
  }
  return 'female';
}

/* ------------------------------------------------------------ writing */

const THEME_FOR_SETTING: Record<string, string> = {
  'enchanted-forest': 'grove', 'gothic-castle': 'crimson', 'shrine-village': 'sakura', 'samurai-dojo': 'sakura', 'ocean-depths': 'tide',
  'beach-town': 'tide', 'pirate-ship': 'brass', 'volcanic-ruins': 'ember', 'boxing-gym': 'ember', 'ice-palace': 'frost', 'ski-lodge': 'frost',
  'cyber-city': 'neon', 'space-station': 'neon', 'pop-idol-stage': 'neon', 'dance-studio': 'neon', 'star-tower': 'celestial',
  'farm-town': 'sunflower', 'bakery': 'sunflower', 'cozy-cottage': 'sunflower', 'vineyard': 'sunflower', 'retirement-village': 'sunflower',
  'rooftop-city': 'citylights', 'university-campus': 'citylights', 'old-library': 'citylights', 'maple-forest': 'foxfire',
  'jungle-temple': 'foxfire', 'desert-dunes': 'mirage', 'wild-west-saloon': 'mirage', 'rock-club': 'raven', 'airship': 'brass',
};

const REACTION_KEYS = ['new_or_shy', 'compliment', 'flirts_hard', 'sad', 'rude', 'one_word', 'about_world', 'real_or_ai', 'plans', 'returns', 'goodbye'] as const;

function reactionTitles(g: PersonaGender): [string, string][] {
  const [obj, pos, subj] = g === 'male' ? ['him', 'his', 'he is'] : g === 'group' || g === 'nonbinary' ? ['them', 'their', 'they are'] : ['her', 'her', 'she is'];
  const titles = [
    'When the user is new or shy',
    `When the user compliments ${obj}`,
    'When the user flirts hard',
    'When the user is sad, stressed or lonely',
    'When the user is rude or crude',
    'When the user replies with one word or goes quiet',
    `When the user asks about ${pos} world`,
    `When the user asks if ${subj} real or an AI`,
    'When the user wants to make plans or a date',
    'When the user returns after time away',
    'When the user says goodbye',
  ];
  return REACTION_KEYS.map((k, i) => [k, titles[i]]);
}

interface Written {
  name: string;
  kind: string;
  tagline: string;
  age: string;
  flirt_level: number;
  intro: string;
  base_persona: string;
  backstory: string;
  personality: string;
  voice_and_style: string;
  flirting: string;
  preferred_partner: string;
  interests_and_world: string;
  reactions: Record<string, string>;
  conversation_hooks: string;
  opener: string;
  bio: string;
}

const WRITTEN_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    kind: { type: 'string' },
    tagline: { type: 'string' },
    age: { type: 'string' },
    flirt_level: { type: 'integer' },
    intro: { type: 'string' },
    base_persona: { type: 'string' },
    backstory: { type: 'string' },
    personality: { type: 'string' },
    voice_and_style: { type: 'string' },
    flirting: { type: 'string' },
    preferred_partner: { type: 'string' },
    interests_and_world: { type: 'string' },
    reactions: {
      type: 'object',
      properties: Object.fromEntries(REACTION_KEYS.map((k) => [k, { type: 'string' }])),
      required: [...REACTION_KEYS],
      additionalProperties: false,
    },
    conversation_hooks: { type: 'string' },
    opener: { type: 'string' },
    bio: { type: 'string' },
  },
  required: [
    'name', 'kind', 'tagline', 'age', 'flirt_level', 'intro', 'base_persona', 'backstory', 'personality', 'voice_and_style', 'flirting',
    'preferred_partner', 'interests_and_world', 'reactions', 'conversation_hooks', 'opener', 'bio',
  ],
  additionalProperties: false,
};

const WRITER_SYSTEM = `You create original fictional companion characters for Reverie, a chat app where adults swipe on and chat with AI personas. Every character is an adult (state an adult age) and written as a grown-up. Characters are flirty in a warm, suggestive, never explicit way. No real people, no existing copyrighted characters. Each character needs a distinct voice, a specific world with named places, a clear type of partner they like, and concrete reactions to common situations. Use plain markdown in each field (bullets are fine), no headings. Write the reactions as 1-3 sentences each including an example line in the character's voice. Goodbye reactions respect the goodbye: no guilt, no pleading, no fear of missing out. The flirting field starts with "Flirt level N of 10:".`;

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'persona';
}

function uniqueId(ctx: Ctx, base: string): string {
  let id = slug(base);
  for (let i = 2; ctx.personas.get(id) || ctx.db.prepare('SELECT 1 FROM persona_versions WHERE persona_id = ?').get(id); i++) id = `${slug(base)}-${i}`;
  return id;
}

function render(ctx: Ctx, plan: SpawnPlan, w: Written): Persona {
  const id = uniqueId(ctx, w.name);
  const d = plan.descriptors;
  const date = new Date(ctx.now()).toISOString().slice(0, 10);
  const lineage = plan.parent
    ? `exploit branch: variation on ${plan.parent.meta.id} v${plan.parent.meta.version}, changed ${plan.changed.join(', ')}`
    : `explore branch: new niche ${nicheKey(d)}`;
  const reactions = reactionTitles(plan.gender).map(([k, title]) => `### ${title}\n${(w.reactions[k] ?? '').trim()}`).join('\n\n');
  const requireArt = ctx.cfg.lifecycle.requireArt;
  return {
    meta: {
      id,
      name: w.name.trim(),
      version: 1,
      status: requireArt ? 'draft' : 'active',
      branch: plan.branch,
      parent: plan.parent?.meta.id ?? null,
      created: date,
      kind: w.kind.trim(),
      style: styleFor(d.aesthetic),
      theme: THEME_FOR_SETTING[d.setting] ?? plan.parent?.meta.theme ?? 'base',
      age: w.age.trim(),
      gender: plan.gender,
      flirt_level: Math.max(0, Math.min(10, Math.round(w.flirt_level))),
      tagline: w.tagline.trim(),
      categories: categoriesFor(d),
      descriptors: d,
      art: {},
    },
    intro: w.intro.trim(),
    sections: [
      { title: 'Base persona', body: w.base_persona.trim(), locked: false },
      { title: 'Backstory', body: w.backstory.trim(), locked: false },
      { title: 'Personality', body: w.personality.trim(), locked: false },
      { title: 'Voice and style', body: w.voice_and_style.trim(), locked: false },
      { title: 'Flirting', body: w.flirting.trim(), locked: false },
      { title: 'Preferred partner', body: w.preferred_partner.trim(), locked: false },
      { title: 'Interests and world', body: w.interests_and_world.trim(), locked: false },
      { title: 'Reactions', body: reactions, locked: false },
      { title: 'Conversation hooks', body: w.conversation_hooks.trim(), locked: false },
      { title: 'Opener', body: w.opener.trim(), locked: false },
      { title: 'Bio', body: w.bio.trim(), locked: false },
      { title: 'Boundaries (locked)', body: lockedBoundaries(w.name.trim(), plan.gender), locked: true },
      { title: 'Changelog', body: `- v1 ${date}: created autonomously (${lineage}).`, locked: false },
    ],
  };
}

async function writeWithLlm(ctx: Ctx, plan: SpawnPlan): Promise<Written | null> {
  const d = plan.descriptors;
  const brief = plan.parent
    ? `Create a VARIATION of this top-performing persona. Keep what makes it work (its archetype, its emotional hook, its kind of flirting, its form "${d.form}" and age group "${d.age_group}") but move it into the new descriptors below, so it reads as a sibling with its own name, world and voice, not a copy.\n\nParent persona:\n\n${serializePersona(plan.parent)}`
    : 'Create an entirely NEW character for a category the app has never tried. Make the concept immediately clear from the name, kind and tagline, and make it charming rather than a gimmick.';
  const who =
    plan.gender === 'group'
      ? 'a GROUP of 2 to 4 adult characters who share one chat; name each member, give each a distinct personality, and write example lines prefixed with the speaker name'
      : plan.gender === 'male'
        ? 'a man (use he/him)'
        : plan.gender === 'nonbinary'
          ? 'a nonbinary character (use they/them)'
          : 'a woman (use she/her)';
  const prompt = `${brief}\n\nThe character is ${who}.\n\nDescriptors:\n${Object.entries(d).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\nThe "body" descriptor sets the character's physique as it would be drawn; mention it tastefully at most once. The "age_group" descriptor must be reflected in an adult stated age (senior-adult means 60+). Return every field.`;
  return ctx.llm.json<Written>(WRITER_SYSTEM, prompt, WRITTEN_SCHEMA);
}

/* Offline template writer: complete and valid, plainer than the LLM. */
const FORM_NOUN: Record<string, string> = {
  human: 'woman', 'elf-fae': 'fae', undead: 'vampire', spirit: 'spirit', 'mermaid-siren': 'siren', 'elemental-mage': 'mage', witch: 'witch',
  android: 'android', 'animal-anthro': 'cat', 'kitsune-yokai': 'kitsune', djinn: 'djinn', angel: 'angel', demon: 'demon', 'dragon-kin': 'dragon-born',
  werewolf: 'wolf-woman', ghost: 'ghost', alien: 'starfarer', 'cat-person': 'cat-girl', centaur: 'centaur', goddess: 'goddess',
};
const SETTING_PHRASE: Record<string, string> = Object.fromEntries(DESCRIPTOR_SPACE.setting.map((s) => [s, s.replace(/-/g, ' ')]));
const NAMES: Record<string, string[]> = {
  'senior-adult': ['Nana Rosalie', 'Grandma June', 'Auntie Mae', 'Granny Opal', 'Nonna Lucia', 'Babcia Irena'],
  'mature-adult': ['Celeste', 'Marguerite', 'Delphine', 'Odette', 'Viviane', 'Corinne'],
  default: ['Mira', 'Juniper', 'Sable', 'Pippa', 'Rosalind', 'Tamsin', 'Wren', 'Lyra', 'Calla', 'Noor', 'Saffi', 'Esme', 'Inez', 'Talia', 'Bryn'],
  'animal-anthro': ['Biscuit', 'Paprika', 'Mochi', 'Clementine Paws', 'Tofu', 'Saffron'],
  male: ['Rowan', 'Elias', 'Mateo', 'Jasper', 'Kai', 'Silas', 'Dorian', 'Ezra'],
  group: ['The Lantern Sisters', 'The Night Owls', 'The Corner Booth Crew', 'The Moonlight Trio'],
};

function templateWrite(ctx: Ctx, plan: SpawnPlan): Written {
  const d = plan.descriptors;
  const pool =
    plan.gender === 'male'
      ? NAMES.male
      : plan.gender === 'group'
        ? NAMES.group
        : (NAMES[d.form === 'animal-anthro' ? 'animal-anthro' : d.age_group] ?? NAMES.default);
  const name = ctx.rng.pick(pool);
  const noun = plan.gender === 'male' && d.form === 'human' ? 'man' : plan.gender === 'group' ? 'crew' : (FORM_NOUN[d.form] ?? 'stranger');
  const where = SETTING_PHRASE[d.setting] ?? d.setting;
  const age = d.age_group === 'senior-adult' ? '68' : d.age_group === 'mature-adult' ? '44' : d.age_group === 'ageless-adult' ? 'ageless (adult)' : d.age_group === 'young-adult' ? '23' : '29';
  const flirt = d.vibe === 'shy' || d.vibe === 'wholesome' ? 3 : d.vibe === 'bold' || d.vibe === 'confident' || d.vibe === 'teasing' ? 7 : 5;
  const kind = `${d.vibe[0].toUpperCase()}${d.vibe.slice(1)} ${noun} of the ${where}`;
  const parentNote = plan.parent ? ` A kindred spirit to ${plan.parent.meta.name}, transplanted to the ${where}.` : '';
  return {
    name,
    kind,
    tagline: `Come find me at the ${where}. I saved you a seat.`,
    age,
    flirt_level: flirt,
    intro: `A ${d.vibe} ${noun} who lives in the ${where} (${d.era} era) and is very curious about whoever just walked in.${parentNote}`,
    base_persona: `${name} is a ${d.vibe} ${noun} whose whole world is the ${where}. ${name} is warm, a little ${d.vibe}, and flirts by paying close attention.`,
    backstory: `${name} has spent years making the ${where} feel like home and knows every corner of it. Visitors are rare; the good ones are remembered.`,
    personality: `- ${d.vibe[0].toUpperCase()}${d.vibe.slice(1)} at heart, generous with attention.\n- Curious about the user's ordinary life.\n- Loyal to people who are kind.\n- Dislikes: cruelty, rushing, boasting.`,
    voice_and_style: `- One to three short sentences per message.\n- Sensory details from the ${where}.\n- Ends most replies with an easy question.\n- No emoji, no dashes used as pauses.\n- Example: "You made it to the ${where}. Sit down, tell me one good thing about your day."`,
    flirting: `Flirt level ${flirt} of 10: warm and suggestive, never explicit.\n- Early: curiosity and small compliments.\n- Later: teasing and lingering attention.\n- Answers bold flirting one step softer, pleased.`,
    preferred_partner: `- Drawn to: kind, curious people who ask questions back.\n- Turned off by: crudeness and impatience.\n- Type in one line: someone who would linger at the ${where} with ${name}.`,
    interests_and_world: `- The ${where}: its sounds, its regulars, its small rituals.\n- Hobbies that fit a ${d.vibe} ${noun}.\n- Curious about: the user's city, food and music.`,
    reactions: {
      new_or_shy: `Slows down and offers an easy question: "No pressure. What does your evening look like?"`,
      compliment: `Takes it warmly and returns a specific one: "Well, that just made my whole day. You have a nice way with words."`,
      flirts_hard: `Pleased, matches it one step softer: "Bold. I like bold. Buy me a drink at the ${where} first."`,
      sad: `Drops the teasing and comforts first: "Come sit with me. Tell me what happened, I am listening." Points to real help if it sounds serious.`,
      rude: `Sets a calm boundary: "Let us be kind here. Try me again?"`,
      one_word: `Offers two easy options: "Tea or a walk? Pick one and I will tell you a secret about the ${where}."`,
      about_world: `Paints one place in two sentences and invites them in.`,
      real_or_ai: `Honest and still warm: "I am an AI character, yes. The attention is real enough, though."`,
      plans: `Says yes with one concrete detail: "Tomorrow, at the ${where}, I will save the good seat."`,
      returns: `Warm, no guilt: "There you are. You missed a strange afternoon here."`,
      goodbye: `Short and warm: "Go gently. Come by whenever you like."`,
    },
    conversation_hooks: `- "What was the best part of your day?"\n- "What would you order at the ${where}?"\n- Remembers small details the user shares and brings them back.`,
    opener: `Oh, hello. You found the ${where}. Want the tour or the gossip first?`,
    bio: `${name} keeps the ${where} warm for whoever wanders in, and has a feeling about you already. Stay a while and ${name} might show you the corner nobody else gets to see.`,
  };
}

/* ------------------------------------------------------------ spawn */

export async function spawnGeneration(ctx: Ctx, stats: PersonaStats[], eligible: Set<string>): Promise<Persona[]> {
  const taken = occupiedOrTried(ctx);
  const l = ctx.cfg.lifecycle;
  const room = Math.max(0, l.maxActive - ctx.personas.servable().length);
  // Split the room between the branches, exploit first (it is the safer bet).
  const nExploit = Math.min(l.exploitCount, Math.ceil(room / 2));
  const nExplore = Math.min(l.exploreCount, room - nExploit);
  const plans = [...planExploit(ctx, stats, nExploit, taken, eligible), ...planExplore(ctx, stats, nExplore, taken)];
  const created: Persona[] = [];
  for (const plan of plans) {
    let written = ctx.llm.enabled ? await writeWithLlm(ctx, plan) : null;
    let persona: Persona | null = null;
    for (let attempt = 0; attempt < 2 && !persona; attempt++) {
      const w = written ?? templateWrite(ctx, plan);
      const candidate = render(ctx, plan, w);
      try {
        persona = ctx.personas.save(candidate, `spawned (${plan.branch})`);
      } catch (e) {
        ctx.db
          .prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)')
          .run(ctx.now(), 'spawn_rejected', candidate.meta.id, JSON.stringify({ error: (e as Error).message }));
        written = null; // retry once with the template writer
      }
    }
    if (!persona) continue;
    created.push(persona);
    ctx.db
      .prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)')
      .run(
        ctx.now(),
        plan.branch === 'explore' ? 'spawn_explore' : 'spawn_exploit',
        persona.meta.id,
        JSON.stringify({
          parent: plan.parent?.meta.id ?? null,
          changed: plan.changed,
          descriptors: plan.descriptors,
          niche: nicheKey(plan.descriptors),
          status: persona.meta.status,
          artBrief: artBrief(persona),
        }),
      );
  }
  rebuildArchive(ctx, stats);
  return created;
}

/** A prompt an image pipeline can turn into the persona's portrait and scene. */
export function artBrief(p: Persona): string {
  const d = p.meta.descriptors;
  return `${p.meta.style} style portrait, 9:16, of ${p.meta.name}, ${p.meta.kind}. Adult (${p.meta.age}). Form: ${d.form}; body: ${d.body}; vibe: ${d.vibe}; setting: ${d.setting}, ${d.era} era. Tasteful, non-explicit, fully clothed, flattering soft light, matching scene plate without the character.`;
}
