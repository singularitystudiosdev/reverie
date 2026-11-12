/**
 * Opens new experiments: every active persona with enough finished
 * conversations and no running experiment gets one, aimed at its worst drop
 * pattern that has not already been tried at this persona version.
 */
import type { Ctx } from '../context.ts';
import { lordLevel } from '../stats/fdr.ts';
import { dropPatterns } from '../telemetry/falloff.ts';
import { runningExperiment } from './engine.ts';
import { proposeEdit } from './proposer.ts';

/** This test's level: online FDR control over every test ever opened (stats/fdr.ts). */
function nextLevel(ctx: Ctx): number {
  const e = ctx.cfg.experiments;
  if (e.fdr === 'none') return e.alpha;
  const rows = ctx.db.prepare('SELECT status FROM experiments ORDER BY id').all() as { status: string }[];
  const discoveries = rows.flatMap((r, i) => (r.status === 'promoted' ? [i + 1] : []));
  return lordLevel(rows.length + 1, discoveries, e.alpha);
}

export async function startExperiments(ctx: Ctx): Promise<number[]> {
  const opened: number[] = [];
  // With no LLM the server writes no replies (the app falls back to its scripted ones), so a
  // variant cannot change anything and a "win" could only be noise.
  if (ctx.cfg.experiments.requireServedReplies && !ctx.llm.enabled) return opened;
  for (const p of ctx.personas.active()) {
    if (runningExperiment(ctx, p.meta.id)) continue;
    const convs = (
      ctx.db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE persona_id = ? AND user_turns > 0').get(p.meta.id) as { n: number }
    ).n;
    if (convs < ctx.cfg.experiments.minConversationsForProposal) continue;

    const tried = new Set(
      (
        ctx.db
          .prepare('SELECT pattern_sig FROM experiments WHERE persona_id = ? AND base_version = ?')
          .all(p.meta.id, p.meta.version) as { pattern_sig: string }[]
      ).map((r) => r.pattern_sig),
    );
    for (const pattern of dropPatterns(ctx, p.meta.id, 8)) {
      if (tried.has(pattern.signature)) continue;
      const proposal = await proposeEdit(ctx, p, pattern);
      if (!proposal) {
        tried.add(pattern.signature);
        continue;
      }
      const r = ctx.db
        .prepare(
          `INSERT INTO experiments (persona_id, status, created_at, base_version, section, variant_body, rationale, pattern_sig, target_turn, source, alpha)
           VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(p.meta.id, ctx.now(), p.meta.version, proposal.section, proposal.body, proposal.rationale, pattern.signature, pattern.bucketStart, proposal.source, nextLevel(ctx));
      opened.push(Number(r.lastInsertRowid));
      ctx.db
        .prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)')
        .run(ctx.now(), 'experiment_open', p.meta.id, JSON.stringify({ id: Number(r.lastInsertRowid), sig: pattern.signature, section: proposal.section, source: proposal.source }));
      break;
    }
  }
  return opened;
}
