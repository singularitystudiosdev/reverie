/**
 * One SQLite file (node:sqlite, no native dependency) holds everything the
 * loop learns: the append-only event log, derived conversation and message
 * rows, persona version history, experiments, the niche archive and the
 * per-user affinity posteriors. The persona markdown files stay the source of
 * truth for what a persona IS; this file is the source of truth for how it did.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  is_adult    INTEGER NOT NULL DEFAULT 1,
  premium_at  INTEGER,
  props       TEXT
);

-- Append-only. Every client and server signal lands here first.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  ts          INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  type        TEXT NOT NULL,
  persona_id  TEXT,
  persona_ver INTEGER,
  conv_id     TEXT,
  props       TEXT
);
CREATE INDEX IF NOT EXISTS events_type_persona ON events(type, persona_id);
CREATE INDEX IF NOT EXISTS events_user_ts ON events(user_id, ts);

-- What the feed served, with its selection propensity (for IPW rollups).
CREATE TABLE IF NOT EXISTS feed_serves (
  request_id  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  ts          INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  persona_id  TEXT NOT NULL,
  slot        TEXT NOT NULL,      -- exploit | random | undersampled
  p_shown     REAL NOT NULL,
  score       REAL,
  p_pred      REAL,               -- the ranker's mean P(like) before the persona-to-persona term, at serve time
  factors     TEXT,               -- JSON [log affinity, log quality, log traits, log cf] at their means
  PRIMARY KEY (request_id, position)
);
CREATE INDEX IF NOT EXISTS feed_serves_user_persona ON feed_serves(user_id, persona_id);

-- Cards the user actually saw, joined to their serve row.
CREATE TABLE IF NOT EXISTS impressions (
  id          INTEGER PRIMARY KEY,
  ts          INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  persona_id  TEXT NOT NULL,
  slot        TEXT NOT NULL,
  p_shown     REAL NOT NULL,
  outcome     TEXT,               -- like | pass | null while undecided
  p_pred      REAL,               -- copied from the serve row (null: not served by the ranker)
  factors     TEXT,
  dwell_ms    INTEGER             -- impression to swipe: how long the card was looked at
);
CREATE INDEX IF NOT EXISTS impressions_persona ON impressions(persona_id);
CREATE INDEX IF NOT EXISTS impressions_user_persona ON impressions(user_id, persona_id);

CREATE TABLE IF NOT EXISTS matches (
  user_id     TEXT NOT NULL,
  persona_id  TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  ended_at    INTEGER,
  end_reason  TEXT,               -- unmatch | block | report
  PRIMARY KEY (user_id, persona_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  persona_id      TEXT NOT NULL,
  persona_ver     INTEGER,
  experiment_id   INTEGER,
  arm             TEXT,
  started_at      INTEGER NOT NULL,
  last_user_at    INTEGER,
  last_persona_at INTEGER,
  user_turns      INTEGER NOT NULL DEFAULT 0,
  persona_turns   INTEGER NOT NULL DEFAULT 0,
  farewell_turn   INTEGER,        -- user turn at which the user said goodbye
  time_ms         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS conversations_persona ON conversations(persona_id);
CREATE INDEX IF NOT EXISTS conversations_user_persona ON conversations(user_id, persona_id);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY,
  conv_id     TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  role        TEXT NOT NULL,      -- user | persona
  user_turn   INTEGER NOT NULL,   -- user turns so far when this message was sent
  text        TEXT NOT NULL,
  features    TEXT                -- persona messages: drop-pattern features (JSON)
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conv_id, id);

CREATE TABLE IF NOT EXISTS persona_versions (
  persona_id  TEXT NOT NULL,
  version     INTEGER NOT NULL,
  ts          INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  md          TEXT NOT NULL,
  PRIMARY KEY (persona_id, version)
);

CREATE TABLE IF NOT EXISTS persona_state (
  persona_id        TEXT PRIMARY KEY,
  first_seen_at     INTEGER,
  gate_reached_at   INTEGER,
  below_streak      INTEGER NOT NULL DEFAULT 0,
  fade_multiplier   REAL NOT NULL DEFAULT 1,
  gate_flagged      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS persona_stats (
  persona_id  TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  stats       TEXT NOT NULL
);

-- Descriptor values the explore branch's vocabulary has grown (lifecycle/niches.ts growVocabulary).
CREATE TABLE IF NOT EXISTS vocab (
  id     INTEGER PRIMARY KEY,
  axis   TEXT NOT NULL,
  value  TEXT NOT NULL,
  source TEXT NOT NULL,   -- llm | reserve
  ts     INTEGER NOT NULL,
  UNIQUE (axis, value)
);

CREATE TABLE IF NOT EXISTS experiments (
  id            INTEGER PRIMARY KEY,
  persona_id    TEXT NOT NULL,
  status        TEXT NOT NULL,    -- running | promoted | discarded
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  base_version  INTEGER NOT NULL,
  section       TEXT NOT NULL,
  variant_body  TEXT NOT NULL,      -- the edited section body (applied to the current persona at chat time)
  rationale     TEXT NOT NULL,
  pattern_sig   TEXT NOT NULL,
  target_turn   INTEGER NOT NULL,
  source        TEXT NOT NULL,    -- llm | library | heuristic
  alpha         REAL,             -- this test's level from online FDR control (LORD++), fixed at its start
  decision      TEXT,
  result        TEXT
);
CREATE INDEX IF NOT EXISTS experiments_persona ON experiments(persona_id, status);

CREATE TABLE IF NOT EXISTS assignments (
  user_id       TEXT NOT NULL,
  experiment_id INTEGER NOT NULL,
  arm           TEXT NOT NULL,
  ts            INTEGER NOT NULL,
  PRIMARY KEY (user_id, experiment_id)
);

-- Winning edits, reusable across personas that show the same drop pattern.
CREATE TABLE IF NOT EXISTS edit_library (
  id            INTEGER PRIMARY KEY,
  pattern_sig   TEXT NOT NULL,
  section       TEXT NOT NULL,
  source_persona TEXT NOT NULL,
  experiment_id INTEGER NOT NULL,
  before_text   TEXT NOT NULL,
  after_text    TEXT NOT NULL,
  lift          REAL NOT NULL,
  n             INTEGER NOT NULL,
  transferred   INTEGER NOT NULL DEFAULT 0,
  ts            INTEGER NOT NULL
);

-- MAP-Elites archive over persona descriptors.
CREATE TABLE IF NOT EXISTS niches (
  key         TEXT PRIMARY KEY,
  descriptors TEXT NOT NULL,
  persona_ids TEXT NOT NULL,
  best_score  REAL,
  tried       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lifecycle_log (
  id          INTEGER PRIMARY KEY,
  ts          INTEGER NOT NULL,
  kind        TEXT NOT NULL,      -- spawn_explore | spawn_exploit | fade | retire | promote | discard | gate_open | gate_flag | art_attached | art_gave_up
  persona_id  TEXT,
  detail      TEXT
);

-- Per-user, per-category Beta posteriors (the feed's "zoom in").
CREATE TABLE IF NOT EXISTS user_affinity (
  user_id   TEXT NOT NULL,
  category  TEXT NOT NULL,
  a         REAL NOT NULL,
  b         REAL NOT NULL,
  PRIMARY KEY (user_id, category)
);

-- Category co-like counts (TinVec reduced to a catalog this size).
CREATE TABLE IF NOT EXISTS colike (
  cat_a   TEXT NOT NULL,
  cat_b   TEXT NOT NULL,
  n       REAL NOT NULL,
  PRIMARY KEY (cat_a, cat_b)
);

-- Automatic art: one row per generation attempt. est_usd is the estimated spend the attempt
-- incurred (list prices from config); the daily cap sums it over the UTC day.
CREATE TABLE IF NOT EXISTS art_spend (
  id          INTEGER PRIMARY KEY,
  persona_id  TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  est_usd     REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL,      -- pending | ok | failed | refused
  error       TEXT
);
CREATE INDEX IF NOT EXISTS art_spend_ts ON art_spend(ts);
CREATE INDEX IF NOT EXISTS art_spend_persona ON art_spend(persona_id);

-- SB 243 style counters: crisis referrals, disclosures.
CREATE TABLE IF NOT EXISTS safety_events (
  id        INTEGER PRIMARY KEY,
  ts        INTEGER NOT NULL,
  user_id   TEXT,
  conv_id   TEXT,
  kind      TEXT NOT NULL
);
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  // Columns added after a database was first created.
  const cols = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  if (!cols('experiments').has('alpha')) db.exec('ALTER TABLE experiments ADD COLUMN alpha REAL');
  for (const t of ['feed_serves', 'impressions']) {
    if (!cols(t).has('p_pred')) db.exec(`ALTER TABLE ${t} ADD COLUMN p_pred REAL`);
    if (!cols(t).has('factors')) db.exec(`ALTER TABLE ${t} ADD COLUMN factors TEXT`);
  }
  if (!cols('impressions').has('dwell_ms')) db.exec('ALTER TABLE impressions ADD COLUMN dwell_ms INTEGER');
  return db;
}

/** Run `fn` inside one transaction. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function json<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
