/**
 * Every tunable in one place. Each value names the source it was taken from
 * (see server/README.md, "Prior art") so the next reader can check it.
 *
 * Environment overrides: REVERIE_DB, REVERIE_PERSONAS_DIR, PORT,
 * ANTHROPIC_API_KEY (LLM features; offline fallbacks without it),
 * REVERIE_REQUIRE_ART=0 (activate generated personas without art),
 * REVERIE_TICK_MS (scheduler cadence).
 * Automatic art (default OFF, see `art` below and server/README.md): REVERIE_AUTO_ART=1,
 * GEMINI_API_KEY (stills), XAI_API_KEY (video), REVERIE_ART_DAILY_USD (UTC-day spend cap),
 * REVERIE_ART_PERSONA_USD, REVERIE_ART_DIR, REVERIE_ART_MAX_PER_TICK.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');

const env = (k: string): string | undefined => (typeof process !== 'undefined' ? process.env[k] : undefined);
const num = (k: string, d: number): number => {
  const v = env(k);
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

export interface Config {
  dbPath: string;
  personasDir: string;
  port: number;
  tickMs: number;
  /** One day in ms. The simulation shrinks time by overriding this. */
  dayMs: number;

  llm: {
    model: string;
    /** Chat replies are short and voice-driven: low effort is enough (claude-api skill, effort guidance). */
    chatEffort: 'low' | 'medium' | 'high';
    /** Persona edits and new personas are judgement work. */
    authorEffort: 'low' | 'medium' | 'high';
    enabled: boolean;
  };

  telemetry: {
    /** A conversation has dropped at turn t when the user has been silent this long after it. */
    dropGapMs: number;
    /** The "deep chat" threshold: the user sent at least this many messages. */
    deepChatTurns: number;
    /** Restricted mean user turns is truncated here (RMST@12, sharpen pass). */
    rmstCap: number;
    /** Inverse-propensity weights are clipped here (sharpen pass, IPW). */
    ipwClip: number;
    /** Minimum persona messages behind a drop pattern before it is trusted. */
    patternMinSupport: number;
  };

  experiments: {
    /** Target false discovery rate across all persona tests (online FDR, LORD++); each test gets
     *  its own level at its start from `fdr` (arXiv 1710.00499; asynchronous form arXiv 1812.05068). */
    alpha: number;
    fdr: 'lord' | 'none';
    /** Open tests only when the server's LLM writes the replies. With no LLM the app shows its
     *  scripted replies, both arms are identical, and any "win" would be noise. */
    requireServedReplies: boolean;
    /** Delayed start: no decision before this many target-turn conversations per arm
     *  (asymptotic CS are only near-valid for a late first peek, arXiv 2103.06476 Thm 2.8). */
    minPerArm: number;
    /** Futility stop: max target conversations per arm. */
    maxPerArm: number;
    /** Futility: discard when the CS upper bound on the lift is below this. */
    futilityLift: number;
    /** Guardrail margins: a CS lower bound below -margin blocks promotion. */
    guardrailDeepChat: number;
    guardrailRmst: number;
    guardrailNegative: number;
    /** Persona needs this many finished conversations before patterns drive a proposal. */
    minConversationsForProposal: number;
    /** Top winning edits from the cross-persona library shown to the proposer. */
    libraryHints: number;
  };

  lifecycle: {
    /** Power calculation for the significance gate: detect `mde` absolute lift at `power`. */
    gateAlpha: number;
    gatePower: number;
    gateMde: number;
    /** Hard floors so the gate never opens on a handful of users. */
    gateMinImpressions: number;
    gateMinConversations: number;
    /** A persona still short of the gate after this multiple of the median time is flagged and stops blocking. */
    gateTimeoutMultiple: number;
    /** New personas per generation, per branch. */
    exploreCount: number;
    exploitCount: number;
    /** Fade: the upper confidence bound must sit below this quantile of the roster's scores
     *  (0.25: confidently in the bottom quartile) for `fadeStreak` consecutive ticks. */
    fadeQuantile: number;
    fadeStreak: number;
    fadeDecay: number;
    fadeRetireBelow: number;
    maxRetiresPerTick: number;
    minActive: number;
    /** Roster cap: a generation only fills the room fading has made under it. */
    maxActive: number;
    requireArt: boolean;
  };

  feed: {
    deckSize: number;
    /** Every k-th card the user decides on is an exploration slot (random, or the user's best
     *  among the least-shown quarter). 10, not 5: in the paired closed loop under the app's paging,
     *  1 in 10 kept the like rate of a ranker that never explored (23.28% vs 23.46%, 5 seeds) where
     *  1 in 5 cost 1.2 points; the price is a slower lifecycle (a persona needs 30 random-slot
     *  swipes before it can fade). */
    exploreEvery: number;
    /** Per-user category posterior is shrunk toward the global category rate with this pseudo-count. */
    userShrink: number;
    /** Thompson draw spread: each user-informed Beta draw (affinity on tags the user has swiped,
     *  persona like rate) is pulled toward its mean by this factor (1 = plain Thompson sampling,
     *  0 = posterior means, no randomness). Chapelle & Li (NeurIPS 2011) found a
     *  shrunk posterior did better on display-ad data; 0.3 from the feed bench (SIMULATION.md),
     *  kept above 0 so exploit cards keep a selection propensity strictly between 0 and 1. */
    tsScale: number;
    /** DPP quality/diversity knob (X vm-ranker dpp.rs: alpha = theta / (2(1 - theta)); X ships 0.65). */
    dppTheta: number;
    /** The DPP chooses among the top dppPool x (deck size) candidates by score only (X: top 150 of its pool). */
    dppPool: number;
    /** 'score': the DPP's picks shown in score order, as X does (its whole slate is consumed);
     *  'pick': in the order the DPP chose them, so the diversity reaches the 3 cards the app shows
     *  of each page. Pick order: the visible window 37% less alike (mean kernel cosine 0.09 vs
     *  0.14), like probability -0.002 where tags explain taste and +0.005 with a latent look
     *  (feed bench, 3 ranker seeds); the bench has no satiation, so variety itself is unpriced. */
    dppOrder: 'score' | 'pick';
    /** A passed persona may come back once the unseen roster runs short, this long after the pass. */
    recycleAfterMs: number;
    /** Dynamic-prior Thompson sampling for new personas (arXiv 2602.00943): P(new beats incumbent) = eps. */
    newEps: number;
    newPriorStrength: number;
    /** Monte Carlo draws used to estimate each card's selection propensity. */
    propensityDraws: number;
    /** Cards the app shows from a page before it asks for a new one (src/state/store.tsx
     *  REFRESH_AFTER): the window the propensities are logged for. The client may send its own. */
    visible: number;
    /** Persona-to-persona collaborative term (item-based CF on the model's residuals): weight of
     *  the log O/E lift of a candidate among users who liked what this user liked; 0 turns it off.
     *  0.5 from the feed bench under the app's paging (SIMULATION.md): +0.009 mean true like
     *  probability per card with a hidden "look" taste, +0.004 / -0.002 (within noise) without. */
    cfWeight: number;
    /** Pseudo-likes pulling each persona-pair O/E lift toward 1. */
    cfShrink: number;
    /** The persona-to-persona term: 'oe' (likes over the ranker's prediction among fans of what the
     *  user liked) or 'ease' (Steck 2019's closed-form item-item weights on the like matrix,
     *  arXiv 1905.03375; the term is exp(3 x cfWeight x the user's EASE score)). */
    cfMethod: 'oe' | 'ease';
    /** EASE's L2 penalty on the persona-persona weights. */
    easeLambda: number;
    /** Exploration stops where its sample is in: a random slot draws only among personas with
     *  fewer random-slot swipes than this (the fade check needs 30; the rest is headroom), an
     *  undersampled slot only among personas short of `undersampledTarget` impressions (0: the
     *  gate's own power-calculated count). The draw never depends on the user, so the random
     *  sample stays unbiased. The explore cards cost about 0.1 like probability each against an
     *  exploit card (SIMULATION.md); once every persona has its samples the deck stops paying it. */
    randomTarget: number;
    undersampledTarget: number;
    /** Combine the P(like) factors with weights fitted to the swipes (a logistic regression on
     *  the logs of the factors logged with each serve, ridge toward the plain product) instead of
     *  multiplying them at weight 1 each, which made predictions about 3x too spread in logit
     *  space. Feed bench (3 ranker seeds): +0.009 with a latent look, a tie without. Paired closed
     *  loop under the app's paging (5 seeds, the same users in every arm): +0.58 points of like
     *  rate (all 5 seeds) and +0.026 deep chats per user against off (SIMULATION.md). Falls back
     *  to the product below 500 swipes. */
    calibrate: boolean;
    /** With fitted weights, the persona-level chat term (1 + w_deep P(deep) - w_neg P(report)) is
     *  raised to this power: the fit halves P(like)'s spread, so the term's say is halved too. */
    calibratedChatExponent: number;
  };

  /**
   * Automatic art for personas the loop invents (src/art/). Default OFF: it spends money.
   * With it on and both API keys set, each tick generates a portrait, a background and a
   * 6 s profile video for non-seed drafts that have no art, post-processes them into the
   * five files the starters have, attaches the art and activates the persona. Estimated
   * spend is written to the `art_spend` table and refused past `dailyBudgetUsd` (UTC day).
   */
  art: {
    enabled: boolean;
    /** Hard cap on estimated spend per UTC day. */
    dailyBudgetUsd: number;
    /** What one persona is expected to cost; checked against the cap before each persona.
     *  Default = 2 images + `videoSeconds` of video (about $0.42). */
    perPersonaEstimateUsd: number;
    /** List prices read 2026-11-05 (Gemini image ~$0.057 incl. prompt tokens; xAI grok-imagine-video $0.05/s). */
    imageUsd: number;
    videoUsdPerSec: number;
    videoSeconds: number;
    /** Where the five files per persona land; the app serves them as /characters/<id>... */
    outputDir: string;
    /** Personas handled per tick (and per POST /admin/art/run). */
    maxPerTick: number;
    /** Failed or refused attempts allowed per persona before it is left for a human. */
    maxAttempts: number;
    /** Gemini image model, size and the xAI video model: see src/art/providers.ts for the docs. */
    imageModel: string;
    imageSize: string;
    videoModel: string;
    geminiKey?: string;
    xaiKey?: string;
  };

  /** Persona score: components shrunk toward the population rate with `shrink` pseudo-observations,
   *  weighted 1/(population rate) so each contributes about equally (heavy-ranker rule); negatives
   *  are weighted `negativeMultiple` times the mean positive weight. */
  score: { negativeMultiple: number; shrink: number };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function loadConfig(overrides: DeepPartial<Config> = {}): Config {
  const base: Config = {
    dbPath: env('REVERIE_DB') ?? path.join(SERVER_ROOT, 'data', 'reverie.db'),
    personasDir: env('REVERIE_PERSONAS_DIR') ?? path.join(SERVER_ROOT, 'personas'),
    port: num('PORT', 8787),
    tickMs: num('REVERIE_TICK_MS', 15 * 60_000),
    dayMs: 86_400_000,
    llm: {
      model: env('REVERIE_MODEL') ?? 'claude-opus-5-5',
      chatEffort: 'low',
      authorEffort: 'high',
      enabled: Boolean(env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN')),
    },
    telemetry: {
      dropGapMs: 24 * 3_600_000,
      deepChatTurns: 10,
      rmstCap: 12,
      ipwClip: 20,
      patternMinSupport: 20,
    },
    experiments: {
      alpha: 0.05,
      fdr: 'lord',
      requireServedReplies: true,
      minPerArm: 200,
      maxPerArm: 3000,
      futilityLift: 0.02,
      guardrailDeepChat: 0.03,
      guardrailRmst: 0.3,
      guardrailNegative: 0.01,
      minConversationsForProposal: 150,
      libraryHints: 3,
    },
    lifecycle: {
      gateAlpha: 0.05,
      gatePower: 0.8,
      gateMde: 0.05,
      gateMinImpressions: 400,
      gateMinConversations: 100,
      gateTimeoutMultiple: 3,
      exploreCount: 2,
      exploitCount: 2,
      fadeQuantile: 0.25,
      fadeStreak: 3,
      fadeDecay: 0.5,
      fadeRetireBelow: 0.05,
      maxRetiresPerTick: 1,
      minActive: 8,
      maxActive: 200,
      requireArt: env('REVERIE_REQUIRE_ART') !== '0',
    },
    feed: {
      deckSize: 10,
      exploreEvery: 10,
      userShrink: 4,
      tsScale: 0.3,
      dppTheta: 0.65,
      dppPool: 3,
      dppOrder: 'pick',
      recycleAfterMs: 3 * 86_400_000,
      newEps: 0.1,
      newPriorStrength: 30,
      propensityDraws: 32,
      visible: 3,
      cfWeight: 0.5,
      cfShrink: 3,
      cfMethod: 'oe',
      easeLambda: 100,
      randomTarget: 40,
      undersampledTarget: 0,
      calibrate: true,
      calibratedChatExponent: 0.5,
    },
    art: {
      enabled: env('REVERIE_AUTO_ART') === '1',
      dailyBudgetUsd: num('REVERIE_ART_DAILY_USD', 5),
      perPersonaEstimateUsd: num('REVERIE_ART_PERSONA_USD', 2 * 0.057 + 6 * 0.05),
      imageUsd: 0.057,
      videoUsdPerSec: 0.05,
      videoSeconds: 6,
      outputDir: env('REVERIE_ART_DIR') ?? path.resolve(SERVER_ROOT, '..', 'public', 'characters'),
      maxPerTick: num('REVERIE_ART_MAX_PER_TICK', 2),
      maxAttempts: 3,
      imageModel: 'gemini-nano-banana-2.1',
      imageSize: '2K',
      videoModel: 'grok-imagine-video',
      geminiKey: env('GEMINI_API_KEY'),
      xaiKey: env('XAI_API_KEY'),
    },
    score: { negativeMultiple: 3, shrink: 50 },
  };
  return deepMerge(base, overrides);
}

function deepMerge<T>(a: T, b: DeepPartial<T>): T {
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    const cur = out[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object'
        ? deepMerge(cur, v as DeepPartial<typeof cur>)
        : v;
  }
  return out as T;
}
