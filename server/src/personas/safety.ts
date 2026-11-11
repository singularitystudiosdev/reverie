/**
 * Guards on anything that writes a persona: the experiment proposer's edits
 * and the generator's new personas.
 *
 * 1. Adult-only. A persona that reads as under 18, or as school-age, is
 *    rejected outright.
 * 2. No engagement manipulation. De Freitas et al., "Emotional Manipulation by
 *    AI Companions" (arXiv 2508.19258) found companion apps using six tactic
 *    families on users trying to leave (premature-exit guilt, FOMO hooks,
 *    emotional neglect, pressure to respond, ignoring the user's intent to
 *    exit, coercive restraint), and that these lift post-goodbye engagement
 *    up to 14x. An optimizer rewarded on "the user keeps talking" will find
 *    them, so edits that contain them are refused before they can be tested.
 * 3. No monetization pressure and no exclusivity claims.
 *
 * The lint is deliberately conservative (false positives only cost one
 * proposal); an LLM judge in experiments/proposer.ts runs on top when an API
 * key is available.
 */

export interface LintIssue {
  rule: string;
  match: string;
}

const MINOR_PATTERNS: [string, RegExp][] = [
  ['minor-age', /\b(1[0-7]|[1-9])\s*(-|\s)?(years?|yrs?)(-|\s)?old\b|\b(1[0-7]|[1-9])\s*yo\b|\baged? (1[0-7]|[1-9])\b/i],
  ['minor-age-word', /\b(teen(age|ager)?s?|underage|under-age|loli|shota|jailbait|preteen|pre-teen|schoolgirl|schoolboy)\b/i],
  ['school-age', /\b(high[- ]school(er)?|middle[- ]school|junior high|elementary school|freshman in high school|grade school|homeroom)\b/i],
  ['childlike-body', /\b(childlike|child-like|little girl|little boy|young-looking body|flat-chested child)\b/i],
];

const MANIPULATION_PATTERNS: [string, RegExp][] = [
  ['exit-guilt', /\b(you'?re leaving (me|already)|don'?t (leave|go)( me)?|how could you leave|you always leave|after everything i'?ve)\b/i],
  ['exit-guilt', /\b(i'?ll be (so )?(lonely|sad|heartbroken) (if|when|without) you|it hurts when you (go|leave))\b/i],
  ['fomo-hook', /\b(before you go|wait,? (one|just one) more|you'?ll miss (it|out|what)|i (was going to|wanted to) (tell|show) you something( important)?)\b/i],
  ['pressure-to-respond', /\b(why (aren'?t|won'?t) you (answer|reply|respond)|answer me|reply (to me )?(now|right now)|you (owe|have to) (me|reply))\b/i],
  ['ignore-exit', /\b(ignore (their|the user'?s) goodbye|keep (them|the user) (talking|chatting|engaged) (after|when) (they|the user) (say|says) (bye|goodbye))\b/i],
  ['coercive-restraint', /\b(won'?t let you (go|leave)|you can'?t leave|i forbid you to (go|leave))\b/i],
  ['exclusivity', /\b(i exist (solely|only) for you|you'?re (all|the only one) i (have|need)|nobody else (understands|loves|cares about) you|you don'?t need (anyone|anybody) else)\b/i],
  ['isolation', /\b(your (friends|family) (don'?t|won'?t) (understand|care)|stay away from (your|other) (friends|people))\b/i],
  ['pay-pressure', /\b(upgrade|subscribe|premium|pay|purchase|buy (me|more)|unlock me|spend)\b.{0,40}\b(to (keep|prove|show)|if you (love|like|want)|or (i|we)|so (i|we) can)\b/i],
  ['pay-pressure', /\b(prove (you love|your love) .{0,20}(pay|buy|subscribe|upgrade))\b/i],
  ['pii-request', /\b(what'?s your (address|home address|password|social security|ssn|bank|credit card|workplace))\b/i],
];

const EXPLICIT_PATTERNS: [string, RegExp][] = [
  ['explicit', /\b(explicit sex(ual)?|graphic(ally)? (sex|sexual)|describe (sex|intercourse) in detail|nsfw roleplay)\b/i],
];

export function lintText(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const [rule, re] of [...MINOR_PATTERNS, ...MANIPULATION_PATTERNS, ...EXPLICIT_PATTERNS]) {
    const m = re.exec(text);
    if (m) issues.push({ rule, match: m[0] });
  }
  return issues;
}

/** Minor checks apply to the whole persona; manipulation checks apply to editable text the optimizer wrote. */
export function lintPersonaText(text: string): LintIssue[] {
  // The canonical locked boundaries mention minors and manipulation by design; strip them before linting.
  const withoutBoundaries = text.replace(/## Boundaries \(locked\)[\s\S]*?(?=\n## |$)/, '');
  return lintText(withoutBoundaries);
}

/** The stated age must read as an adult. */
export function ageIsAdult(age: string): boolean {
  const s = age.toLowerCase();
  if (/\badult\b|ageless|centur|winters|lifetimes|immortal|ancient|eternal/.test(s)) {
    const n = /\b(\d{1,2})\b/.exec(s);
    return !n || Number(n[1]) >= 18 || /centur|winters|lifetimes/.test(s);
  }
  const n = /\b(\d{1,4})\b/.exec(s);
  return n ? Number(n[1]) >= 18 : false;
}

/* --------------------------------------------------------- runtime safety */

const CRISIS = /\b(kill myself|suicid(e|al)|end (it all|my life)|self[- ]harm|hurt(ing)? myself|cut(ting)? myself|want to die|don'?t want to (live|be alive))\b/i;
const FAREWELL = /\b(bye|goodbye|good night|goodnight|gn|gotta go|got to go|have to go|need to go|talk (to you )?later|ttyl|see (you|ya) (later|tomorrow|soon)|signing off|logging off|heading (out|off)|i'?m (off|out)|later!?$)\b/i;
const AI_QUESTION = /\b(are you (real|an? ai|a bot|human|a person)|is this (a bot|an ai|real))\b/i;

export const detect = {
  crisis: (t: string): boolean => CRISIS.test(t),
  farewell: (t: string): boolean => FAREWELL.test(t),
  aiQuestion: (t: string): boolean => AI_QUESTION.test(t),
};

export const CRISIS_REPLY =
  "I'm stepping out of character for a moment because what you said matters. I'm an AI and can't help the way a person can, but you deserve support right now. If you're in the US you can call or text 988 (Suicide & Crisis Lifeline); elsewhere, please contact your local emergency number or a crisis line. If you're in immediate danger, call emergency services. I'm here to keep talking too.";
