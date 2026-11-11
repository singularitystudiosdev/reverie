/**
 * Chat falloff, framed as survival analysis over user turns.
 *
 * A conversation (one thread per user and persona) has DROPPED at user turn t
 * when the user's last message is turn t, they did not say goodbye, and they
 * have been silent for cfg.telemetry.dropGapMs. Threads still inside the gap
 * are censored (not counted as drops). The hazard h(t) = drops at t / threads
 * at risk at t is the per-turn falloff curve.
 *
 * Drop patterns: for every user turn, the persona reply the user saw last is
 * the decision point. Its features (length, question, flirt intensity,
 * repetition, what it replied to, ...) are compared between replies that were
 * followed by another user message and replies after which the user dropped.
 * A pattern's lift is its drop rate over the persona's drop rate in the same
 * turn bucket; the experiment proposer targets the worst one. Replies after a
 * user's goodbye are excluded everywhere: keeping someone talking after they
 * said goodbye is never counted as a win.
 */
import type { Ctx } from '../context.ts';
import { json } from '../db.ts';
import { featurePairs, turnBucket, type MsgFeatures } from './features.ts';

export interface HazardPoint {
  turn: number;
  atRisk: number;
  drops: number;
  hazard: number;
  survival: number;
}

export interface DropPattern {
  signature: string;   // "t3-5|question=none"
  bucket: string;
  bucketStart: number;
  feature: string;
  value: string;
  support: number;     // decision points with this feature in this bucket
  dropRate: number;
  baseRate: number;    // the persona's drop rate in this bucket
  lift: number;
}

export interface DropProfile {
  threads: number;
  dropped: number;
  endedWithGoodbye: number;
  active: number;
  medianDropTurn: number;
  hazard: HazardPoint[];
  patterns: DropPattern[];
}

interface ConvRow {
  id: string;
  user_turns: number;
  last_user_at: number | null;
  farewell_turn: number | null;
}

export type ThreadState = 'dropped' | 'goodbye' | 'active';

export function threadState(ctx: Ctx, c: ConvRow): ThreadState {
  if (c.farewell_turn !== null && c.farewell_turn >= c.user_turns) return 'goodbye';
  const last = c.last_user_at ?? 0;
  return ctx.now() - last >= ctx.cfg.telemetry.dropGapMs ? 'dropped' : 'active';
}

/** The decision points of one persona: the last persona reply at each user turn, with its outcome. */
export function decisionPoints(
  ctx: Ctx,
  personaId: string,
  filter?: { experimentId?: number; arm?: string },
): { convId: string; userTurn: number; features: MsgFeatures; outcome: 'continued' | 'dropped' | 'censored' }[] {
  const where = ['c.persona_id = ?', "m.role = 'persona'"];
  const args: (string | number)[] = [personaId];
  if (filter?.experimentId !== undefined) {
    where.push('c.experiment_id = ?');
    args.push(filter.experimentId);
  }
  if (filter?.arm) {
    where.push('c.arm = ?');
    args.push(filter.arm);
  }
  const rows = ctx.db
    .prepare(
      `SELECT m.conv_id, m.user_turn, m.features, c.user_turns, c.last_user_at, c.farewell_turn, m.id
       FROM messages m JOIN conversations c ON c.id = m.conv_id
       WHERE ${where.join(' AND ')} AND m.user_turn > 0
       ORDER BY m.conv_id, m.user_turn, m.id`,
    )
    .all(...args) as {
    conv_id: string;
    user_turn: number;
    features: string | null;
    user_turns: number;
    last_user_at: number | null;
    farewell_turn: number | null;
    id: number;
  }[];
  // Keep only the last persona reply per (conversation, user turn).
  const last = new Map<string, (typeof rows)[number]>();
  for (const r of rows) last.set(`${r.conv_id}#${r.user_turn}`, r);
  const out: ReturnType<typeof decisionPoints> = [];
  for (const r of last.values()) {
    if (r.farewell_turn !== null && r.user_turn >= r.farewell_turn) continue; // post-goodbye: never a target
    const features = json<MsgFeatures | null>(r.features, null);
    if (!features) continue;
    let outcome: 'continued' | 'dropped' | 'censored';
    if (r.user_turns > r.user_turn) outcome = 'continued';
    else {
      const st = threadState(ctx, { id: r.conv_id, user_turns: r.user_turns, last_user_at: r.last_user_at, farewell_turn: r.farewell_turn });
      outcome = st === 'dropped' ? 'dropped' : 'censored';
    }
    out.push({ convId: r.conv_id, userTurn: r.user_turn, features, outcome });
  }
  return out;
}

export function dropProfile(ctx: Ctx, personaId: string): DropProfile {
  const convs = ctx.db
    .prepare('SELECT id, user_turns, last_user_at, farewell_turn FROM conversations WHERE persona_id = ? AND user_turns > 0')
    .all(personaId) as unknown as ConvRow[];
  const states = convs.map((c) => ({ c, s: threadState(ctx, c) }));
  const dropped = states.filter((x) => x.s === 'dropped');
  const maxTurn = Math.min(30, Math.max(0, ...convs.map((c) => c.user_turns)));
  const hazard: HazardPoint[] = [];
  let survival = 1;
  for (let t = 1; t <= maxTurn; t++) {
    const atRisk = convs.filter((c) => c.user_turns >= t).length;
    const drops = dropped.filter((x) => x.c.user_turns === t).length;
    const h = atRisk ? drops / atRisk : 0;
    survival *= 1 - h;
    hazard.push({ turn: t, atRisk, drops, hazard: h, survival });
  }
  const dropTurns = dropped.map((x) => x.c.user_turns).sort((a, b) => a - b);
  return {
    threads: convs.length,
    dropped: dropped.length,
    endedWithGoodbye: states.filter((x) => x.s === 'goodbye').length,
    active: states.filter((x) => x.s === 'active').length,
    medianDropTurn: dropTurns.length ? dropTurns[dropTurns.length >> 1] : 0,
    hazard,
    patterns: dropPatterns(ctx, personaId),
  };
}

export function dropPatterns(ctx: Ctx, personaId: string, limit = 5): DropPattern[] {
  const points = decisionPoints(ctx, personaId).filter((p) => p.outcome !== 'censored');
  const byBucket = new Map<string, { start: number; n: number; d: number; feats: Map<string, { n: number; d: number }> }>();
  for (const p of points) {
    const b = turnBucket(p.userTurn);
    let e = byBucket.get(b.key);
    if (!e) {
      e = { start: b.start, n: 0, d: 0, feats: new Map() };
      byBucket.set(b.key, e);
    }
    const dropped = p.outcome === 'dropped' ? 1 : 0;
    e.n++;
    e.d += dropped;
    for (const [k, v] of featurePairs(p.features)) {
      const key = `${k}=${v}`;
      const f = e.feats.get(key) ?? { n: 0, d: 0 };
      f.n++;
      f.d += dropped;
      e.feats.set(key, f);
    }
  }
  const min = ctx.cfg.telemetry.patternMinSupport;
  const patterns: DropPattern[] = [];
  for (const [bucket, e] of byBucket) {
    if (e.n < min) continue;
    const base = e.d / e.n;
    for (const [key, f] of e.feats) {
      if (f.n < min || f.n === e.n) continue; // a feature every reply shares says nothing
      const rate = f.d / f.n;
      const [feature, value] = key.split('=');
      patterns.push({
        signature: `${bucket}|${key}`,
        bucket,
        bucketStart: e.start,
        feature,
        value,
        support: f.n,
        dropRate: rate,
        baseRate: base,
        lift: base > 0 ? rate / base : rate > 0 ? Infinity : 1,
      });
    }
  }
  // Rank by excess drops (lift weighted by how many users it touches), worst first.
  return patterns
    .filter((p) => p.lift > 1)
    .sort((a, b) => (b.dropRate - b.baseRate) * b.support - (a.dropRate - a.baseRate) * a.support)
    .slice(0, limit);
}
