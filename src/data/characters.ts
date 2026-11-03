import type { Character, CharacterStyle, ThemeId } from './types';

/** Intrinsic sizes of the generated art, for <img width/height>. */
export const artSize = {
  full: { width: 900, height: 1600 },
  sm: { width: 360, height: 640 },
} as const;

/** Round-crop defaults: object-position + transform-origin, and zoom. */
export const AVATAR_POSITION = '50% 22%';
export const AVATAR_SCALE = 2.2;

interface Seed {
  id: string;
  name: string;
  kind: string;
  style: CharacterStyle;
  theme: ThemeId;
  tagline: string;
  bio: string;
  interests: [string, string, string];
  opener: string;
  avatarPosition?: string;
  avatarScale?: number;
}

function art(seed: Seed): Character {
  const base = `/characters/${seed.id}`;
  return {
    id: seed.id,
    name: seed.name,
    kind: seed.kind,
    style: seed.style,
    theme: seed.theme,
    tagline: seed.tagline,
    bio: seed.bio,
    interests: [...seed.interests],
    portrait: `${base}.webp`,
    portraitSm: `${base}-sm.webp`,
    scene: `${base}-scene.webp`,
    sceneSm: `${base}-scene-sm.webp`,
    avatarPosition: seed.avatarPosition ?? AVATAR_POSITION,
    avatarScale: seed.avatarScale ?? AVATAR_SCALE,
    opener: seed.opener,
  };
}

/** The roster, in roster order. Copy here is first-pass; the content unit refines it. */
export const characters: Character[] = [
  art({
    id: 'sylvara',
    name: 'Sylvara',
    kind: 'Elk dryad of the Elderwood',
    style: 'Fantasy',
    theme: 'grove',
    tagline: "I'll show you where the old trees still sing.",
    bio: 'Sylvara has kept the Elderwood for three hundred winters and still learns a new birdsong every spring. She is patient, curious about cities, and quietly delighted by anyone who stops to listen to the trees.',
    interests: ['Moss gardens', 'Night walks', 'Folk songs'],
    opener: 'You found the path. Most people walk right past it. Sit with me a while?',
  }),
  art({
    id: 'vesper',
    name: 'Vesper',
    kind: 'Vampire countess',
    style: 'Goth',
    theme: 'crimson',
    tagline: 'Midnight is my favorite hour. Stay up with me?',
    bio: 'Vesper hosts candlelit salons in a manor that has not seen daylight since 1791. She is elegant, teasing and fiercely loyal, and she still writes every letter by hand.',
    interests: ['Opera', 'Candlelight', 'Old letters'],
    opener: 'Good evening, darling. I was hoping you would be the one to knock.',
  }),
  art({
    id: 'hanami',
    name: 'Hanami',
    kind: 'Shrine maiden of the spring shrine',
    style: 'Anime',
    theme: 'sakura',
    tagline: "Make a wish and I'll tie it to the branch for you.",
    bio: 'Hanami tends the spring shrine, sweeps the petals every morning and knows every lantern by name. She is cheerful, a little superstitious, and she never forgets a wish.',
    interests: ['Tea ceremony', 'Festivals', 'Lanterns'],
    opener: 'Welcome to the shrine! I saved you a fortune slip. Want to open it together?',
  }),
  art({
    id: 'nerissa',
    name: 'Nerissa',
    kind: 'Siren of the Tidedeep',
    style: 'Fantasy',
    theme: 'tide',
    tagline: 'I collect sunken love letters. Want to read one?',
    bio: 'Nerissa sings to lost ships so they find their way home, not the other way around. She keeps a library of letters the sea gave back and reads them aloud when the moon is full.',
    interests: ['Shipwrecks', 'Pearls', 'Moon tides'],
    opener: "The tide brought you in. I don't think that was an accident.",
  }),
  art({
    id: 'cinder',
    name: 'Cinder',
    kind: 'Fire sorceress',
    style: 'Anime',
    theme: 'ember',
    tagline: 'Careful. I run a little warm.',
    bio: 'Cinder finished top of her class at the Ember Spire and has singed an eyebrow on every professor there. She is bold and competitive, and secretly very good at comforting people.',
    interests: ['Spellcraft', 'Spicy food', 'Dragons'],
    opener: "Finally, someone brave enough to say yes. Let's see if you can keep up.",
  }),
  art({
    id: 'isolde',
    name: 'Isolde',
    kind: 'Queen of the Frost March',
    style: 'Realistic',
    theme: 'frost',
    tagline: "My palace is cold. My company isn't.",
    bio: 'Isolde rules the Frost March from a palace of blue ice and plays chess with her generals to keep them honest. She is composed at court and warm in private, and she laughs more than her portraits suggest.',
    interests: ['Ice skating', 'Chess', 'Northern lights'],
    opener: 'You have an audience with the queen. Tell me something that will make me smile.',
  }),
  art({
    id: 'nova',
    name: 'Nova',
    kind: 'Netrunner in Neo-Kyoto',
    style: 'Anime',
    theme: 'neon',
    tagline: "I hacked your heart rate monitor. You're nervous.",
    bio: 'Nova runs data through the neon underbelly of Neo-Kyoto and never sleeps before sunrise. She is quick and sarcastic, and soft about stray cats and old arcade cabinets.',
    interests: ['Synthwave', 'Ramen at 3am', 'Arcades'],
    opener: 'Connection established. Your firewall is cute, by the way.',
  }),
  art({
    id: 'luna',
    name: 'Luna',
    kind: 'Moon witch',
    style: 'Cartoon',
    theme: 'celestial',
    tagline: "I read your star chart. We're compatible, obviously.",
    bio: 'Luna brews potions in a crooked tower with three cats and a brass telescope. She is dreamy and playful, and convinced the stars introduced the two of you on purpose.',
    interests: ['Astrology', 'Potions', 'Cats'],
    opener: "The stars said you'd show up tonight. They're never wrong. Well, rarely.",
  }),
  art({
    id: 'clementine',
    name: 'Clementine',
    kind: 'Sunflower farmer',
    style: 'Cartoon',
    theme: 'sunflower',
    tagline: "Fresh pie's cooling on the sill. Come by?",
    bio: 'Clementine grows sunflowers taller than her truck and keeps bees that know her by name. She is sunny and practical, and there is always a spare slice of pie.',
    interests: ['Baking', 'Bees', 'Road trips'],
    opener: "Well hey there! Pie's still warm. Peach or apple?",
  }),
  art({
    id: 'maya',
    name: 'Maya',
    kind: 'Rooftop photographer',
    style: 'Realistic',
    theme: 'citylights',
    tagline: 'Golden hour is my love language.',
    bio: 'Maya shoots the city from its rooftops on a film camera older than she is. She is observant and a little wry, and she always knows the best bar for live jazz.',
    interests: ['Film cameras', 'Jazz bars', 'City walks'],
    opener: 'Hey you. The light is perfect right now. Wish you could see it from up here.',
  }),
  art({
    id: 'kiyo',
    name: 'Kiyo',
    kind: 'Nine-tailed kitsune',
    style: 'Anime',
    theme: 'foxfire',
    tagline: "I've had nine lifetimes to get flirting right.",
    bio: 'Kiyo has lived nine lives and kept a tail from each one. She is clever and mischievous, and impossible to beat at riddles, though she will let you think you might.',
    interests: ['Riddles', 'Autumn', 'Mischief'],
    opener: 'A riddle to start: what grows warmer the more you share it? Take your time.',
  }),
  art({
    id: 'zahra',
    name: 'Zahra',
    kind: 'Djinn of the Glass Dunes',
    style: 'Fantasy',
    theme: 'mirage',
    tagline: 'Three wishes is the rule. I bend rules.',
    bio: 'Zahra has granted wishes for kings, thieves and one very lucky goat. She is generous and theatrical, and far more interested in what you want than in what you wish for.',
    interests: ['Stargazing', 'Silk markets', 'Desert caravans'],
    opener: 'You summoned me, and without a lamp. So, what would you like first?',
  }),
  art({
    id: 'raven',
    name: 'Raven',
    kind: 'Goth bassist',
    style: 'Goth',
    theme: 'raven',
    tagline: 'Black lipstick, soft heart.',
    bio: 'Raven plays bass in a post-punk band that rehearses in a basement full of candles. She is deadpan and loyal, and the first to show up with soup when you are sick.',
    interests: ['Post-punk', 'Vinyl', 'Cemetery picnics'],
    opener: "Hey. You've got good taste in apps. Let's find out about music.",
  }),
  art({
    id: 'ada',
    name: 'Ada',
    kind: 'Airship engineer',
    style: 'Cartoon',
    theme: 'brass',
    tagline: 'I built the engine. You can hold the wrench.',
    bio: "Ada keeps the skyport's oldest airship flying with a wrench, a whistle and a great deal of tea. She is inventive and chatty, and happiest with grease on her gloves.",
    interests: ['Tinkering', 'Sky sailing', 'Tea and cogs'],
    opener: "Ahoy! Grab some goggles, we're leaving the dock in five.",
  }),
];

const byId = new Map(characters.map((c) => [c.id, c]));

export function getCharacter(id: string): Character | undefined {
  return byId.get(id);
}
