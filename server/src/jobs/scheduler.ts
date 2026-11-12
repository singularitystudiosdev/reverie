/**
 * One tick of the loop, in dependency order:
 *   1. rollups      per-persona telemetry and scores
 *   2. experiments  evaluate running tests; promote winners into the markdown
 *   3. fade         decay and retire persistent underperformers
 *   4. gate         every active persona at a significant sample?
 *   5. art          (opt-in, capped) draw, process and attach art for drafts
 *                   waiting on it, so they go live without a human
 *   6. evolve       if the gate is open (and no generation is still waiting on art),
 *                   spawn explore + exploit personas, globally
 *   7. experiments  open new tests for personas with enough conversations
 *   8. report       a markdown leaderboard in data/report.md
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../context.ts';
import { runArtJob, type ArtRunResult } from '../art/job.ts';
import { evaluateAll, libraryHitRate, type Evaluation } from '../experiments/engine.ts';
import { startExperiments } from '../experiments/start.ts';
import { invalidateFeedModel } from '../feed/model.ts';
import { spawnGeneration } from '../lifecycle/evolve.ts';
import { fadeTick, type FadeResult } from '../lifecycle/fade.ts';
import { computeGate, type GateStatus } from '../lifecycle/gate.ts';
import { rebuildArchive } from '../lifecycle/niches.ts';
import { computeAllStats, type PersonaStats } from '../telemetry/rollups.ts';

export interface TickReport {
  at: number;
  stats: PersonaStats[];
  evaluations: Evaluation[];
  fade: FadeResult;
  gate: GateStatus;
  spawned: string[];
  opened: number[];
  art: ArtRunResult;
}

/**
 * A new generation waits for the last one's art, except drafts the art job gave up on: they stay in
 * the art queue for a person and must not stall the loop forever.
 */
export function waitingOnArt(ctx: Ctx): boolean {
  const gaveUp = new Set((ctx.db.prepare("SELECT persona_id FROM lifecycle_log WHERE kind = 'art_gave_up'").all() as { persona_id: string }[]).map((r) => r.persona_id));
  return ctx.personas.all().some((p) => p.meta.status === 'draft' && p.meta.branch !== 'seed' && !gaveUp.has(p.meta.id));
}

export async function tick(ctx: Ctx, opts: { writeReport?: string | false; art?: boolean } = {}): Promise<TickReport> {
  invalidateFeedModel(ctx);
  let stats = computeAllStats(ctx);
  const evaluations = evaluateAll(ctx);
  if (evaluations.some((e) => e.decision === 'promote')) stats = computeAllStats(ctx);
  let gate = computeGate(ctx, stats);
  const fade = fadeTick(ctx, stats, gate);
  if (fade.faded.length || fade.retired.length || fade.restored.length) gate = computeGate(ctx, stats);

  // Art first, so drafts it finishes this tick no longer hold back the next generation.
  const noArt = (skipped: string): ArtRunResult => ({ enabled: ctx.cfg.art.enabled, skipped, attached: [], failed: [], gaveUp: [], spentTodayUsd: 0, budgetUsd: ctx.cfg.art.dailyBudgetUsd });
  const art = opts.art === false ? noArt('not-run') : await runArtJob(ctx).catch((e) => (console.error('[tick] art job failed', e), noArt('error')));
  let spawned: string[] = [];
  if (gate.open && !waitingOnArt(ctx)) {
    ctx.db.prepare('INSERT INTO lifecycle_log (ts, kind, detail) VALUES (?, ?, ?)').run(
      ctx.now(),
      'gate_open',
      JSON.stringify({ nImpressions: gate.nImpressions, nConversations: gate.nConversations, personas: gate.personas.length }),
    );
    const eligible = new Set(gate.personas.filter((g) => g.reached).map((g) => g.id));
    spawned = (await spawnGeneration(ctx, stats, eligible)).map((p) => p.meta.id);
  } else rebuildArchive(ctx, stats);

  const opened = await startExperiments(ctx);
  invalidateFeedModel(ctx);
  const report: TickReport = { at: ctx.now(), stats, evaluations, fade, gate, spawned, opened, art };
  if (opts.writeReport !== false) writeReport(ctx, report, opts.writeReport ?? path.join(path.dirname(ctx.cfg.dbPath), 'report.md'));
  return report;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function renderReport(ctx: Ctx, r: TickReport): string {
  const rows = [...r.stats].sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0));
  const lines = [
    `# Reverie persona report`,
    ``,
    `Generated ${new Date(r.at).toISOString()}. Gate: ${r.gate.open ? 'OPEN' : 'closed'} (needs ${r.gate.nImpressions} impressions and ${r.gate.nConversations} conversations per active persona${r.gate.blocking.length ? `; blocking: ${r.gate.blocking.join(', ')}` : ''}).`,
    ``,
    `| Persona | v | Status | Score [CI] | Impr. | Like (IPW) | Chat start | Avg turns | Deep chat | Min/conv | D1 | D7 | Back to her | Premium 7d | Re-swipe | Negative | Median drop turn |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
    ...rows.map(
      (s) =>
        `| ${s.personaId} | ${s.version} | ${s.status} | ${s.score ? `${s.score.score.toFixed(2)} [${s.score.lower.toFixed(2)}, ${s.score.upper.toFixed(2)}]` : '-'} | ${s.impressions} | ${pct(s.likeRateIpw.rate)} | ${pct(s.chatStartRate.rate)} | ${s.avgUserTurns.toFixed(1)} | ${pct(s.deepChatRate.rate)} | ${s.avgTimeMinPerConversation.toFixed(1)} | ${pct(s.d1Return.rate)} | ${pct(s.d7Return.rate)} | ${pct(s.personaReturn.rate)} | ${pct(s.premiumConversion.rate)} | ${pct(s.reswipeRate.rate)} | ${pct(s.negativeRate.rate)} | ${s.drop.medianDropTurn} |`,
    ),
    ``,
    `## Worst drop patterns`,
    ``,
    ...rows.flatMap((s) =>
      s.drop.patterns.slice(0, 2).map((p) => `- ${s.personaId}: \`${p.signature}\` drops ${pct(p.dropRate)} vs ${pct(p.baseRate)} (lift ${p.lift.toFixed(2)}, n=${p.support})`),
    ),
    ``,
    `## Experiments`,
    ``,
    ...r.evaluations.map(
      (e) =>
        `- #${e.experimentId}: pass ${pct(e.control.pass)} -> ${pct(e.treatment.pass)}, CS (${(e.target.lower * 100).toFixed(1)}, ${(e.target.upper * 100).toFixed(1)})pp, n=${e.nControl}+${e.nTreatment}: ${e.decision}`,
    ),
    ``,
    `Edit library transfer: ${JSON.stringify(libraryHitRate(ctx))}`,
    ``,
    `## This tick`,
    ``,
    `- faded: ${r.fade.faded.join(', ') || 'none'}; retired: ${r.fade.retired.join(', ') || 'none'}; restored: ${r.fade.restored.join(', ') || 'none'}`,
    `- spawned: ${r.spawned.join(', ') || 'none'}`,
    `- art: ${r.art.enabled ? `attached ${r.art.attached.join(', ') || 'none'}; failed ${r.art.failed.map((f) => f.id).join(', ') || 'none'}; spent today $${r.art.spentTodayUsd.toFixed(2)} of $${r.art.budgetUsd.toFixed(2)}${r.art.skipped ? ` (${r.art.skipped})` : ''}` : 'off'}`,
    `- experiments opened: ${r.opened.join(', ') || 'none'}`,
  ];
  return lines.join('\n') + '\n';
}

function writeReport(ctx: Ctx, r: TickReport, file: string): void {
  if (ctx.cfg.dbPath === ':memory:') return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderReport(ctx, r));
}

export function startScheduler(ctx: Ctx): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await tick(ctx);
      console.log(`[tick] ${r.stats.length} personas, gate ${r.gate.open ? 'open' : 'closed'}, ${r.evaluations.length} experiments, spawned ${r.spawned.length}`);
    } catch (e) {
      console.error('[tick] failed', e);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(run, ctx.cfg.tickMs);
  setTimeout(run, 5_000);
  return () => clearInterval(handle);
}
