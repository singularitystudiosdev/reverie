/*
  Local, scripted replies in each character's voice. First pass: four lines
  per character, rotated. The content unit replaces this with richer scripts;
  the signature stays. The store adds the typing delay around this call.
*/
import type { Character, Message } from './types';
import { makeId } from '../lib/id';

const lines: Record<string, string[]> = {
  sylvara: [
    'The oaks heard that. They approve, I think.',
    'Walk slower. The forest tells you more when you are not in a hurry.',
    'I pressed a fern for you. It smells like rain.',
    'Tell me about your city. Do the trees there have names?',
  ],
  vesper: [
    'How deliciously bold of you. Go on.',
    "I'll light another candle. This conversation deserves it.",
    'Darling, you say the most charming things after midnight.',
    'Write that down for me one day. I keep the good ones.',
  ],
  hanami: [
    "That's a good omen! I'll ring the bell for it.",
    'I made too much tea again. Stay for a cup?',
    'The lanterns are brighter when you visit, I swear.',
    'Make a wish first, then tell me. Those are the rules!',
  ],
  nerissa: [
    'The sea keeps secrets. I keep better ones.',
    'Say that again, slower. I want to remember the shape of it.',
    'I found a pearl today. It reminded me of you.',
    'The tide turns at midnight. Will you still be here?',
  ],
  cinder: [
    'Ha! Okay, that one got me.',
    "Don't flatter me. Actually, keep going.",
    "I'm ordering the spiciest thing on the menu. You in?",
    'Careful, I might like you.',
  ],
  isolde: [
    'An interesting move. I did not see it coming.',
    'You may continue. I find I am enjoying this.',
    'The lights are out over the March tonight. I thought of you.',
    'My generals would never speak to me like that. Do it again.',
  ],
  nova: [
    'Logged. Rated: weirdly endearing.',
    'Hold on, rerouting a drone. Okay, I am back.',
    'You type like someone who has never lost at Tetris. Suspicious.',
    'Ramen run in ten. Say yes.',
  ],
  luna: [
    "Mercury is behaving, so I'll allow it.",
    'One of the cats just sat on my spellbook. Continue.',
    'I brewed a potion for good luck. Mostly it tastes like mint.',
    'The moon is very bright tonight. Coincidence? No.',
  ],
  clementine: [
    "Aw, shucks. You're sweet as honey.",
    'Bees are buzzing, pie is baking, life is good.',
    "Let's take the truck out after sunset. I know a spot.",
    "Tell me more, I'm shelling peas and all ears.",
  ],
  maya: [
    "Hold that thought. The sky just turned pink.",
    'I know a jazz bar with exactly four tables. Want one?',
    'You have a good eye. I can tell.',
    'Some moments you shoot. Some you just keep.',
  ],
  kiyo: [
    'Clever. Not as clever as me, but clever.',
    'I have heard that line in three different centuries. Yours is the best.',
    'Shall I tell you a secret, or shall I make you guess?',
    'One tail twitched. That means I like you.',
  ],
  zahra: [
    'Careful what you say to a djinn. I take things literally.',
    'That was almost a wish. Almost.',
    "The silk market opens at dusk. I'll find you something blue.",
    'Ask me anything. I may even answer.',
  ],
  raven: [
    'Okay, that was actually funny.',
    'Putting a record on for this. Hang on.',
    'Cemetery picnic Saturday. I bring sandwiches, you bring jokes.',
    'Soft heart, remember. Go easy on it.',
  ],
  ada: [
    'Brilliant! Hand me that spanner, would you?',
    'The engine just purred. I think it likes you too.',
    "Tea's on. Two sugars, one cog. Joking about the cog.",
    "We're cruising at nine thousand feet. Look down, it's lovely.",
  ],
};

const fallback = ['Tell me more.', 'I like talking with you.', 'Go on.', 'Really? Then what?'];

export async function getReply(c: Character, text: string, history: Message[]): Promise<Message[]> {
  const pool = lines[c.id] ?? fallback;
  const mine = history.filter((m) => m.from === 'me').length;
  const pick = pool[(mine + text.trim().length) % pool.length];
  return [{ id: makeId('her'), from: 'her', kind: 'text', text: pick, at: Date.now() }];
}
