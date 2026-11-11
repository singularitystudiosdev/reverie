/**
 * Every tunable in one place. Each value names the source it was taken from
 * (see server/README.md, "Prior art") so the next reader can check it.
 *
 * Environment overrides: REVERIE_DB, REVERIE_PERSONAS_DIR, PORT,
 * ANTHROPIC_API_KEY (LLM features; offline fallbacks without it),
 * REVERIE_REQUIRE_ART=0 (activate generated personas without art),
 * REVERIE_TICK_MS (scheduler cadence).
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
    alpha: number;
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
    /** Every k-th card is an exploration slot (random or furthest from the gate). */
    exploreEvery: number;
    /** Per-user category posterior is shrunk toward the global category rate with this pseudo-count. */
    userShrink: number;
    /** Category diversity decay per repeat inside one deck (X author-diversity decay analog). */
    diversityDecay: number;
    diversityFloor: number;
    /** DPP quality/diversity knob (X vm-ranker dpp.rs: alpha = theta / (2(1 - theta))). */
    dppTheta: number;
    /** Dynamic-prior Thompson sampling for new personas (arXiv 2602.00943): P(new beats incumbent) = eps. */
    newEps: number;
    newPriorStrength: number;
    /** Monte Carlo draws used to estimate each card's selection propensity. */
    propensityDraws: number;
    /** Minimum traffic share any active persona keeps (GrowthBook bandits floor). */
    floorShare: number;
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
      maxActive: 40,
      requireArt: env('REVERIE_REQUIRE_ART') !== '0',
    },
    feed: {
      deckSize: 10,
      exploreEvery: 5,
      userShrink: 4,
      diversityDecay: 0.92,
      diversityFloor: 0.6,
      dppTheta: 0.5,
      newEps: 0.1,
      newPriorStrength: 30,
      propensityDraws: 32,
      floorShare: 0.01,
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
