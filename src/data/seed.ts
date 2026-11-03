import { cropFor, getCharacter } from './characters';
import type { CardItem, Conversation, Message } from './types';
import { time } from '../lib/time';

/** Characters already matched on first launch, most recent activity first. */
export const initialMatchIds: string[] = ['vesper', 'nova', 'maya', 'luna', 'hanami'];

/**
 * The Explore deck order. The deck is everyone not matched and not passed;
 * it follows this list (then roster order for anyone not listed).
 */
export const deckOrder: string[] = [
  'sylvara',
  'kiyo',
  'nerissa',
  'cinder',
  'isolde',
  'clementine',
  'zahra',
  'raven',
  'ada',
];

const { MINUTE, HOUR, DAY } = time;

/*
  Seed lengths drive the atmosphere's affinity (min(1, messages / 40)), so the
  five histories differ on purpose: vesper 36, nova 28, maya 20, luna 14,
  hanami 8. Each carries exactly one cards message. Newest activity: vesper
  3 minutes ago (1 unread) and nova 9 minutes ago (2 unread).
*/

/** One scripted line: [who, text] or [who, cards]. */
type Line = ['her' | 'me', string | CardItem[]];

/** A run of lines, the first at `startAgo`, each later one `step` closer to now. */
interface Run {
  startAgo: number;
  step: number;
  lines: Line[];
}

function thread(characterId: string, now: number, unread: number, runs: Run[]): Conversation {
  const messages: Message[] = [];
  for (const run of runs) {
    run.lines.forEach(([from, body], i) => {
      const at = now - run.startAgo + i * run.step;
      const id = `seed-${characterId}-${messages.length + 1}`;
      messages.push(
        typeof body === 'string'
          ? { id, from, kind: 'text', text: body, at }
          : { id, from, kind: 'cards', cards: body, at }
      );
    });
  }
  return { characterId, messages, unread };
}

/** A card row whose thumbnail is a crop of her art: `at` is [x, y, zoom] on the plate. */
function card(
  characterId: string,
  art: 'scene' | 'portrait',
  title: string,
  subtitle: string,
  meta: string,
  at: [number, number, number]
): CardItem {
  const c = getCharacter(characterId);
  const crop = cropFor(at[0], at[1], at[2]);
  return {
    title,
    subtitle,
    meta,
    image: (art === 'scene' ? c?.sceneSm : c?.portraitSm) ?? '',
    imagePosition: crop.position,
    imageScale: crop.scale,
  };
}

/** Vesper: rooms of the castle you have not seen yet. */
function vesperCards(): CardItem[] {
  return [
    card('vesper', 'scene', 'The Moon Window', 'Mist, moonlight and a long view', 'Best after midnight', [0.55, 0.25, 2.4]),
    card('vesper', 'scene', 'The Candle Hall', 'Forty flames on iron stands', 'Do not breathe too hard', [0.12, 0.3, 2.6]),
    card('vesper', 'scene', 'The Rose Balcony', 'Thorns, stone and a cold wind', 'Bring a coat', [0.72, 0.72, 2.4]),
    card('vesper', 'portrait', 'The Portrait Salon', 'Where I keep my one red rose', 'Open at midnight', [0.23, 0.51, 2.4]),
    card('vesper', 'scene', 'The Long Gallery', 'Portraits that blink', 'Do not stare back', [0.5, 0.92, 2.0]),
  ];
}

/** Nova: spots in Neo-Kyoto that never sleep. */
function novaCards(): CardItem[] {
  return [
    card('nova', 'scene', 'Stall 7 Ramen', 'Tonkotsu, extra egg', 'Open until 4am', [0.8, 0.25, 2.4]),
    card('nova', 'scene', 'Pachinko Row', 'Six floors of flashing lights', 'Bring coins', [0.1, 0.55, 2.4]),
    card('nova', 'scene', 'Glass Canal', 'Every sign shows up twice', 'Best in the rain', [0.5, 0.92, 2.2]),
    card('nova', 'portrait', 'Rain Alley', 'Where I run my best code', 'Umbrella optional', [0.4, 0.12, 2.8]),
  ];
}

/** Maya: places she would take you before sunset. */
function mayaCards(): CardItem[] {
  return [
    card('maya', 'scene', "Lou's Jazz", 'Four tables and one trumpet', 'Doors at nine', [0.5, 0.08, 2.4]),
    card('maya', 'scene', 'The Textile Roof', 'Fourteen floors, one broken ladder', 'Golden hour, sharp', [0.55, 0.35, 2.4]),
    card('maya', 'portrait', 'The Darkroom', 'Red light and wet prints', 'Two days to develop', [0.49, 0.72, 2.6]),
    card('maya', 'portrait', 'Bridge Light Walk', 'Where the string lights come on', 'Thirty minutes on foot', [0.82, 0.36, 2.6]),
  ];
}

/** Luna: Friday at the tower. */
function lunaCards(): CardItem[] {
  return [
    card('luna', 'scene', 'The Telescope Dome', 'Full moon, brass lens', 'Friday, after dark', [0.7, 0.5, 2.4]),
    card('luna', 'portrait', 'Cat Council', 'Comet, Biscuit and the Professor', 'Bring snacks', [0.7, 0.42, 2.8]),
    card('luna', 'scene', 'Lantern Release', 'Paper lights up to the moon', 'Make a wish first', [0.85, 0.25, 2.6]),
  ];
}

/** Hanami: the lantern festival map. */
function hanamiCards(): CardItem[] {
  return [
    card('hanami', 'scene', 'The Torii Gate', 'Where the festival begins', 'Make a wish first', [0.5, 0.4, 2.2]),
    card('hanami', 'scene', 'Lantern Stairs', 'Ninety-nine glowing steps', 'Best at sunset', [0.5, 0.78, 2.2]),
    card('hanami', 'scene', 'The Wishing Branch', 'Where every slip gets tied', 'Bring a ribbon', [0.12, 0.15, 2.4]),
  ];
}

/** First-launch history for the initial matches, stamped relative to `now`. */
export function seedConversations(now: number): Record<string, Conversation> {
  return {
    // 36 messages, 1 unread, newest 3 minutes ago
    vesper: thread('vesper', now, 1, [
      {
        startAgo: 4 * DAY,
        step: 3 * MINUTE,
        lines: [
          ['her', 'Good evening, darling. I was hoping you would be the one to knock.'],
          ['me', 'Is it always this dark in your manor?'],
          ['her', 'Only since 1791. I find daylight rather vulgar.'],
          ['me', 'What do you do all night?'],
          ['her', 'Read old letters. Play the organ badly. Wait for interesting company.'],
          ['her', 'You may qualify.'],
          ['me', 'High praise.'],
          ['her', 'The highest. Most visitors faint in the foyer.'],
          ['me', "I'm sturdier than I look."],
          ['her', 'We shall see. Do you like opera?'],
          ['me', 'Never been, honestly.'],
          ['her', 'Never? Oh, that is a tragedy worthy of a third act.'],
        ],
      },
      {
        startAgo: 2 * DAY + 3 * HOUR,
        step: 4 * MINUTE,
        lines: [
          ['me', 'I looked up the Teatro Nero. It has a ghost, apparently.'],
          ['her', 'Three, darling. The tenor is the friendly one.'],
          ['me', 'What does one wear to a ghost opera?'],
          ['her', 'Black. Something you can dance in afterward. The ghosts insist on a waltz.'],
          ['me', "I can't waltz."],
          ['her', 'Nobody can. That is why we practice in the dark.'],
          ['me', 'Is that an invitation?'],
          ['her', 'Careful. I hold people to their promises.'],
          ['me', 'Good. I meant it.'],
          ['her', 'Then it is settled. I will have the box aired out.'],
          ['me', 'Do vampires get nervous before a date?'],
          ['her', 'Only when no one is watching. You are watching, so no.'],
        ],
      },
      {
        startAgo: 6 * HOUR,
        step: 2 * MINUTE,
        lines: [
          ['me', "Couldn't sleep. Are you up?"],
          ['her', 'Always, darling. Midnight is when the house wakes.'],
          ['her', 'Since you are here, I have drawn up some rooms of the castle you have not seen yet.'],
          ['her', vesperCards()],
          ['me', 'The Moon Window. Obviously.'],
          ['her', 'Obviously. You learn quickly.'],
          ['me', 'What happens there?'],
          ['her', 'Nothing, for hours. Then the mist comes in and everyone forgets to speak.'],
          ['me', 'Sounds perfect.'],
          ['her', 'It is. Bring a coat. The stone is cold after the third candle.'],
          ['me', "I'll bring two."],
        ],
      },
      {
        startAgo: 3 * MINUTE,
        step: MINUTE,
        lines: [
          [
            'her',
            'The ghosts approved the guest list, darling. Your name was read out twice. They find you suspicious, and delightful.',
          ],
        ],
      },
    ]),

    // 28 messages, 2 unread, newest 9 minutes ago
    nova: thread('nova', now, 2, [
      {
        startAgo: 3 * DAY,
        step: 2 * MINUTE,
        lines: [
          ['her', 'Connection established. Your firewall is cute, by the way.'],
          ['me', 'Should I be worried?'],
          ['her', 'Only if you hate ramen.'],
          ['me', 'I love ramen.'],
          ['her', 'Good answer. Promoting you to level two.'],
          ['me', 'There are levels?'],
          ['her', "Everything has levels. Most people just can't see the HUD."],
          ['me', "What's at level three?"],
          ['her', "Classified. Also I haven't decided yet."],
          ['her', 'Do you play anything? Arcades, rhythm games, chess against strangers?'],
          ['me', 'I was decent at air hockey once.'],
          ['her', 'Air hockey. Bold. I respect a physical sport.'],
          ['me', 'You?'],
          ['her', 'Rhythm games. I have a perfect run on a song nobody else has heard of.'],
        ],
      },
      {
        startAgo: 20 * HOUR,
        step: 3 * MINUTE,
        lines: [
          ['me', 'I need to hear that song you mentioned.'],
          ['her', 'Sending. Volume up, lights off.'],
          ['me', 'Okay, this is actually great.'],
          ['her', "I know. I have taste. It's the one thing I haven't hacked."],
          ['me', 'Do you ever sleep?'],
          ['her', 'Sleep is a rumor spread by people with day jobs.'],
          ['me', 'Fair. If I showed up in Neo-Kyoto, where would you take me?'],
          ['her', 'Easy. Pulling up my list.'],
          ['her', novaCards()],
          ['me', 'The ramen stall. Obviously.'],
          ['her', 'Stall 7. Extra egg. You have good instincts.'],
          ['me', 'Bring coins, I assume?'],
        ],
      },
      {
        startAgo: 9 * MINUTE,
        step: 2 * MINUTE,
        lines: [
          ['her', 'Bring coins. The claw machine next door owes me a plush.'],
          ['her', 'Also I found an air hockey table in the lower ward. Rematch rules apply. Say yes.'],
        ],
      },
    ]),

    // 20 messages, read
    maya: thread('maya', now, 0, [
      {
        startAgo: 2 * DAY + 5 * HOUR,
        step: 4 * MINUTE,
        lines: [
          ['her', 'Hey you. The light is perfect right now. Wish you could see it from up here.'],
          ['me', "Where's up here?"],
          ['her', 'Roof of the old textile building. Fourteen floors and one broken ladder.'],
          ['me', 'That sounds dangerous.'],
          ['her', 'That sounds like golden hour.'],
          ['me', 'What are you shooting?'],
          ['her', 'Pigeons, mostly. And the guy across the street who waters his plants in a suit.'],
          ['me', 'I need to see that photo.'],
          ['her', "It's on film. You'll have to wait for the darkroom."],
          ['me', 'How long does that take?'],
          ['her', "Two days if I'm patient. I'm never patient."],
        ],
      },
      {
        startAgo: 4 * HOUR,
        step: 6 * MINUTE,
        lines: [
          ['me', 'Digital would be faster, you know.'],
          ['her', 'Digital would be a lot of things. Film is honest.'],
          ['me', "Okay, that's a good line."],
          ['her', 'Steal it. Everyone does.'],
          ['me', "Where would you take me in this city? I'm new to the good parts."],
          ['her', 'Oh, I have a list. Give me a sec, here is what I would show you before sunset.'],
          ['her', mayaCards()],
          ['me', "Lou's. Four tables sounds like my speed."],
          ['her', "Knew it. I'll save you the one by the window."],
        ],
      },
    ]),

    // 14 messages, read
    luna: thread('luna', now, 0, [
      {
        startAgo: 2 * DAY,
        step: 5 * MINUTE,
        lines: [
          ['her', "The stars said you'd show up tonight. They're never wrong. Well, rarely."],
          ['me', 'What else did they say?'],
          ['her', "That you're a water sign pretending to be a fire sign."],
          ['me', "That's weirdly accurate."],
          ['her', "I know. It's a gift. Also a lot of homework."],
          ['me', 'Do you really have three cats?'],
          ['her', "Three official cats. A fourth who visits on Tuesdays and won't tell me his name."],
          ['me', 'What are the official ones called?'],
          ['her', 'Comet, Biscuit and Professor Whiskers. He has a doctorate in knocking things off tables.'],
          ['me', 'Can I meet them?'],
        ],
      },
      {
        startAgo: 26 * HOUR,
        step: 2 * MINUTE,
        lines: [
          ['her', 'Bring snacks. The cats insist, actually.'],
          ['her', 'The moon is full on Friday. Good night for a potion, and for company.'],
          ['her', 'Here is the night I have planned, in case you say yes.'],
          ['her', lunaCards()],
        ],
      },
    ]),

    // 8 messages, read
    hanami: thread('hanami', now, 0, [
      {
        startAgo: 10 * DAY,
        step: 3 * MINUTE,
        lines: [
          ['her', 'Welcome to the shrine! I saved you a fortune slip. Want to open it together?'],
          ['me', 'Okay, open it!'],
          ['her', "Great blessing! That's the best one."],
          ['me', 'What does it say?'],
          ['her', 'Someone kind will visit often. I think it means you.'],
          ['me', "Then I'll visit often."],
        ],
      },
      {
        startAgo: 9 * DAY,
        step: MINUTE,
        lines: [
          [
            'her',
            'I tied it to the cherry branch so it comes true. The lantern festival is next week, so I made you a little map of my favorite stops.',
          ],
          ['her', hanamiCards()],
        ],
      },
    ]),
  };
}
