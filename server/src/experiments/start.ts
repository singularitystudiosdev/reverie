/**
 * Opens new experiments: every active persona with enough finished
 * conversations and no running experiment gets one, aimed at its worst drop
 * pattern that has not already been tried at this persona version.
 */
import type { Ctx } from '../context.ts';
import { dropPatterns } from '../telemetry/falloff.ts';
import { runningExperiment } from './engine.ts';
import { proposeEdit } from './proposer.ts';

export async function startExperiments(ctx: Ctx): Promise<number[]> {
  const opened: number[] = [];
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
          `INSERT INTO experiments (persona_id, status, created_at, base_version, section, variant_body, rationale, pattern_sig, target_turn, source)
           VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(p.meta.id, ctx.now(), p.meta.version, proposal.section, proposal.body, proposal.rationale, pattern.signature, pattern.bucketStart, proposal.source);
      opened.push(Number(r.lastInsertRowid));
      ctx.db
        .prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)')
        .run(ctx.now(), 'experiment_open', p.meta.id, JSON.stringify({ id: Number(r.lastInsertRowid), sig: pattern.signature, section: proposal.section, source: proposal.source }));
      break;
    }
  }
  return opened;
}
