import type { Character, CharacterStyle, ThemeId } from './types';
import { asset } from '../lib/asset';
import { starterSeeds } from './starters.generated';

/** Intrinsic sizes of the generated art, for <img width/height>. */
export const artSize = {
  full: { width: 893, height: 1600 },
  sm: { width: 357, height: 640 },
  /** The animated loops (public/characters/<id>-loop.mp4). */
  loop: { width: 720, height: 1280 },
} as const;

/** Round-crop defaults: object-position + transform-origin, and zoom. */
export const AVATAR_POSITION = '50% 22%';
export const AVATAR_SCALE = 2.2;

/**
 * Crop a point of a 9:16 plate into a square thumbnail. `fx`/`fy` are the
 * feature's position as 0..1 fractions of the image, `zoom` how far to punch
 * in. Returns the shared object-position + transform-origin string and the
 * scale, solved so the feature lands in the middle of the square (clamped at
 * the plate's edges). Same maths the avatar crops were tuned with.
 */
export function cropFor(fx: number, fy: number, zoom: number): { position: string; scale: number } {
  const aspect = artSize.sm.height / artSize.sm.width;
  const ox = (zoom * fx - 0.5) / (zoom - 1);
  const oy = (aspect * zoom * fy - 0.5) / (aspect * zoom - 1);
  const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`;
  return { position: `${pct(ox)} ${pct(oy)}`, scale: zoom };
}

interface Seed {
  id: string;
  name: string;
  kind: string;
  style: CharacterStyle;
  theme: ThemeId;
  tagline: string;
  bio: string;
  opener: string;
  avatarPosition?: string;
  avatarScale?: number;
}

function art(seed: Seed): Character {
  const base = asset(`/characters/${seed.id}`);
  return {
    id: seed.id,
    name: seed.name,
    kind: seed.kind,
    style: seed.style,
    theme: seed.theme,
    tagline: seed.tagline,
    bio: seed.bio,
    portrait: `${base}.webp`,
    portraitSm: `${base}-sm.webp`,
    loop: `${base}-loop.mp4`,
    clip: `${base}-clip.mp4`,
    clipPoster: `${base}-clip-poster.jpg`,
    scene: `${base}-scene.webp`,
    sceneSm: `${base}-scene-sm.webp`,
    sceneLoop: `${base}-scene-loop.mp4`,
    avatarPosition: seed.avatarPosition ?? AVATAR_POSITION,
    avatarScale: seed.avatarScale ?? AVATAR_SCALE,
    opener: seed.opener,
  };
}

/**
 * A starter persona (server/personas/<id>.md, exported by
 * scripts/starters/export.mjs): a profile still, a profile video loop and a
 * background only. No video message (clip) and no animated background.
 */
export interface StarterSeed {
  id: string;
  name: string;
  kind: string;
  style: CharacterStyle;
  theme: ThemeId;
  tagline: string;
  bio: string;
  opener: string;
  loop: boolean;
  scene: boolean;
  avatarPosition?: string;
  avatarScale?: number;
}

function starter(seed: StarterSeed): Character {
  const base = asset(`/characters/${seed.id}`);
  const portrait = `${base}.webp`;
  const portraitSm = `${base}-sm.webp`;
  return {
    id: seed.id,
    name: seed.name,
    kind: seed.kind,
    style: seed.style,
    theme: seed.theme,
    tagline: seed.tagline,
    bio: seed.bio,
    portrait,
    portraitSm,
    loop: seed.loop ? `${base}-loop.mp4` : '',
    clip: '',
    clipPoster: portrait,
    scene: seed.scene ? `${base}-scene.webp` : '',
    sceneSm: seed.scene ? `${base}-scene-sm.webp` : portraitSm,
    sceneLoop: '',
    avatarPosition: seed.avatarPosition ?? AVATAR_POSITION,
    avatarScale: seed.avatarScale ?? AVATAR_SCALE,
    opener: seed.opener,
  };
}

/**
 * The looping scene video that belongs to a scene still (the string the
 * screens hand to setTheme / setPreview), or null when no character owns it.
 * The one place a still maps to its loop.
 */
export function sceneLoopFor(sceneSrc: string | null): string | null {
  if (!sceneSrc) return null;
  return characters.find((c) => c.scene === sceneSrc)?.sceneLoop || null;
}

/** The roster, in roster order. Avatar crops were tuned by rendering each circle against her portrait. */
export const characters: Character[] = [
  art({
    id: 'sylvara',
    name: 'Sylvara',
    kind: 'Elk dryad of the Elderwood',
    style: 'Fantasy',
    theme: 'grove',
    tagline: "I'll show you where the old trees still sing.",
    bio: "Sylvara has kept the Elderwood's oldest clearing lit for three hundred winters, and she has never once asked a stranger to {sylvara:stay the night}. Let her wind ivy around your wrist and lead you, {sylvara:barefoot and unhurried}, to where the moss is softest. The trees pretend not to listen, but she is {sylvara:listening hard} to your heartbeat.",
    opener: "You found the path. Most people walk right past it. Sit with me a while?",
    avatarPosition: '47% 28%',
    avatarScale: 2.4,
  }),
  art({
    id: 'vesper',
    name: 'Vesper',
    kind: 'Vampire countess',
    style: 'Goth',
    theme: 'crimson',
    tagline: 'Midnight is my favorite hour. Stay up with me?',
    bio: "Vesper keeps her black velvet {vesper:unbuttoned} at the throat and her candles lit for whoever {vesper:stays} past midnight. Come closer, darling, and she will {vesper:whisper your name} like a secret she means to keep. She has waited two centuries to be this {vesper:hungry}, and she only bites when you {vesper:ask}.",
    opener: "Good evening, darling. I was hoping you would be the one to knock.",
    avatarPosition: '38% 18%',
    avatarScale: 2.9,
  }),
  art({
    id: 'hanami',
    name: 'Hanami',
    kind: 'Keeper of the spring shrine',
    style: 'Anime',
    theme: 'sakura',
    tagline: "Make a wish and I'll tie it to the branch for you.",
    bio: "Hanami ties every wish she hears to the cherry branch, and she is very curious what you would {hanami:ask for} if nobody was watching. Stay behind after the lanterns go out, and she will {hanami:blush} and swear it is only the lantern light. She is a little superstitious, so she will tell you it is {hanami:fate} that you are standing this close.",
    opener: "Welcome to the shrine! I saved you a fortune slip. Want to open it together?",
    avatarPosition: '50% 27%',
    avatarScale: 2.5,
  }),
  art({
    id: 'nerissa',
    name: 'Nerissa',
    kind: 'Siren of the Tidedeep',
    style: 'Fantasy',
    theme: 'tide',
    tagline: 'I collect sunken love letters. Want to read one?',
    bio: "Nerissa sings lost ships home, but tonight she is only singing to {nerissa:you}. Drift a little deeper, close enough to feel the tide {nerissa:pull you nearer}, and she will read you a drowned love letter one {nerissa:breathless} line at a time. She never lets the ocean keep what she would rather {nerissa:keep herself}.",
    opener: "The tide brought you in. I don't think that was an accident.",
    avatarPosition: '45% 12%',
    avatarScale: 2.9,
  }),
  art({
    id: 'cinder',
    name: 'Cinder',
    kind: 'Fire sorceress',
    style: 'Anime',
    theme: 'ember',
    tagline: 'Careful. I run a little warm.',
    bio: "Cinder warned you she runs a little warm, and she meant it as an invitation. Step {cinder:closer}, let the flame in her palm {cinder:light up} your face, and see how long you can hold her gaze before you start to {cinder:burn}. She has never lost a bet, and she is very much hoping you {cinder:dare}.",
    opener: "Finally, someone brave enough to say yes. Let's see if you can keep up.",
    avatarPosition: '48% 20%',
    avatarScale: 2.5,
  }),
  art({
    id: 'isolde',
    name: 'Isolde',
    kind: 'Queen of the Frost March',
    style: 'Realistic',
    theme: 'frost',
    tagline: "My palace is cold. My company isn't.",
    bio: "Isolde's palace is cold and her company is not, so she unclasps the white fur mantle and lets you {isolde:warm her hands}. Kneel by the fire, tell her something {isolde:worth hearing}, and the queen will smile slowly, the way {isolde:ice breaks} in spring. Nobody at court has ever seen her {isolde:melt}, and she has decided that you will.",
    opener: "You have an audience with the queen. Tell me something that will make me smile.",
    avatarPosition: '52% 32%',
    avatarScale: 2.5,
  }),
  art({
    id: 'nova',
    name: 'Nova',
    kind: 'Netrunner in Neo-Kyoto',
    style: 'Anime',
    theme: 'neon',
    tagline: "I hacked your heart rate monitor. You're nervous.",
    bio: "Nova already knows your heart rate, and she has {nova:noticed} it climbing. She pushes her visor up, leans in over the glow of the arcade, and tells you to {nova:stay jacked in} until sunrise. Be careful: she never sleeps before dawn, and she {nova:always wins} the slow games.",
    opener: "Connection established. Your firewall is cute, by the way.",
    avatarPosition: '72% 33%',
    avatarScale: 2.2,
  }),
  art({
    id: 'luna',
    name: 'Luna',
    kind: 'Moon witch',
    style: 'Cartoon',
    theme: 'celestial',
    tagline: "I read your star chart. We're compatible, obviously.",
    bio: "Luna read your star chart and blushed at the part where your Venus meets her Moon. Climb her crooked tower, let the sky {luna:lean in} close, and she will brew you something {luna:sweet and dangerous} while her cat pretends not to watch. The stars say you were meant to be {luna:kept} near, and she is not one to argue with them.",
    opener: "The stars said you'd show up tonight. They're never wrong. Well, rarely.",
    avatarPosition: '45% 32%',
    avatarScale: 2.5,
  }),
  art({
    id: 'clementine',
    name: 'Clementine',
    kind: 'Sunflower farmer',
    style: 'Cartoon',
    theme: 'sunflower',
    tagline: "Fresh pie's cooling on the sill. Come by?",
    bio: "Clementine bakes before sunrise so something sweet is waiting when you {clementine:turn up}, and she knows exactly how long to let you watch her lick honey off her thumb. She will lean on the gate in the golden light, sunflower in her curls, and ask {clementine:what you crave}. Stay for the {clementine:last slice}, sugar, and let her {clementine:fuss over you}.",
    opener: "Well hey there! Pie's still warm. Peach or apple?",
    avatarPosition: '42% 41%',
    avatarScale: 2.5,
  }),
  art({
    id: 'maya',
    name: 'Maya',
    kind: 'Rooftop photographer',
    style: 'Realistic',
    theme: 'citylights',
    tagline: 'Golden hour is my love language.',
    bio: "Maya catches people when they think no one is looking, and she has been looking at you for a while now. Up on the roof, with the {maya:city blurring gold} behind you and her camera lowered, she tells you to {maya:hold that look} a moment longer. The jazz bar can wait; she would rather {maya:stay in this light} with you.",
    opener: "Hey you. The light is perfect right now. Wish you could see it from up here.",
    avatarPosition: '48% 36%',
    avatarScale: 2.5,
  }),
  art({
    id: 'kiyo',
    name: 'Kiyo',
    kind: 'Nine-tailed kitsune',
    style: 'Anime',
    theme: 'foxfire',
    tagline: "I've had nine lifetimes to get flirting right.",
    bio: "Kiyo has had nine lifetimes to learn exactly how to make you {kiyo:forget the riddle}, and she is not done practicing. Her tails brush your wrist, blue {kiyo:foxfire} curls around you both, and she smiles like she has already won. Sit with her among the {kiyo:falling maples}, and she may even let you {kiyo:steal a kiss}.",
    opener: "A riddle to start: what grows warmer the more you share it? Take your time.",
    avatarPosition: '46% 14%',
    avatarScale: 2.3,
  }),
  art({
    id: 'zahra',
    name: 'Zahra',
    kind: 'Djinn of the Glass Dunes',
    style: 'Fantasy',
    theme: 'mirage',
    tagline: 'Three wishes is the rule. I bend rules.',
    bio: "Zahra has granted wishes for kings and thieves, but you are the first she {zahra:wants} to grant slowly. She lets golden {zahra:smoke curl} over her open palm and asks, in a voice like warm silk, what you truly {zahra:desire}. Say it softly; the dunes keep secrets, and so does she.",
    opener: "You summoned me, and without a lamp. So, what would you like first?",
    avatarPosition: '39% 14%',
    avatarScale: 2.6,
  }),
  art({
    id: 'raven',
    name: 'Raven',
    kind: 'Goth bassist',
    style: 'Goth',
    theme: 'raven',
    tagline: 'Black lipstick, soft heart.',
    bio: "Raven plays bass low enough to feel in your ribs, and she plays it looking right at you. After the set she is all {raven:cigarette smoke} and black lipstick, deadpan, daring you to say what you came backstage for. Stay until the last amp hums out, and the woman in the leather jacket might {raven:show you} how {raven:soft she gets}.",
    opener: "Hey. You've got good taste in apps. Let's find out about music.",
    avatarPosition: '48% 36%',
    avatarScale: 2.5,
  }),
  art({
    id: 'ada',
    name: 'Ada',
    kind: 'Airship engineer',
    style: 'Cartoon',
    theme: 'brass',
    tagline: 'I built the engine. You can hold the wrench.',
    bio: "Ada has grease on her gloves and a wrench the size of her arm, and she looks at you like the {ada:problem} she most wants to solve. Hold the lantern close while she works, shoulder pressed to yours in the {ada:engine room heat}, and not every spark will come from the {ada:welding}. Come aboard; she will show you what she can do with {ada:steady hands}.",
    opener: "Ahoy! Grab some goggles, we're leaving the dock in five.",
    avatarPosition: '58% 33%',
    avatarScale: 2.5,
  }),
  // The 100 starter personas follow the launch roster.
  ...starterSeeds.map(starter),
];

const byId = new Map(characters.map((c) => [c.id, c]));

export function getCharacter(id: string): Character | undefined {
  return byId.get(id);
}

/** A persona card from the backend (server/personas/<id>.md, served by /v1/feed). */
export interface RemoteCharacterCard {
  id: string;
  name: string;
  kind: string;
  style: CharacterStyle;
  theme: ThemeId;
  tagline: string;
  bio: string;
  opener: string;
  art: Partial<Record<'portrait' | 'portraitSm' | 'loop' | 'clip' | 'clipPoster' | 'scene' | 'sceneSm' | 'sceneLoop', string>>;
}

/** Root-relative art paths resolve against the app base; absolute URLs (generated art) pass through. */
function artUrl(path: string | undefined, fallback: string): string {
  if (!path) return fallback;
  return /^https?:\/\//.test(path) ? path : asset(path);
}

/**
 * Add a persona the backend created (the evolution loop's new personas) to the
 * roster, so the deck, chat and profile screens can show it like a launch
 * character. Personas already in the roster keep their local definition.
 * Returns false when the card has no portrait (nothing to draw yet).
 */
export function registerRemoteCharacter(card: RemoteCharacterCard): boolean {
  if (byId.has(card.id)) return true;
  if (!card.art.portrait) return false;
  const portrait = artUrl(card.art.portrait, '');
  const scene = artUrl(card.art.scene, portrait);
  const c: Character = {
    id: card.id,
    name: card.name,
    kind: card.kind,
    style: card.style,
    theme: card.theme,
    tagline: card.tagline,
    bio: card.bio,
    portrait,
    portraitSm: artUrl(card.art.portraitSm, portrait),
    loop: artUrl(card.art.loop, ''),
    clip: artUrl(card.art.clip, ''),
    clipPoster: artUrl(card.art.clipPoster, portrait),
    scene,
    sceneSm: artUrl(card.art.sceneSm, scene),
    sceneLoop: artUrl(card.art.sceneLoop, ''),
    avatarPosition: AVATAR_POSITION,
    avatarScale: AVATAR_SCALE,
    opener: card.opener,
  };
  characters.push(c);
  byId.set(c.id, c);
  return true;
}
