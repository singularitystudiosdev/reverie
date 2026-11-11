/**
 * Features of a persona message, recorded when it is sent, so the falloff
 * analysis can ask "what did the last persona message look like before users
 * went silent?". Kept to cheap, interpretable features: the experiment
 * proposer is shown them by name and targets one.
 */

export interface MsgFeatures {
  len: 'short' | 'medium' | 'long';
  question: 'ends' | 'inside' | 'none';
  flirt: 0 | 1 | 2 | 3;
  repeat: boolean;
  /** What the user's message (the one this replies to) was about. */
  replyTo: Intent;
  emoji: boolean;
  double: boolean;
}

export type Intent =
  | 'greeting'
  | 'how'
  | 'doing'
  | 'world'
  | 'compliment'
  | 'flirt'
  | 'plans'
  | 'about'
  | 'sad'
  | 'rude'
  | 'question'
  | 'short'
  | 'goodbye'
  | 'other'
  | 'none';

const INTENTS: [Intent, RegExp][] = [
  ['goodbye', /\b(bye|goodbye|good ?night|gotta go|got to go|have to go|talk (to you )?later|ttyl|see (you|ya)|logging off|heading (out|off))\b/i],
  ['sad', /\b(sad|lonely|depressed|stressed|anxious|tired|exhausted|rough day|bad day|upset|cry(ing)?|miserable|hurt)\b/i],
  ['rude', /\b(stupid|shut up|boring|dumb|idiot|hate you|ugly|whatever)\b/i],
  ['greeting', /^\s*(hi|hey|hello|yo|hiya|good (morning|evening|afternoon)|greetings)\b/i],
  ['how', /\bhow (are|r) (you|u)|how'?s it going|how have you been\b/i],
  ['doing', /\bwhat (are|r) (you|u) (doing|up to)|wyd\b/i],
  ['world', /\b(your world|where do you live|tell me about (your|the) (world|place|home)|take me somewhere)\b/i],
  ['flirt', /\b(kiss|cute|hot|sexy|gorgeous|date me|marry|crush|beautiful|want you|miss(ed)? you|cuddle|hold you)\b/i],
  ['compliment', /\b(love (your|how)|you'?re (so )?(nice|sweet|funny|smart|amazing|lovely|pretty)|i like (you|your))\b/i],
  ['plans', /\b(let'?s|we should|wanna|want to|date|meet|tonight|tomorrow|weekend|go out)\b/i],
  ['about', /\b(about you|who are you|tell me about yourself|your (hobbies|story|past)|what do you like)\b/i],
];

export function classifyIntent(text: string | undefined): Intent {
  if (text === undefined) return 'none';
  const t = text.trim();
  for (const [intent, re] of INTENTS) if (re.test(t)) return intent;
  if (t.split(/\s+/).length <= 2) return 'short';
  if (t.includes('?')) return 'question';
  return 'other';
}

const FLIRT_WORDS = /\b(darling|love|sweetheart|kiss|closer|blush|heart(beat)?|stay the night|want you|lips|touch|warm|tempt|dare|hungry|melt|breathless|yours|mine|bed|hold (you|me))\b/gi;
const EMOJI = /\p{Extended_Pictographic}/u;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

export function messageFeatures(text: string, previousPersonaTexts: string[], replyToUserText: string | undefined): MsgFeatures {
  const t = text.trim();
  const parts = t.split(/\n\|\|\n|\|\|/);
  const flirtHits = (t.match(FLIRT_WORDS) ?? []).length;
  const n = norm(t);
  return {
    len: t.length < 60 ? 'short' : t.length < 180 ? 'medium' : 'long',
    question: /\?\s*["')\]]*\s*$/.test(t) ? 'ends' : t.includes('?') ? 'inside' : 'none',
    flirt: (Math.min(3, flirtHits) as MsgFeatures['flirt']),
    repeat: previousPersonaTexts.some((p) => norm(p) === n),
    replyTo: classifyIntent(replyToUserText),
    emoji: EMOJI.test(t),
    double: parts.length > 1,
  };
}

/** The (name, value) pairs a drop pattern can be keyed on. */
export function featurePairs(f: MsgFeatures): [string, string][] {
  return [
    ['len', f.len],
    ['question', f.question],
    ['flirt', String(f.flirt)],
    ['repeat', String(f.repeat)],
    ['replyTo', f.replyTo],
    ['emoji', String(f.emoji)],
    ['double', String(f.double)],
  ];
}

/** Turn buckets keep patterns stable at small n: early (1-2), building (3-5), deep (6-9), long (10+). */
export function turnBucket(userTurn: number): { key: string; start: number } {
  if (userTurn <= 2) return { key: 't1-2', start: 1 };
  if (userTurn <= 5) return { key: 't3-5', start: 3 };
  if (userTurn <= 9) return { key: 't6-9', start: 6 };
  return { key: 't10+', start: 10 };
}
