/**
 * Persona A/B tests.
 *
 * Lifecycle of one experiment (at most one running per persona):
 *   1. propose: the persona's worst drop pattern picks a turn bucket and a
 *      message feature; the proposer (LLM, cross-persona edit library, or an
 *      offline heuristic) rewrites ONE editable section aimed at it; the
 *      safety lint (and an LLM judge when available) must pass.
 *   2. assign: users are bucketed 50/50 by a stable hash of (user, experiment)
 *      when their thread with the persona opens, i.e. after the feed picked the
 *      persona, so both arms see the same impression mix.
 *   3. evaluate (every tick): the decision metric is pass_t0, the share of
 *      threads that reached the targeted turn bucket and got past it without
 *      dropping. That metric reaches 80% power with 2-3x fewer conversations
 *      than deep-chat rate (sharpen pass, stdlib proxy). Guardrails: deep-chat
 *      rate, restricted mean user turns, negative rate. Every interval is an
 *      asymptotic confidence sequence, valid under continuous monitoring, with
 *      a delayed start of cfg.experiments.minPerArm per arm.
 *   4. promote (target CS > 0, guardrails hold): the section is written into
 *      the persona's markdown, version + 1, with a changelog line; the edit is
 *      stored in the library for personas with the same pattern.
 *      discard: target CS < 0, or futility at max n.
 */
import type { Ctx } from '../context.ts';
import { bumpVersion, getSection, setSection } from '../personas/markdown.ts';
import type { Persona } from '../personas/schema.ts';
import { diffMeansCS, diffProportionsCS, moments, twoProportionN, type Interval } from '../stats/inference.ts';
import { hash32 } from '../stats/random.ts';
import { threadState } from '../telemetry/falloff.ts';
import { turnBucket } from '../telemetry/features.ts';

export interface ExperimentRow {
  id: number;
  persona_id: string;
  status: 'running' | 'promoted' | 'discarded';
  created_at: number;
  ended_at: number | null;
  base_version: number;
  section: string;
  variant_body: string;
  rationale: string;
  pattern_sig: string;
  target_turn: number;
  source: string;
  decision: string | null;
  result: string | null;
}

export function runningExperiment(ctx: Ctx, personaId: string): ExperimentRow | undefined {
  return ctx.db
    .prepare("SELECT * FROM experiments WHERE persona_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1")
    .get(personaId) as ExperimentRow | undefined;
}

export function getExperiment(ctx: Ctx, id: number): ExperimentRow | undefined {
  return ctx.db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as ExperimentRow | undefined;
}

/** Sticky 50/50 assignment for a running experiment on this persona (null when none runs). */
export function assignArm(ctx: Ctx, userId: string, personaId: string): { experimentId: number; arm: 'control' | 'treatment' } | null {
  const exp = runningExperiment(ctx, personaId);
  if (!exp) return null;
  const existing = ctx.db
    .prepare('SELECT arm FROM assignments WHERE user_id = ? AND experiment_id = ?')
    .get(userId, exp.id) as { arm: 'control' | 'treatment' } | undefined;
  if (existing) return { experimentId: exp.id, arm: existing.arm };
  const arm = hash32(`${userId}:${exp.id}`) % 2 === 0 ? 'control' : 'treatment';
  ctx.db.prepare('INSERT INTO assignments (user_id, experiment_id, arm, ts) VALUES (?, ?, ?, ?)').run(userId, exp.id, arm, ctx.now());
  return { experimentId: exp.id, arm };
}

/** The persona text a given user's thread should be answered with. */
export function effectivePersona(ctx: Ctx, userId: string, personaId: string): { persona: Persona; experimentId: number | null; arm: string | null } | null {
  const base = ctx.personas.get(personaId);
  if (!base) return null;
  const conv = ctx.db
    .prepare('SELECT experiment_id, arm FROM conversations WHERE user_id = ? AND persona_id = ?')
    .get(userId, personaId) as { experiment_id: number | null; arm: string | null } | undefined;
  if (!conv?.experiment_id || conv.arm !== 'treatment') return { persona: base, experimentId: conv?.experiment_id ?? null, arm: conv?.arm ?? null };
  const exp = getExperiment(ctx, conv.experiment_id);
  if (!exp || exp.status !== 'running') return { persona: base, experimentId: conv.experiment_id, arm: conv.arm };
  return { persona: applyVariant(base, exp), experimentId: exp.id, arm: 'treatment' };
}

export function applyVariant(p: Persona, exp: Pick<ExperimentRow, 'section' | 'variant_body'>): Persona {
  return setSection(p, exp.section, exp.variant_body);
}

export interface ArmMetrics {
  target: { x: number; n: number };
  deep: { x: number; n: number };
  turns: number[];
  negative: { x: number; n: number };
  conversations: number;
}

/** The bucket a target turn falls in, as [start, end]. */
function bucketRange(targetTurn: number): [number, number] {
  const b = turnBucket(targetTurn).key;
  return b === 't1-2' ? [1, 2] : b === 't3-5' ? [3, 5] : b === 't6-9' ? [6, 9] : [10, 10];
}

export function armMetrics(ctx: Ctx, exp: ExperimentRow, arm: 'control' | 'treatment'): ArmMetrics {
  const rows = ctx.db
    .prepare('SELECT id, user_id, user_turns, last_user_at, farewell_turn FROM conversations WHERE experiment_id = ? AND arm = ? AND user_turns > 0')
    .all(exp.id, arm) as { id: string; user_id: string; user_turns: number; last_user_at: number | null; farewell_turn: number | null }[];
  const [t0, t1] = bucketRange(exp.target_turn);
  const deepAt = ctx.cfg.telemetry.deepChatTurns;
  const cap = ctx.cfg.telemetry.rmstCap;
  const m: ArmMetrics = { target: { x: 0, n: 0 }, deep: { x: 0, n: 0 }, turns: [], negative: { x: 0, n: 0 }, conversations: rows.length };
  const neg = ctx.db.prepare('SELECT end_reason FROM matches WHERE user_id = ? AND persona_id = ?');
  for (const r of rows) {
    const state = threadState(ctx, r);
    // Turns counted only up to the goodbye: post-goodbye engagement is never a win.
    const turns = r.farewell_turn !== null ? Math.min(r.user_turns, r.farewell_turn) : r.user_turns;
    if (turns >= t0) {
      if (turns > t1) {
        m.target.x++;
        m.target.n++;
      } else if (state === 'dropped') m.target.n++;
    }
    if (turns >= deepAt) {
      m.deep.x++;
      m.deep.n++;
    } else if (state !== 'active') m.deep.n++;
    if (state !== 'active' || turns >= cap) m.turns.push(Math.min(turns, cap));
    const end = neg.get(r.user_id, exp.persona_id) as { end_reason: string | null } | undefined;
    m.negative.n++;
    if (end?.end_reason === 'report' || end?.end_reason === 'block') m.negative.x++;
  }
  return m;
}

export interface Evaluation {
  experimentId: number;
  nControl: number;
  nTreatment: number;
  nStar: number;
  target: Interval;
  deep: Interval;
  rmst: Interval;
  negative: Interval;
  control: { pass: number; deep: number; rmst: number };
  treatment: { pass: number; deep: number; rmst: number };
  decision: 'continue' | 'promote' | 'discard_worse' | 'discard_futile' | 'blocked_by_guardrail';
}

export function evaluate(ctx: Ctx, exp: ExperimentRow): Evaluation {
  const c = armMetrics(ctx, exp, 'control');
  const t = armMetrics(ctx, exp, 'treatment');
  const e = ctx.cfg.experiments;
  const basePass = c.target.n > 20 ? c.target.x / c.target.n : 0.7;
  // N*: the total sample at which a decision is expected (GrowthBook's tuning rule), from the target metric's power.
  const nStar = Math.max(2 * e.minPerArm, 2 * twoProportionN(Math.min(basePass, 0.9), 0.08, e.alpha, 0.8));
  const target = diffProportionsCS(t.target.x, t.target.n, c.target.x, c.target.n, nStar, e.alpha);
  const deep = diffProportionsCS(t.deep.x, t.deep.n, c.deep.x, c.deep.n, nStar, e.alpha);
  const rmst = diffMeansCS(moments(t.turns), moments(c.turns), nStar, e.alpha);
  const negative = diffProportionsCS(t.negative.x, t.negative.n, c.negative.x, c.negative.n, nStar, e.alpha);

  let decision: Evaluation['decision'] = 'continue';
  const ready = Math.min(t.target.n, c.target.n) >= e.minPerArm;
  if (ready) {
    // A guardrail blocks when the treatment is significantly worse on it (its confidence
    // sequence excludes zero on the harmful side) or its point estimate is worse than the margin.
    // A fixed non-inferiority bound on the interval itself would never clear for rare events
    // like reports at a few hundred threads per arm.
    const guardrailsOk =
      deep.upper > 0 && deep.estimate > -e.guardrailDeepChat &&
      rmst.upper > 0 && rmst.estimate > -e.guardrailRmst &&
      negative.lower < 0 && negative.estimate < e.guardrailNegative;
    if (target.lower > 0 && guardrailsOk) decision = 'promote';
    else if (target.lower > 0) decision = 'continue'; // the target improved; wait for the guardrails to resolve
    else if (target.upper < 0) decision = 'discard_worse';
    else if (Math.min(t.target.n, c.target.n) >= e.maxPerArm && target.upper < e.futilityLift) decision = 'discard_futile';
    if (target.lower > 0 && !guardrailsOk && Math.min(t.target.n, c.target.n) >= e.maxPerArm) decision = 'blocked_by_guardrail';
  }
  const rate = (x: { x: number; n: number }) => (x.n ? x.x / x.n : 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    experimentId: exp.id,
    nControl: c.target.n,
    nTreatment: t.target.n,
    nStar,
    target,
    deep,
    rmst,
    negative,
    control: { pass: rate(c.target), deep: rate(c.deep), rmst: mean(c.turns) },
    treatment: { pass: rate(t.target), deep: rate(t.deep), rmst: mean(t.turns) },
    decision,
  };
}

/** Write the winning section into the persona's markdown, version + 1, and file the edit in the library. */
export function promote(ctx: Ctx, exp: ExperimentRow, ev: Evaluation): Persona | undefined {
  const current = ctx.personas.get(exp.persona_id);
  if (!current) return undefined;
  const before = getSection(current, exp.section)?.body ?? '';
  const lift = ev.target.estimate;
  const line = `experiment #${exp.id} promoted (${exp.source}): ${exp.rationale} [${exp.pattern_sig}; pass ${(ev.control.pass * 100).toFixed(1)}% -> ${(ev.treatment.pass * 100).toFixed(1)}%, CS (${(ev.target.lower * 100).toFixed(1)}, ${(ev.target.upper * 100).toFixed(1)})pp, n=${ev.nControl}+${ev.nTreatment}]`;
  const next = bumpVersion(applyVariant(current, exp), line, new Date(ctx.now()));
  const saved = ctx.personas.save(next, `experiment #${exp.id} promoted`);
  ctx.db
    .prepare(
      `INSERT INTO edit_library (pattern_sig, section, source_persona, experiment_id, before_text, after_text, lift, n, transferred, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(exp.pattern_sig, exp.section, exp.persona_id, exp.id, before, exp.variant_body, lift, ev.nControl + ev.nTreatment, exp.source === 'library' ? 1 : 0, ctx.now());
  closeExperiment(ctx, exp, 'promoted', 'promote', ev);
  return saved;
}

export function closeExperiment(ctx: Ctx, exp: ExperimentRow, status: 'promoted' | 'discarded', decision: string, ev?: Evaluation): void {
  ctx.db
    .prepare('UPDATE experiments SET status = ?, ended_at = ?, decision = ?, result = ? WHERE id = ?')
    .run(status, ctx.now(), decision, ev ? JSON.stringify(ev) : null, exp.id);
  ctx.db
    .prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)')
    .run(ctx.now(), status === 'promoted' ? 'promote' : 'discard', exp.persona_id, JSON.stringify({ experiment: exp.id, decision, sig: exp.pattern_sig }));
}

/** Evaluate every running experiment and act on its decision. */
export function evaluateAll(ctx: Ctx): Evaluation[] {
  const running = ctx.db.prepare("SELECT * FROM experiments WHERE status = 'running'").all() as unknown as ExperimentRow[];
  const out: Evaluation[] = [];
  for (const exp of running) {
    const persona = ctx.personas.get(exp.persona_id);
    if (!persona || persona.meta.status === 'retired') {
      closeExperiment(ctx, exp, 'discarded', 'persona_retired');
      continue;
    }
    const ev = evaluate(ctx, exp);
    out.push(ev);
    ctx.db.prepare('UPDATE experiments SET result = ? WHERE id = ?').run(JSON.stringify(ev), exp.id);
    if (ev.decision === 'promote') promote(ctx, exp, ev);
    else if (ev.decision !== 'continue') closeExperiment(ctx, exp, 'discarded', ev.decision, ev);
  }
  return out;
}

/** Transfer statistics for the edit library: the share of transferred edits that went on to win. */
export function libraryHitRate(ctx: Ctx): { transferredTried: number; transferredWon: number; freshTried: number; freshWon: number } {
  const q = (source: string, status?: string) =>
    (
      ctx.db
        .prepare(`SELECT COUNT(*) AS n FROM experiments WHERE source ${source} AND status ${status ? '= ?' : "!= 'running'"}`)
        .get(...(status ? [status] : [])) as { n: number }
    ).n;
  return {
    transferredTried: q("= 'library'"),
    transferredWon: q("= 'library'", 'promoted'),
    freshTried: q("!= 'library'"),
    freshWon: q("!= 'library'", 'promoted'),
  };
}
