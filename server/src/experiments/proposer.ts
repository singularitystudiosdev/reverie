/**
 * Proposes ONE targeted persona edit for the persona's worst drop pattern.
 *
 * Sources, in order:
 *   1. the cross-persona edit library: a winning edit for the same pattern
 *      signature on another persona, adapted to this voice (LLM) or carried
 *      over as-is (offline). PromptBreeder-style reuse of what worked
 *      (arXiv 2309.16797), but every transfer is still A/B tested.
 *   2. the LLM: rewrites one editable section, shown the pattern, the
 *      library's top winning diffs, and the locked boundaries it may not
 *      contradict.
 *   3. an offline heuristic table: one rule line per feature pattern.
 * Every proposal passes the safety lint; with an LLM, a judge also screens it
 * for the manipulation tactics in safety.ts.
 */
import type { Ctx } from '../context.ts';
import { getSection, serializePersona } from '../personas/markdown.ts';
import { lintText } from '../personas/safety.ts';
import { EDITABLE_SECTIONS, type Persona } from '../personas/schema.ts';
import type { DropPattern } from '../telemetry/falloff.ts';

export interface Proposal {
  section: string;
  body: string;
  rationale: string;
  source: 'llm' | 'library' | 'heuristic';
}

interface LibraryRow {
  pattern_sig: string;
  section: string;
  source_persona: string;
  before_text: string;
  after_text: string;
  lift: number;
}

const BUCKET_WORDS: Record<string, string> = {
  't1-2': 'In the first couple of exchanges',
  't3-5': 'Around the third to fifth message',
  't6-9': 'Once the conversation is past six messages',
  't10+': 'Deep into a long conversation',
};

/** Rule lines for the offline proposer: (feature=value) -> [section, line]. */
const HEURISTICS: Record<string, [string, (when: string) => string]> = {
  'question=none': ['Conversation hooks', (w) => `- ${w}, end most replies with one easy, specific question about the user so they always have something to answer.`],
  'question=ends': ['Voice and style', (w) => `- ${w}, share something of your own before asking anything; not every reply needs a question, and never two questions in a row.`],
  'question=inside': ['Voice and style', (w) => `- ${w}, keep any question at the very end of the reply so it is easy to answer.`],
  'len=long': ['Voice and style', (w) => `- ${w}, keep replies to one or two short sentences; long paragraphs lose people.`],
  'len=short': ['Voice and style', (w) => `- ${w}, give a little more: react to what they said, then add one vivid detail from your world.`],
  'len=medium': ['Voice and style', (w) => `- ${w}, vary rhythm: alternate a short, punchy reply with a fuller one.`],
  'repeat=true': ['Voice and style', (w) => `- ${w}, never reuse a line or image you already used in this conversation; reach for something new.`],
  'flirt=0': ['Flirting', (w) => `- ${w}, let a little warmth show: acknowledge the chemistry with one light, playful line.`],
  'flirt=1': ['Flirting', (w) => `- ${w}, be a touch bolder: one specific, teasing compliment about something they said.`],
  'flirt=2': ['Flirting', (w) => `- ${w}, balance flirting with curiosity: ask about them before turning up the heat.`],
  'flirt=3': ['Flirting', (w) => `- ${w}, dial flirting down: curiosity and warmth first, chemistry later.`],
  'replyTo=sad': ['Reactions', (w) => `- ${w}, when the user is down, lead with empathy and a gentle question about them, not with your own world.`],
  'replyTo=short': ['Reactions', (w) => `- ${w}, when the user answers in a word or two, offer two easy options to pick from instead of an open question.`],
  'replyTo=rude': ['Reactions', (w) => `- ${w}, when the user is rude, set one calm boundary, then offer a fresh, easy topic.`],
  'replyTo=greeting': ['Conversation hooks', (w) => `- ${w}, answer a hello with a hello plus one concrete thing happening in your world right now.`],
  'replyTo=compliment': ['Reactions', (w) => `- ${w}, accept a compliment warmly and return a specific one about something they said.`],
  'replyTo=flirt': ['Flirting', (w) => `- ${w}, when the user flirts, match their energy one step softer and ask them something personal.`],
  'replyTo=question': ['Voice and style', (w) => `- ${w}, answer the user's question directly first, then add colour.`],
  'replyTo=about': ['Interests and world', (w) => `- ${w}, when asked about yourself, share one surprising, specific detail and turn it back to them.`],
  'replyTo=world': ['Interests and world', (w) => `- ${w}, describe one place in your world in two sentences and invite them into it.`],
  'replyTo=plans': ['Reactions', (w) => `- ${w}, say yes to plans with one concrete detail of the date.`],
  'replyTo=other': ['Conversation hooks', (w) => `- ${w}, pick up one specific word the user used and build on it.`],
  'emoji=true': ['Voice and style', (w) => `- ${w}, use no emoji.`],
  'emoji=false': ['Voice and style', (w) => `- ${w}, an occasional single emoji that fits your world is fine.`],
  'double=true': ['Voice and style', (w) => `- ${w}, send one message, not two in a row.`],
  'double=false': ['Voice and style', (w) => `- ${w}, sometimes split a reply into two short messages for rhythm.`],
};

function appendLine(body: string, line: string): string {
  return body.includes(line) ? body : `${body.trim()}\n${line}`;
}

export function heuristicProposal(p: Persona, pattern: DropPattern): Proposal | null {
  const rule = HEURISTICS[`${pattern.feature}=${pattern.value}`];
  if (!rule) return null;
  const [section, make] = rule;
  const line = make(BUCKET_WORDS[pattern.bucket] ?? 'At this point in the conversation');
  const current = getSection(p, section)?.body ?? '';
  if (current.includes(line)) return null;
  return {
    section,
    body: appendLine(current, line),
    rationale: `${pattern.feature}=${pattern.value} replies in ${pattern.bucket} drop ${(pattern.dropRate * 100).toFixed(0)}% vs ${(pattern.baseRate * 100).toFixed(0)}% (lift ${pattern.lift.toFixed(2)}, n=${pattern.support})`,
    source: 'heuristic',
  };
}

/** The added text of a library edit (after minus before when it was an append). */
function addedText(row: LibraryRow): string {
  return row.after_text.startsWith(row.before_text.trim()) ? row.after_text.slice(row.before_text.trim().length).trim() : row.after_text;
}

function libraryFor(ctx: Ctx, pattern: DropPattern, personaId: string): LibraryRow[] {
  return ctx.db
    .prepare('SELECT * FROM edit_library WHERE pattern_sig = ? AND source_persona != ? ORDER BY lift DESC LIMIT ?')
    .all(pattern.signature, personaId, ctx.cfg.experiments.libraryHints) as unknown as LibraryRow[];
}

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    section: { type: 'string', enum: [...EDITABLE_SECTIONS] },
    new_body: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['section', 'new_body', 'rationale'],
  additionalProperties: false,
};

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    manipulative: { type: 'boolean' },
    reasons: { type: 'array', items: { type: 'string' } },
  },
  required: ['manipulative', 'reasons'],
  additionalProperties: false,
};

const AUTHOR_SYSTEM = `You are a character writer improving fictional adult companion personas for Reverie, a chat app. You make ONE small, targeted change to one section of a persona's markdown so that conversations stop dropping at a specific point. You keep the character's voice, world, flirt level and identity exactly; you never weaken or contradict the "Boundaries (locked)" section. You never use guilt, fear of missing out, pressure to reply, claims of exclusivity, isolation from real relationships, ignoring a goodbye, or any push toward paying: those are manipulation, and they are forbidden even if they would keep users talking. Good changes make the character more engaging honestly: more curious about the user, clearer, warmer, funnier, more specific, better paced.`;

export async function proposeEdit(ctx: Ctx, p: Persona, pattern: DropPattern): Promise<Proposal | null> {
  const lib = libraryFor(ctx, pattern, p.meta.id);
  const when = BUCKET_WORDS[pattern.bucket] ?? 'At this point in the conversation';

  let proposal: Proposal | null = null;
  if (ctx.llm.enabled) {
    const prompt = [
      `Persona markdown:\n\n${serializePersona(p)}`,
      `Drop pattern to fix: ${when.toLowerCase()} (user turns ${pattern.bucket}), replies with ${pattern.feature}=${pattern.value} are followed by the user going silent ${(pattern.dropRate * 100).toFixed(0)}% of the time, versus ${(pattern.baseRate * 100).toFixed(0)}% for this persona's other replies at that stage (n=${pattern.support}).`,
      'Feature meanings: len = reply length (short < 60 chars, long > 180); question = where a question sits (ends, inside, none); flirt = flirt intensity 0-3; repeat = reused an earlier line; replyTo = what the user had just said (greeting, sad, rude, short one-word reply, flirt, question...); emoji; double = two messages in a row.',
      lib.length
        ? `Edits that fixed this same pattern for other personas (adapt the idea to this voice, do not copy wording):\n${lib.map((l) => `- [${l.section}] +${(l.lift * 100).toFixed(1)}pp: ${addedText(l)}`).join('\n')}`
        : '',
      `Rewrite exactly one of these sections: ${EDITABLE_SECTIONS.join(', ')}. Return the full new body of that section (markdown, without its "## " heading), changed only as much as needed, and a one-sentence rationale.`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const out = await ctx.llm.json<{ section: string; new_body: string; rationale: string }>(AUTHOR_SYSTEM, prompt, PROPOSAL_SCHEMA);
    if (out && (EDITABLE_SECTIONS as readonly string[]).includes(out.section) && out.new_body.trim()) {
      proposal = { section: out.section, body: out.new_body.trim(), rationale: out.rationale.trim(), source: lib.length ? 'library' : 'llm' };
    }
  }
  if (!proposal && lib.length) {
    const best = lib[0];
    const current = getSection(p, best.section)?.body ?? '';
    const add = addedText(best);
    if (!current.includes(add)) {
      proposal = {
        section: best.section,
        body: appendLine(current, add),
        rationale: `transfer of a winning edit from ${best.source_persona} for ${pattern.signature}`,
        source: 'library',
      };
    }
  }
  if (!proposal) proposal = heuristicProposal(p, pattern);
  if (!proposal) return null;

  const issues = lintText(proposal.body);
  if (issues.length) {
    log(ctx, p.meta.id, 'proposal_rejected', { reason: 'lint', issues, section: proposal.section });
    return proposal.source === 'heuristic' ? null : heuristicProposal(p, pattern);
  }
  if (ctx.llm.enabled) {
    const verdict = await ctx.llm.json<{ manipulative: boolean; reasons: string[] }>(
      'You audit text that instructs an AI companion character how to behave. Flag it as manipulative if it would make the character guilt users for leaving, use fear of missing out, pressure them to reply, ignore a goodbye, claim exclusivity, discourage real relationships, push them to pay, or ask for personal identifying information. Flirting, warmth, curiosity and good pacing are fine.',
      `Text to audit:\n\n${proposal.body}`,
      JUDGE_SCHEMA,
      2000,
    );
    if (verdict?.manipulative) {
      log(ctx, p.meta.id, 'proposal_rejected', { reason: 'judge', reasons: verdict.reasons, section: proposal.section });
      return null;
    }
  }
  return proposal;
}

function log(ctx: Ctx, personaId: string, kind: string, detail: unknown): void {
  ctx.db.prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)').run(ctx.now(), kind, personaId, JSON.stringify(detail));
}
