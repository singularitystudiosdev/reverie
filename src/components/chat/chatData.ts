/*
  Shared read-side helpers for the chat surfaces (chat view, chats drawer):
  which conversations to show, how a last message previews, and a minute
  clock for relative timestamps.
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

/** Wall clock that ticks once a minute, for relative timestamps. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), time.MINUTE);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
