/*
  Shared read-side helpers for the chat surfaces (Chats list, chat view,
  chats drawer): which conversations to show, how a last message previews,
  who counts as a new match, a minute clock for relative timestamps, and an
  image-readiness gate for the first-paint skeletons.
*/
import { useEffect, useState } from 'react';
import { getCharacter } from '../../data/characters';
import type { Character, Conversation, Message } from '../../data/types';
import { time } from '../../lib/time';

export interface ChatEntry {
  character: Character;
  convo: Conversation;
  last: Message | undefined;
}

/** Matched characters with a conversation, in store order (most recent activity first). */
export function chatEntries(
  matchIds: string[],
  conversations: Record<string, Conversation>
): ChatEntry[] {
  return matchIds.flatMap((id) => {
    const character = getCharacter(id);
    const convo = conversations[id];
    return character && convo ? [{ character, convo, last: convo.messages.at(-1) }] : [];
  });
}

/** One-line preview of the last message: her words, "You: ..." for mine. */
export function previewText(last: Message | undefined, name: string): string {
  if (!last) return `Say hi to ${name}`;
  const body = last.kind === 'cards' ? cardsPreview(last) : (last.text ?? '');
  return last.from === 'me' ? `You: ${body}` : body;
}

function cardsPreview(m: Message): string {
  const cards = m.cards ?? [];
  const [first, ...rest] = cards;
  if (!first) return 'Shared a few ideas';
  return rest.length ? `${first.title} and ${rest.length} more` : first.title;
}

/**
 * New matches: everyone matched within the last week (her first message, the
 * opener, marks the match), newest first.
 */
export function newMatches(entries: ChatEntry[], now: number): ChatEntry[] {
  const matchedAt = (e: ChatEntry) => e.convo.messages[0]?.at ?? now;
  return entries
    .filter((e) => now - matchedAt(e) < time.WEEK)
    .sort((a, b) => matchedAt(b) - matchedAt(a));
}

/** Wall clock that ticks once a minute, for relative timestamps. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), time.MINUTE);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/* Sources already decoded this session: a remount never shows skeletons again. */
const decoded = new Set<string>();

function decode(src: string): Promise<void> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  return img.decode().then(() => {
    decoded.add(src);
  });
}

/**
 * True once every source has decoded (or failed: a missing image falls back
 * to the Avatar's own surface placeholder, never an endless skeleton).
 */
export function useImagesReady(srcs: string[]): boolean {
  const key = srcs.join('|');
  const [readyKey, setReadyKey] = useState<string | null>(() =>
    srcs.every((s) => decoded.has(s)) ? key : null
  );

  useEffect(() => {
    if (readyKey === key) return;
    let alive = true;
    const list = key ? key.split('|') : [];
    void Promise.allSettled(list.map(decode)).then(() => {
      if (alive) setReadyKey(key);
    });
    return () => {
      alive = false;
    };
  }, [key, readyKey]);

  // Once ready, later additions (a new match) never bring the skeleton back:
  // the Avatar keeps its own placeholder for a single late image.
  return readyKey !== null;
}
