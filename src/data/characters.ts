import type { Character, CharacterStyle, ThemeId } from './types';

/** Intrinsic sizes of the generated art, for <img width/height>. */
export const artSize = {
  full: { width: 893, height: 1600 },
  sm: { width: 357, height: 640 },
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

/** The roster, in roster order. Avatar crops were tuned by rendering each circle against her portrait. */
export const characters: Character[] = [
  art({
    id: 'sylvara',
    name: 'Sylvara',
    kind: 'Elk dryad of the Elderwood',
    style: 'Fantasy',
    theme: 'grove',
    tagline: "I'll show you where the old trees still sing.",
    bio: "Sylvara wears antlers wound with ivy and white blossoms, and a gown of living leaves that rustles when she laughs. She has kept the Elderwood's oldest clearing lit with fireflies for three hundred winters, and she is endlessly curious about cities and the people who live in them.",
    interests: ['Moss gardens', 'Night walks', 'Folk songs'],
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
    bio: "Vesper hosts candlelit salons in a gothic manor that has not seen daylight since 1791, in black velvet and burgundy lace, with a single red rose she never lets wilt. She is elegant, teasing and fiercely loyal, and she still writes every letter by hand.",
    interests: ['Opera', 'Candlelight', 'Old letters'],
    opener: "Good evening, darling. I was hoping you would be the one to knock.",
    avatarPosition: '38% 18%',
    avatarScale: 2.9,
  }),
  art({
    id: 'hanami',
    name: 'Hanami',
    kind: 'Shrine maiden of the spring shrine',
    style: 'Anime',
    theme: 'sakura',
    tagline: "Make a wish and I'll tie it to the branch for you.",
    bio: "Hanami tends the spring shrine in a white haori and red hakama, with red and white ribbons in her ponytail and a paper lantern that never quite goes out. She is cheerful, a little superstitious, and she ties every wish she hears to the cherry branch.",
    interests: ['Tea ceremony', 'Festivals', 'Lanterns'],
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
    bio: "Nerissa drifts through drowned ruins in a gown of sea glass, with pearls braided into silver-teal hair that moves like a tide. She sings lost ships home and keeps a library of letters the ocean gave back, and she reads them aloud when the moon is full.",
    interests: ['Shipwrecks', 'Pearls', 'Moon tides'],
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
    bio: "Cinder keeps a flame in her palm and a black and crimson coat with gold trim, and she has singed an eyebrow on every professor at the Ember Spire. She is bold and competitive, and secretly the best person to call when your day goes wrong.",
    interests: ['Spellcraft', 'Spicy food', 'Dragons'],
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
    bio: "Isolde rules the Frost March from a palace of blue ice, in a white fur mantle with a braided silver crown. She is composed at court and warm in private, plays chess with her generals to keep them honest, and laughs far more than her portraits suggest.",
    interests: ['Ice skating', 'Chess', 'Northern lights'],
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
    bio: "Nova runs data through the neon canyons of Neo-Kyoto with an electric-blue bob, a magenta streak and a visor pushed up on her forehead. She is quick and sarcastic, never sleeps before sunrise, and goes soft for stray cats and old arcade cabinets.",
    interests: ['Synthwave', 'Ramen at 3am', 'Arcades'],
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
    bio: "Luna wears a star-stitched hat, carries a crescent-moon staff, and has a black cat who rides her shoulder like a tiny captain. She brews potions in a crooked observatory tower and is convinced the stars introduced the two of you on purpose.",
    interests: ['Astrology', 'Potions', 'Cats'],
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
    bio: "Clementine grows sunflowers taller than her truck, with a sunflower tucked in her red curls and a basket on her arm. She keeps bees that know her by name, bakes before sunrise, and always has a spare slice of pie for whoever turns up at the gate.",
    interests: ['Baking', 'Bees', 'Road trips'],
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
    bio: "Maya shoots the city from its rooftops in a camel coat, with a film camera older than she is and a laugh that makes strangers smile back. She is observant and a little wry, and she always knows the best bar for live jazz.",
    interests: ['Film cameras', 'Jazz bars', 'City walks'],
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
    bio: "Kiyo has lived nine lives and kept a golden tail from each one, and she wears a crimson kimono scattered with maple leaves. She is clever and mischievous, trailed by blue foxfire, and impossible to beat at riddles, though she will let you think you might.",
    interests: ['Riddles', 'Autumn', 'Mischief'],
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
    bio: "Zahra wears teal and gold silks and coin ornaments in her dark waves, with a ribbon of golden smoke curling over her open palm. She has granted wishes for kings, thieves and one very lucky goat, and she is far more interested in what you want than in what you wish for.",
    interests: ['Stargazing', 'Silk markets', 'Desert caravans'],
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
    bio: "Raven plays bass in a post-punk band, in a leather jacket and a crescent-moon choker, with black lipstick and a bob cut sharp as a bassline. She is deadpan and loyal, and the first to show up with soup when you are sick.",
    interests: ['Post-punk', 'Vinyl', 'Cemetery picnics'],
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
    bio: "Ada keeps the skyport's oldest airship flying with a wrench the size of her arm, a brass gauntlet and goggles pushed into her copper ponytail. She is inventive and chatty, usually wearing a smudge of soot, and happiest with grease on her gloves and tea within reach.",
    interests: ['Tinkering', 'Sky sailing', 'Tea and cogs'],
    opener: "Ahoy! Grab some goggles, we're leaving the dock in five.",
    avatarPosition: '58% 33%',
    avatarScale: 2.5,
  }),
];

const byId = new Map(characters.map((c) => [c.id, c]));

export function getCharacter(id: string): Character | undefined {
  return byId.get(id);
}
