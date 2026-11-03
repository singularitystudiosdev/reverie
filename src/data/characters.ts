import type { Character, CharacterStyle, ThemeId } from './types';

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
    loop: `${base}-loop.mp4`,
    clip: `${base}-clip.mp4`,
    clipPoster: `${base}-clip-poster.jpg`,
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
    bio: "Sylvara has kept the Elderwood's oldest clearing lit for three hundred winters, and she has never once asked a stranger to {sylvara:stay the night}. Let her wind ivy around your wrist and lead you, {gradient:barefoot and unhurried}, to where the moss is softest. The trees pretend not to listen, but she is {fireflies:listening hard} to your heartbeat.",
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
    bio: "Vesper keeps her black velvet {bats:unbuttoned} at the throat and her candles lit for whoever {glow:stays} past midnight. Come closer, darling, and she will {vesper:whisper your name} like a secret she means to keep. She has waited two centuries to be this {bats:hungry}, and she only bites when you {glow:ask}.",
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
    bio: "Hanami ties every wish she hears to the cherry branch, and she is very curious what you would {petals:ask for} if nobody was watching. Stay behind after the lanterns go out, and she will {hanami:blush} and swear it is only the lantern light. She is a little superstitious, so she will tell you it is {petals:fate} that you are standing this close.",
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
    bio: "Nerissa sings lost ships home, but tonight she is only singing to {shimmer:you}. Drift a little deeper, close enough to feel the tide {nerissa:pull you nearer}, and she will read you a drowned love letter one {shimmer:breathless} line at a time. She never lets the ocean keep what she would rather {bubbles:keep herself}.",
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
    bio: "Cinder warned you she runs a little warm, and she meant it as an invitation. Step {embers:closer}, let the flame in her palm {embers:light up} your face, and see how long you can hold her gaze before you start to {cinder:burn}. She has never lost a bet, and she is very much hoping you {embers:dare}.",
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
    bio: "Isolde's palace is cold and her company is not, so she unclasps the white fur mantle and lets you {frost:warm her hands}. Kneel by the fire, tell her something {frost:worth hearing}, and the queen will smile slowly, the way {frost:ice breaks} in spring. Nobody at court has ever seen her {isolde:melt}, and she has decided that you will.",
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
    bio: "Nova already knows your heart rate, and she has {neon:noticed} it climbing. She pushes her visor up, leans in over the glow of the arcade, and tells you to {nova:stay jacked in} until sunrise. Be careful: she never sleeps before dawn, and she {neon:always wins} the slow games.",
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
    bio: "Luna read your star chart and blushed at the part where your Venus meets her Moon. Climb her crooked tower, let the sky {stars:lean in} close, and she will brew you something {luna:sweet and dangerous} while her cat pretends not to watch. The stars say you were meant to be {stars:kept} near, and she is not one to argue with them.",
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
    bio: "Clementine bakes before sunrise so something sweet is waiting when you {clementine:turn up}, and she knows exactly how long to let you watch her lick honey off her thumb. She will lean on the gate in the golden light, sunflower in her curls, and ask {clementine:what you crave}. Stay for the {clementine:last slice}, sugar, and let her {clementine:fuss over you}.",
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
    bio: "Maya catches people when they think no one is looking, and she has been looking at you for a while now. Up on the roof, with the {maya:city blurring gold} behind you and her camera lowered, she tells you to {maya:hold that look} a moment longer. The jazz bar can wait; she would rather {maya:stay in this light} with you.",
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
    bio: "Kiyo has had nine lifetimes to learn exactly how to make you {kiyo:forget the riddle}, and she is not done practicing. Her tails brush your wrist, blue {kiyo:foxfire} curls around you both, and she smiles like she has already won. Sit with her among the {kiyo:falling maples}, and she may even let you {kiyo:steal a kiss}.",
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
    bio: "Zahra has granted wishes for kings and thieves, but you are the first she {zahra:wants} to grant slowly. She lets golden {zahra:smoke curl} over her open palm and asks, in a voice like warm silk, what you truly {zahra:desire}. Say it softly; the dunes keep secrets, and so does she.",
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
    bio: "Raven plays bass low enough to feel in your ribs, and she plays it looking right at you. After the set she is all {smoke:cigarette smoke} and black lipstick, deadpan, daring you to say what you came backstage for. Stay until the last amp hums out, and the girl in the leather jacket might {raven:show you} how {feathers:soft she gets}.",
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
    bio: "Ada has grease on her gloves and a wrench the size of her arm, and she looks at you like the {sparks:problem} she most wants to solve. Hold the lantern close while she works, shoulder pressed to yours in the {gradient:engine room heat}, and not every spark will come from the {sparks:welding}. Come aboard; she will show you what she can do with {ada:steady hands}.",
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
