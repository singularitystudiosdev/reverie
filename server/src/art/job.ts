/**
 * The automatic art step. Each tick (and on POST /admin/art/run) it takes the
 * non-seed drafts that have no `art.portrait`, generates a portrait, a
 * background and a 6 s profile video, post-processes them into the five files
 * every starter has (src/art/process.ts), attaches the art and activates the
 * persona. Default OFF; capped per UTC day by estimated spend.
 *
 * Failures: a provider error or moderation refusal marks that attempt failed
 * and leaves the persona a draft; it is retried next tick, up to
 * `cfg.art.maxAttempts`, then a `art_gave_up` row lands in `lifecycle_log` and
 * the persona waits for a human (POST /admin/personas/:id/art). Retries reuse
 * the identical prompts: nothing is ever loosened or made more revealing.
 */
import type { Ctx } from '../context.ts';
import { artBrief } from '../lifecycle/evolve.ts';
import { lookPhrase } from '../lifecycle/niches.ts';
import type { Persona } from '../personas/schema.ts';
import { attachArt } from './attach.ts';
import { processArt, artPaths } from './process.ts';
import { buildPrompts, videoPromptFor, type ArtSubject } from './prompts.ts';
import { ArtProviderError, GeminiXaiProvider, missingArtKeys, type ArtProvider } from './providers.ts';

export interface ArtRunResult {
  enabled: boolean;
  /** Why nothing (more) ran: disabled | missing-keys | budget | busy. */
  skipped?: string;
  attached: string[];
  failed: { id: string; kind: 'refused' | 'failed'; error: string }[];
  gaveUp: string[];
  spentTodayUsd: number;
  budgetUsd: number;
}

const running = new WeakSet<Ctx>();
const warned = new WeakSet<Ctx>();

/** 00:00 UTC of the day containing `ts`. */
export function utcDayStart(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Estimated spend since 00:00 UTC today, summed over every attempt in the ledger. */
export function spentToday(ctx: Ctx): number {
  const start = utcDayStart(ctx.now());
  const row = ctx.db.prepare('SELECT COALESCE(SUM(est_usd), 0) AS s FROM art_spend WHERE ts >= ? AND ts < ?').get(start, start + 86_400_000) as { s: number };
  return row.s;
}

const attemptsOf = (ctx: Ctx, id: string): number =>
  (ctx.db.prepare("SELECT COUNT(*) AS n FROM art_spend WHERE persona_id = ? AND status != 'ok'").get(id) as { n: number }).n;

/** Non-seed drafts still waiting on art, oldest first. */
export function draftsNeedingArt(ctx: Ctx): Persona[] {
  return ctx.personas
    .all()
    .filter((p) => p.meta.status === 'draft' && p.meta.branch !== 'seed' && !p.meta.art.portrait)
    .sort((a, b) => a.meta.created.localeCompare(b.meta.created) || a.meta.id.localeCompare(b.meta.id));
}

/** Numbers for GET /admin/art-queue. */
export function artStatus(ctx: Ctx) {
  const a = ctx.cfg.art;
  const spent = spentToday(ctx);
  return {
    enabled: a.enabled,
    keysMissing: missingArtKeys(a),
    dailyBudgetUsd: a.dailyBudgetUsd,
    spentTodayUsd: Math.round(spent * 10_000) / 10_000,
    remainingTodayUsd: Math.max(0, Math.round((a.dailyBudgetUsd - spent) * 10_000) / 10_000),
    perPersonaEstimateUsd: a.perPersonaEstimateUsd,
    maxPerTick: a.maxPerTick,
    maxAttempts: a.maxAttempts,
    outputDir: a.outputDir,
    recent: ctx.db.prepare('SELECT id, persona_id, ts, est_usd, status, error FROM art_spend ORDER BY id DESC LIMIT 20').all(),
  };
}

const clean = (s: string, max = 80): string => s.replace(/[^\p{L}\p{N} ,.'()&-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const words = (s: string): string => clean(s.replace(/-/g, ' '), 40);

/** The prompt builder's input for a persona the server invented, from its meta and `artBrief`. */
export function subjectFromPersona(p: Persona): ArtSubject {
  const d = p.meta.descriptors;
  const scene = `${words(d.setting)}, ${words(d.era)} era`;
  return {
    name: clean(p.meta.name),
    kind: clean(p.meta.kind, 120),
    style: p.meta.style,
    age: clean(p.meta.age, 30),
    gender: p.meta.gender,
    form: d.form,
    // The look block's ethnicity and muscle first, so the portrait matches the tags the feed learns from.
    look: `${[clean(lookPhrase(p.meta.look, p.meta.gender), 60), `${words(d.body)} build`].filter(Boolean).join(', ')}, ${words(d.form)}, ${words(d.vibe)} expression, a modest outfit that fits the ${words(d.era)} era, ${scene}`,
    scene,
    strict: true,
    brief: clean(artBrief(p), 600),
  };
}

function logGaveUp(ctx: Ctx, id: string, lastError: string): void {
  const done = ctx.db.prepare("SELECT 1 FROM lifecycle_log WHERE kind = 'art_gave_up' AND persona_id = ?").get(id);
  if (done) return;
  ctx.db
    .prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)')
    .run(ctx.now(), 'art_gave_up', id, JSON.stringify({ attempts: attemptsOf(ctx, id), lastError, next: 'attach art by hand: POST /admin/personas/:id/art' }));
}

export async function runArtJob(ctx: Ctx, opts: { only?: string } = {}): Promise<ArtRunResult> {
  const a = ctx.cfg.art;
  const result: ArtRunResult = { enabled: a.enabled, attached: [], failed: [], gaveUp: [], spentTodayUsd: 0, budgetUsd: a.dailyBudgetUsd };
  const finish = (skipped?: string): ArtRunResult => {
    result.spentTodayUsd = Math.round(spentToday(ctx) * 10_000) / 10_000;
    if (skipped) result.skipped = skipped;
    return result;
  };
  if (!a.enabled) return finish('disabled');

  let provider = ctx.artProvider;
  if (!provider) {
    const missing = missingArtKeys(a);
    if (missing.length) {
      if (!warned.has(ctx)) {
        warned.add(ctx);
        console.warn(`[art] REVERIE_AUTO_ART is on but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set; skipping automatic art`);
      }
      return finish('missing-keys');
    }
    provider = new GeminiXaiProvider(a);
  }
  if (running.has(ctx)) return finish('busy');
  running.add(ctx);
  try {
    let handled = 0;
    for (const p of draftsNeedingArt(ctx)) {
      if (opts.only && p.meta.id !== opts.only) continue;
      if (attemptsOf(ctx, p.meta.id) >= a.maxAttempts) {
        logGaveUp(ctx, p.meta.id, 'attempt limit reached');
        if (!result.gaveUp.includes(p.meta.id)) result.gaveUp.push(p.meta.id);
        continue;
      }
      if (handled >= a.maxPerTick) break;
      if (spentToday(ctx) + a.perPersonaEstimateUsd > a.dailyBudgetUsd) return finish('budget');
      handled++;
      await generateOne(ctx, provider, p, result);
    }
    return finish();
  } finally {
    running.delete(ctx);
  }
}

async function generateOne(ctx: Ctx, provider: ArtProvider, p: Persona, result: ArtRunResult): Promise<void> {
  const a = ctx.cfg.art;
  const id = p.meta.id;
  const rowId = Number(
    ctx.db.prepare("INSERT INTO art_spend (persona_id, ts, est_usd, status) VALUES (?, ?, 0, 'pending')").run(id, ctx.now()).lastInsertRowid,
  );
  let cost = 0;
  const charge = (usd: number) => {
    cost = Math.max(0, cost + usd);
    ctx.db.prepare('UPDATE art_spend SET est_usd = ? WHERE id = ?').run(cost, rowId);
  };
  try {
    const prompts = buildPrompts(subjectFromPersona(p));
    const portrait = await provider.still(prompts.portrait);
    charge(a.imageUsd);
    const scene = await provider.scene(prompts.scene);
    charge(a.imageUsd);
    // Charged before the call so a crash mid-poll still counts; refunded if the provider never took the job.
    const videoCost = a.videoUsdPerSec * a.videoSeconds;
    charge(videoCost);
    let video: Buffer;
    try {
      video = await provider.video(videoPromptFor(prompts), portrait);
    } catch (e) {
      if (e instanceof ArtProviderError && !e.billed) charge(-videoCost);
      throw e;
    }
    await processArt(id, { portrait, scene, video }, a.outputDir);
    attachArt(ctx, ctx.personas.get(id) ?? p, artPaths(id), true);
    ctx.db.prepare("UPDATE art_spend SET status = 'ok' WHERE id = ?").run(rowId);
    ctx.db
      .prepare('INSERT INTO lifecycle_log (ts, kind, persona_id, detail) VALUES (?, ?, ?, ?)')
      .run(ctx.now(), 'art_attached', id, JSON.stringify({ estUsd: Math.round(cost * 10_000) / 10_000, files: Object.keys(artPaths(id)) }));
    result.attached.push(id);
  } catch (e) {
    const kind = e instanceof ArtProviderError ? e.kind : 'failed';
    const error = (e as Error).message.slice(0, 500);
    ctx.db.prepare('UPDATE art_spend SET status = ?, error = ? WHERE id = ?').run(kind, error, rowId);
    result.failed.push({ id, kind, error });
    console.warn(`[art] ${id}: ${kind}: ${error}`);
    if (attemptsOf(ctx, id) >= a.maxAttempts) {
      logGaveUp(ctx, id, error);
      result.gaveUp.push(id);
    }
  }
}
