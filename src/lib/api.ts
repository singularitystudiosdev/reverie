/**
 * The Reverie backend client: telemetry, the personalised feed, and LLM chat
 * replies. Everything is optional: with no VITE_REVERIE_API set (the GitHub
 * Pages build), every call is a no-op and the app keeps its local deck order
 * and scripted replies, unchanged.
 *
 * Identity: an anonymous id kept in localStorage under its own key, separate
 * from the app state the store wipes on every reload, so retention (did this
 * person come back tomorrow?) can be measured.
 */
import type { CardItem, Character, Message } from '../data/types';
import { makeId } from './id';

const RAW = (import.meta.env.VITE_REVERIE_API as string | undefined)?.trim();
export const API_URL = RAW ? RAW.replace(/\/+$/, '') : null;
export const apiEnabled = API_URL !== null;

const UID_KEY = 'reverie:uid';

function readUid(): string {
  try {
    const existing = window.localStorage.getItem(UID_KEY);
    if (existing) return existing;
    const id = makeId('u');
    window.localStorage.setItem(UID_KEY, id);
    return id;
  } catch {
    return makeId('u');
  }
}

export const userId: string = typeof window === 'undefined' ? 'ssr' : readUid();
export const sessionId: string = makeId('s');

/* ------------------------------------------------------------- telemetry */

export type EventType =
  | 'session_start'
  | 'session_end'
  | 'impression'
  | 'swipe'
  | 'profile_open'
  | 'match'
  | 'chat_open'
  | 'chat_close'
  | 'message'
  | 'deck_return'
  | 'deck_reset'
  | 'video_play'
  | 'premium_view'
  | 'premium_convert'
  | 'report'
  | 'block'
  | 'unmatch';

interface QueuedEvent {
  type: EventType;
  user_id: string;
  session_id: string;
  ts: number;
  persona_id?: string;
  props?: Record<string, unknown>;
}

const queue: QueuedEvent[] = [];
let flushTimer: number | null = null;

export function track(type: EventType, personaId?: string, props?: Record<string, unknown>): void {
  if (!apiEnabled) return;
  queue.push({ type, user_id: userId, session_id: sessionId, ts: Date.now(), persona_id: personaId, props });
  if (queue.length >= 20) flush();
  else if (flushTimer === null) flushTimer = window.setTimeout(flush, 3000);
}

export function flush(beacon = false): void {
  if (!apiEnabled || queue.length === 0) return;
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  const body = JSON.stringify({ events: queue.splice(0, queue.length) });
  const url = `${API_URL}/v1/events`;
  // sendBeacon survives page unload; its text/plain body is still JSON the server parses.
  if (beacon && navigator.sendBeacon?.(url, body)) return;
  void fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {
    /* telemetry is best effort */
  });
}

let sessionStarted = false;
let sessionStart = 0;

/** session_start now; session_end with the duration when the page hides. */
export function startSession(): void {
  if (!apiEnabled || sessionStarted || typeof window === 'undefined') return;
  sessionStarted = true;
  sessionStart = Date.now();
  track('session_start');
  const end = () => {
    track('session_end', undefined, { duration_ms: Date.now() - sessionStart });
    flush(true);
  };
  window.addEventListener('pagehide', end);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}

/* ------------------------------------------------------------- feed */

export interface ApiPersonaCard {
  id: string;
  name: string;
  kind: string;
  style: Character['style'];
  theme: Character['theme'];
  tagline: string;
  bio: string;
  opener: string;
  art: Partial<Record<'portrait' | 'portraitSm' | 'loop' | 'clip' | 'clipPoster' | 'scene' | 'sceneSm' | 'sceneLoop', string>>;
  slot?: string;
  position?: number;
}

export interface FeedResult {
  requestId: string;
  cards: ApiPersonaCard[];
}

async function getJson<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T | null> {
  if (!apiEnabled) return null;
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
  }
}

export async function fetchFeed(opts: { limit?: number; includePassed?: boolean; exclude?: string[] } = {}): Promise<FeedResult | null> {
  const q = new URLSearchParams({ user_id: userId, limit: String(opts.limit ?? 10) });
  if (opts.includePassed) q.set('include_passed', '1');
  if (opts.exclude?.length) q.set('exclude', opts.exclude.join(','));
  const r = await getJson<{ request_id: string; cards: ApiPersonaCard[] }>(`/v1/feed?${q}`);
  return r ? { requestId: r.request_id, cards: r.cards } : null;
}

/* ------------------------------------------------------------- chat */

/**
 * Her reply from the backend. `recorded` means the backend logged the user's
 * message (it always does when it answers at all); `messages` is empty when it
 * has no model configured, and the caller answers locally. Null: unreachable.
 */
export async function remoteReply(personaId: string, text: string): Promise<{ messages: Message[]; recorded: boolean } | null> {
  const r = await getJson<{ messages: string[]; source: string }>(
    '/v1/chat',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, persona_id: personaId, text }) },
    30_000,
  );
  if (!r) return null;
  const now = Date.now();
  return {
    recorded: true,
    messages: (r.messages ?? []).map((m, i): Message => ({ id: makeId('her'), from: 'her', kind: 'text', text: m, at: now + i })),
  };
}

/** The text of a message for telemetry (cards messages report their titles). */
export function messageText(m: Message): string {
  if (m.kind === 'text') return m.text ?? '';
  if (m.kind === 'cards') return (m.cards ?? []).map((c: CardItem) => c.title).join(', ');
  return '[video]';
}
