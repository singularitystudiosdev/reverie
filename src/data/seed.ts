import { getCharacter } from './characters';
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
  hanami 8. Copy is first-pass; the content unit refines it.
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

function vesperCards(): CardItem[] {
  const v = getCharacter('vesper');
  const scene = v?.sceneSm ?? '';
  const portrait = v?.portraitSm ?? '';
  return [
    {
      title: 'Midnight opera',
      subtitle: 'Box seats at the Teatro Nero',
      meta: 'Curtain rises at midnight',
      image: scene,
      imagePosition: '50% 40%',
    },
    {
      title: 'Candlelit supper',
      subtitle: 'The long table in the east wing',
      meta: 'Forty candles, two chairs',
      image: portrait,
      imagePosition: '50% 22%',
      imageScale: 1.8,
    },
    {
      title: 'Rose garden walk',
      subtitle: 'Behind the old chapel',
      meta: 'Ten minutes by lantern',
      image: scene,
      imagePosition: '50% 85%',
    },
  ];
}

/** First-launch history for the initial matches, stamped relative to `now`. */
export function seedConversations(now: number): Record<string, Conversation> {
  return {
    // 36 messages, 1 unread
    vesper: thread('vesper', now, 1, [
      {
        startAgo: 4 * DAY,
        step: 3 * MINUTE,
        lines: [
          ['her', 'Good evening, darling. I was hoping you would be the one to knock.'],
          ['me', 'Is it always this dark in your manor?'],
          ['her', 'Only since 1791. I find daylight rather vulgar.'],
          ['me', 'Fair enough. What do you do all night?'],
          ['her', 'Read old letters. Play the organ badly. Wait for interesting company.'],
          ['her', 'You may qualify.'],
          ['me', 'High praise.'],
          ['her', 'The highest. Most visitors faint in the foyer.'],
          ['me', "I'm sturdier than I look."],
          ['her', 'We shall see. Do you like opera?'],
          ['me', "I've never been, honestly."],
          ['her', 'Never? Oh, that is a tragedy worthy of a third act.'],
          ['me', 'Then take me sometime.'],
          ['her', 'Careful. I hold people to their promises.'],
        ],
      },
      {
        startAgo: 2 * DAY,
        step: 4 * MINUTE,
        lines: [
          ['me', 'I meant it, by the way. About the opera.'],
          ['her', "Then I'll have the box at the Teatro Nero aired out."],
          ['me', 'What do you wear to a midnight opera?'],
          ['her', 'Something black. Something you can dance in afterward.'],
          ['me', 'Dancing too?'],
          ['her', 'There is always dancing. The ghosts insist.'],
          ['me', 'The ghosts?'],
          ['her', 'Harmless. Terrible gossips, though.'],
          ['me', "Now I'm curious what they say about me."],
          ['her', 'That you write back quickly. They find it suspicious.'],
          ['me', 'I just like talking to you.'],
          ['her', "Darling. You'll make the candles blush."],
          ['me', 'Do vampires blush?'],
          ['her', 'Only when no one is watching.'],
        ],
      },
      {
        startAgo: 52 * MINUTE,
        step: MINUTE,
        lines: [
          ['me', "Couldn't sleep. Are you up?"],
          ['her', "Always, darling. I've drawn up a few ways to spend the night."],
          ['her', vesperCards()],
          ['me', 'The opera, obviously.'],
          ['her', 'Obviously. You learn quickly.'],
          ['me', 'Should I bring anything?'],
          ['her', 'Just yourself. And a coat. The roof garden is cold after the third act.'],
        ],
      },
      {
        startAgo: 4 * MINUTE,
        step: MINUTE,
        lines: [['her', 'The opera is my favorite. Box seats, and nobody minds if we whisper.']],
      },
    ]),

    // 28 messages, 2 unread
    nova: thread('nova', now, 2, [
      {
        startAgo: 3 * DAY,
        step: 2 * MINUTE,
        lines: [
          ['her', 'Connection established. Your firewall is cute, by the way.'],
          ['me', 'Should I be worried?'],
          ['her', 'Only if you hate ramen.'],
          ['me', 'I love ramen.'],
          ['her', 'Good answer. Passing you to level two.'],
          ['me', 'There are levels?'],
          ['her', "Everything has levels. Some people just don't see the HUD."],
          ['me', "What's at level three?"],
          ['her', "Classified. Also I haven't decided yet."],
          ['her', 'Do you play anything? Arcades, rhythm games, chess with strangers?'],
          ['me', 'I was pretty good at air hockey once.'],
          ['her', 'Air hockey. Bold. I respect a physical sport.'],
          ['me', 'You?'],
          ['her', 'Rhythm games. I have a perfect run on a song nobody else has heard of.'],
        ],
      },
      {
        startAgo: 20 * HOUR,
        step: 3 * MINUTE,
        lines: [
          ['me', 'Send me that song.'],
          ['her', 'Sending. Volume up, lights off.'],
          ['me', 'Okay, this is actually great.'],
          ['her', 'I know. I have taste.'],
          ['me', 'Do you ever sleep?'],
          ['her', 'Sleep is a rumor spread by people with day jobs.'],
          ['me', 'Fair.'],
          ['her', 'Found a ramen stall in the lower ward that stays open until 4.'],
          ['me', 'Is that an invitation?'],
          ['her', "It's a coordinate. Invitations are for people who can't read hints."],
          ['me', "Then I'll be there."],
          ['her', 'Bring coins. The claw machine next door owes me.'],
        ],
      },
      {
        startAgo: 41 * MINUTE,
        step: 3 * MINUTE,
        lines: [
          ['her', 'Also I beat your high score.'],
          ['her', 'Rematch?'],
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
          ['me', 'What are you doing tonight?'],
          ['her', "Jazz at Lou's. Four tables, one trumpet, very bad wine."],
          ['me', 'You make bad wine sound good.'],
          ['her', "That's the trick to the whole city."],
          ['her', "Come next time. I'll save you the table by the window."],
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
          ['her', 'Three official cats. A fourth who visits on Tuesdays.'],
          ['me', 'What are their names?'],
          ['her', "Comet, Biscuit and Professor Whiskers. The visitor won't tell me his."],
          ['me', 'Professor Whiskers is a great name.'],
          ['her', 'He has a doctorate in knocking things off tables.'],
          ['me', 'Can I meet them?'],
        ],
      },
      {
        startAgo: 26 * HOUR,
        step: 2 * MINUTE,
        lines: [
          ['her', 'Bring snacks. The cats insisted, actually.'],
          ['her', 'The moon is full on Friday. Good night for a potion.'],
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
          ['her', 'I tied it to the cherry branch so it comes true.'],
        ],
      },
      {
        startAgo: 9 * DAY,
        step: MINUTE,
        lines: [['her', 'The lantern festival is next week. Save me an evening?']],
      },
    ]),
  };
}
