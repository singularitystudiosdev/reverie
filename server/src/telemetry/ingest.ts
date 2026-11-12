/**
 * Event ingest. Every signal is appended to `events` first (the raw log is
 * never rewritten), then folded into the derived tables the loop reads:
 * impressions (with propensity), matches, conversations, messages, the
 * per-user category posteriors and the category co-like counts.
 */
import type { Ctx } from '../context.ts';
import { json } from '../db.ts';
import { assignArm } from '../experiments/engine.ts';
import { detect } from '../personas/safety.ts';
import { feedTags } from '../personas/schema.ts';
import { messageFeatures } from './features.ts';

export const EVENT_TYPES = [
  'session_start',
  'session_end',
  'heartbeat',
  'impression',
  'swipe',
  'profile_open',
  'match',
  'chat_open',
  'chat_close',
  'message',
  'deck_return',
  'deck_reset',
  'video_play',
  'premium_view',
  'premium_convert',
  'report',
  'block',
  'unmatch',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface IncomingEvent {
  type: EventType;
  user_id: string;
  ts?: number;
  session_id?: string;
  persona_id?: string;
  props?: Record<string, unknown>;
}

export function convId(userId: string, personaId: string): string {
  return `${userId}:${personaId}`;
}

export function validateEvent(e: unknown): e is IncomingEvent {
  if (!e || typeof e !== 'object') return false;
  const ev = e as Record<string, unknown>;
  return (
    typeof ev.type === 'string' &&
    (EVENT_TYPES as readonly string[]).includes(ev.type) &&
    typeof ev.user_id === 'string' &&
    ev.user_id.length > 0 &&
    ev.user_id.length <= 128 &&
    (ev.persona_id === undefined || typeof ev.persona_id === 'string')
  );
}

export function ingest(ctx: Ctx, e: IncomingEvent): void {
  const { db } = ctx;
  const now = ctx.now();
  // Client clocks drift; accept the client ts only within a day of the server's.
  const ts = typeof e.ts === 'number' && Math.abs(e.ts - now) < 86_400_000 ? e.ts : now;
  const props = e.props ?? {};
  const persona = e.persona_id ? ctx.personas.get(e.persona_id) : undefined;

  db.prepare(
    `INSERT INTO users (id, created_at, last_seen) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen)`,
  ).run(e.user_id, ts, ts);

  const cid = e.persona_id ? convId(e.user_id, e.persona_id) : null;
  db.prepare(
    'INSERT INTO events (ts, user_id, session_id, type, persona_id, persona_ver, conv_id, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(ts, e.user_id, e.session_id ?? null, e.type, e.persona_id ?? null, persona?.meta.version ?? null, cid, JSON.stringify(props));

  if (!e.persona_id) {
    if (e.type === 'premium_convert') {
      db.prepare('UPDATE users SET premium_at = COALESCE(premium_at, ?) WHERE id = ?').run(ts, e.user_id);
    }
    return;
  }
  const pid = e.persona_id;

  switch (e.type) {
    case 'impression': {
      // The request the client names first; the deck re-ranks every few swipes, so a card it shows
      // may have come from an earlier page: then the latest request that served it to this user.
      // The serve row also carries what the ranker predicted for this card (p_pred): the model's
      // persona-to-persona term reads it back as the expected side of its O/E ratios.
      const latest = db.prepare('SELECT slot, p_shown, p_pred FROM feed_serves WHERE user_id = ? AND persona_id = ? ORDER BY ts DESC LIMIT 1');
      const serve = ((typeof props.request_id === 'string'
        ? db.prepare('SELECT slot, p_shown, p_pred FROM feed_serves WHERE user_id = ? AND persona_id = ? AND request_id = ? LIMIT 1').get(e.user_id, pid, props.request_id)
        : undefined) ?? latest.get(e.user_id, pid)) as { slot: string; p_shown: number; p_pred: number | null } | undefined;
      db.prepare('INSERT INTO impressions (ts, user_id, persona_id, slot, p_shown, p_pred) VALUES (?, ?, ?, ?, ?, ?)').run(
        ts,
        e.user_id,
        pid,
        serve?.slot ?? 'unranked',
        serve?.p_shown ?? 1,
        serve?.p_pred ?? null,
      );
      break;
    }
    case 'swipe': {
      const dir = props.dir === 'like' ? 'like' : 'pass';
      const open = db
        .prepare('SELECT id, ts FROM impressions WHERE user_id = ? AND persona_id = ? AND outcome IS NULL ORDER BY ts DESC LIMIT 1')
        .get(e.user_id, pid) as { id: number; ts: number } | undefined;
      // Dwell (impression to swipe) is logged for every decided card: a quick pass and a long look
      // before a pass say different things (Hinge reads a fast skip as "not your type"; X's ranker
      // predicts dwell; Yi et al., RecSys 2014). The ranker does not read it yet: it needs real
      // swipes to calibrate, and the simulator has no dwell to learn it from.
      const dwell = open && ts >= open.ts && ts - open.ts < 10 * 60_000 ? ts - open.ts : null;
      if (open) db.prepare('UPDATE impressions SET outcome = ?, dwell_ms = ? WHERE id = ?').run(dir, dwell, open.id);
      else
        db.prepare('INSERT INTO impressions (ts, user_id, persona_id, slot, p_shown, outcome) VALUES (?, ?, ?, ?, ?, ?)').run(
          ts,
          e.user_id,
          pid,
          'unranked',
          1,
          dir,
        );
      if (dir === 'like') {
        const passedBefore = db
          .prepare("SELECT 1 FROM impressions WHERE user_id = ? AND persona_id = ? AND outcome = 'pass' LIMIT 1")
          .get(e.user_id, pid);
        if (passedBefore) {
          db.prepare('INSERT INTO events (ts, user_id, type, persona_id, conv_id, props) VALUES (?, ?, ?, ?, ?, ?)').run(
            ts,
            e.user_id,
            'reswipe',
            pid,
            cid,
            '{}',
          );
        }
        updateColike(ctx, e.user_id, pid);
      }
      bumpAffinity(ctx, e.user_id, pid, dir === 'like' ? 1 : 0, dir === 'like' ? 0 : 1);
      break;
    }
    case 'match':
      db.prepare('INSERT OR IGNORE INTO matches (user_id, persona_id, ts) VALUES (?, ?, ?)').run(e.user_id, pid, ts);
      break;
    case 'chat_open':
      ensureConversation(ctx, e.user_id, pid, ts);
      break;
    case 'chat_close': {
      const ms = Number(props.duration_ms);
      if (Number.isFinite(ms) && ms > 0 && ms < 6 * 3_600_000) {
        ensureConversation(ctx, e.user_id, pid, ts);
        db.prepare('UPDATE conversations SET time_ms = time_ms + ? WHERE id = ?').run(Math.round(ms), cid);
      }
      break;
    }
    case 'message': {
      const role = props.from === 'persona' || props.from === 'her' ? 'persona' : 'user';
      const text = typeof props.text === 'string' ? props.text.slice(0, 4000) : '';
      recordMessage(ctx, e.user_id, pid, role, text, ts);
      break;
    }
    case 'report':
    case 'block':
    case 'unmatch':
      db.prepare('UPDATE matches SET ended_at = ?, end_reason = ? WHERE user_id = ? AND persona_id = ? AND ended_at IS NULL').run(
        ts,
        e.type,
        e.user_id,
        pid,
      );
      bumpAffinity(ctx, e.user_id, pid, 0, e.type === 'unmatch' ? 1 : 3);
      break;
    case 'premium_convert':
      db.prepare('UPDATE users SET premium_at = COALESCE(premium_at, ?) WHERE id = ?').run(ts, e.user_id);
      break;
    default:
      break;
  }
}

/** Append a server-originated signal to the raw log (chat turns the server handled itself). */
export function appendEvent(ctx: Ctx, userId: string, type: string, personaId: string | null, props: Record<string, unknown>, ts = ctx.now()): void {
  const p = personaId ? ctx.personas.get(personaId) : undefined;
  ctx.db
    .prepare('INSERT INTO events (ts, user_id, type, persona_id, persona_ver, conv_id, props) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(ts, userId, type, personaId, p?.meta.version ?? null, personaId ? convId(userId, personaId) : null, JSON.stringify(props));
}

/** One conversation per (user, persona): the whole thread, across sessions. */
export function ensureConversation(ctx: Ctx, userId: string, personaId: string, ts: number): string {
  const id = convId(userId, personaId);
  const exists = ctx.db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id);
  if (!exists) {
    const p = ctx.personas.get(personaId);
    const a = assignArm(ctx, userId, personaId);
    ctx.db
      .prepare(
        'INSERT INTO conversations (id, user_id, persona_id, persona_ver, experiment_id, arm, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, userId, personaId, p?.meta.version ?? null, a?.experimentId ?? null, a?.arm ?? null, ts);
  }
  return id;
}

/**
 * Append one message and keep the conversation's counters and the message's
 * drop-pattern features current. Returns flags the chat route acts on.
 */
export function recordMessage(
  ctx: Ctx,
  userId: string,
  personaId: string,
  role: 'user' | 'persona',
  text: string,
  ts: number,
): { crisis: boolean; farewell: boolean; userTurns: number } {
  const { db, cfg } = ctx;
  const id = ensureConversation(ctx, userId, personaId, ts);
  const conv = db.prepare('SELECT user_turns, farewell_turn FROM conversations WHERE id = ?').get(id) as {
    user_turns: number;
    farewell_turn: number | null;
  };
  let crisis = false;
  let farewell = false;
  let features: string | null = null;
  let userTurns = conv.user_turns;

  if (role === 'user') {
    userTurns += 1;
    farewell = detect.farewell(text);
    crisis = detect.crisis(text);
    db.prepare(
      `UPDATE conversations SET user_turns = ?, last_user_at = ?, farewell_turn = CASE WHEN ? THEN ? ELSE farewell_turn END WHERE id = ?`,
    ).run(userTurns, ts, farewell ? 1 : 0, userTurns, id);
    if (crisis) db.prepare('INSERT INTO safety_events (ts, user_id, conv_id, kind) VALUES (?, ?, ?, ?)').run(ts, userId, id, 'crisis_detected');
    // Talking is the strongest taste signal: every message nudges the user toward this
    // persona's categories, and reaching a deep chat adds a bigger step.
    bumpAffinity(ctx, userId, personaId, userTurns === cfg.telemetry.deepChatTurns ? 2.15 : 0.15, 0);
  } else {
    const prev = db
      .prepare("SELECT text FROM messages WHERE conv_id = ? AND role = 'persona' ORDER BY id DESC LIMIT 20")
      .all(id) as { text: string }[];
    const lastUser = db
      .prepare("SELECT text FROM messages WHERE conv_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1")
      .get(id) as { text: string } | undefined;
    features = JSON.stringify(messageFeatures(text, prev.map((r) => r.text), lastUser?.text));
    db.prepare('UPDATE conversations SET persona_turns = persona_turns + 1, last_persona_at = ? WHERE id = ?').run(ts, id);
  }
  db.prepare('INSERT INTO messages (conv_id, ts, role, user_turn, text, features) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    ts,
    role,
    userTurns,
    text,
    features,
  );
  return { crisis, farewell, userTurns };
}

/**
 * Per-user category posteriors: likes and deep chats raise a category, passes and reports lower
 * it. Every tag of the persona gets the whole observation, not 1/#tags of it: split, a like moved
 * each of a persona's 6-8 tags by an eighth of a swipe and taste took dozens of swipes to show.
 */
export function bumpAffinity(ctx: Ctx, userId: string, personaId: string, da: number, db_: number): void {
  const p = ctx.personas.get(personaId);
  if (!p || !p.meta.categories.length) return;
  const tags = feedTags(p);
  const w = 1;
  const stmt = ctx.db.prepare(
    `INSERT INTO user_affinity (user_id, category, a, b) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, category) DO UPDATE SET a = a + excluded.a, b = b + excluded.b`,
  );
  for (const c of tags) stmt.run(userId, c, da * w, db_ * w);
}

/** Category co-like counts: every category of this like, paired with the categories the user liked before. */
function updateColike(ctx: Ctx, userId: string, personaId: string): void {
  const p = ctx.personas.get(personaId);
  if (!p) return;
  const prior = ctx.db
    .prepare("SELECT DISTINCT persona_id FROM impressions WHERE user_id = ? AND outcome = 'like' AND persona_id != ?")
    .all(userId, personaId) as { persona_id: string }[];
  const before = new Set<string>();
  for (const r of prior) {
    const q = ctx.personas.get(r.persona_id);
    if (q) for (const c of feedTags(q)) before.add(c);
  }
  const stmt = ctx.db.prepare(
    `INSERT INTO colike (cat_a, cat_b, n) VALUES (?, ?, 1) ON CONFLICT(cat_a, cat_b) DO UPDATE SET n = n + 1`,
  );
  for (const a of before) for (const b of feedTags(p)) {
    stmt.run(a, b);
    if (a !== b) stmt.run(b, a);
  }
}

export function eventProps(row: { props: string | null }): Record<string, unknown> {
  return json(row.props, {});
}
