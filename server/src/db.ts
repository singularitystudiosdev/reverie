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
  outcome     TEXT                -- like | pass | null while undecided
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
  kind        TEXT NOT NULL,      -- spawn_explore | spawn_exploit | fade | retire | promote | discard | gate_open | gate_flag
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
