// STUB: replaced by the chats unit
/*
  Plain list of matched conversations, most recent first. Tap a row to open
  the chat. Focus theme: 'base'. Empty state: one sentence, one action.
*/
import { useEffect, type JSX } from 'react';
import { Avatar } from '../components/Avatar';
import { getCharacter } from '../data/characters';
import type { Message } from '../data/types';
import { relativeTime } from '../lib/time';
import { useApp } from '../state/store';
import { useFrameTheme } from '../theme/ThemeProvider';

function preview(last: Message | undefined, name: string): string {
  if (!last) return `Say hi to ${name}`;
  const body = last.kind === 'cards' ? `Shared ${last.cards?.length ?? 0} ideas` : (last.text ?? '');
  return last.from === 'me' ? `You: ${body}` : body;
}

export function ChatList(): JSX.Element {
  const { state, actions } = useApp();
  const { setTheme } = useFrameTheme();

  useEffect(() => {
    setTheme('base');
  }, [setTheme]);

  const now = Date.now();
  const rows = state.matchIds.flatMap((id) => {
    const character = getCharacter(id);
    const convo = state.conversations[id];
    return character && convo ? [{ character, convo }] : [];
  });

  return (
    <section aria-labelledby="chats-title" className="flex h-full flex-col pt-[var(--statusbar-h)]">
      <header className="safe-x pt-16 pb-12">
        <h1 id="chats-title" className="font-display text-title">
          Chats
        </h1>
      </header>

      {rows.length === 0 ? (
        <div className="safe-x flex flex-1 flex-col items-center justify-center gap-16 pb-[var(--tabbar-h)] text-center">
          <p className="text-body text-muted">Your matches and their messages will show up here.</p>
          <button
            type="button"
            onClick={() => actions.setTab('explore')}
            className="min-h-[var(--target)] rounded-full bg-accent px-16 text-label text-on-accent"
          >
            Open Explore
          </button>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto pb-[var(--tabbar-h)]">
          {rows.map(({ character, convo }) => {
            const last = convo.messages.at(-1);
            return (
              <li key={character.id} className="px-8">
                <button
                  type="button"
                  onClick={() => actions.openChat(character.id)}
                  className="flex w-full items-center gap-12 rounded-20 px-8 py-12 text-left active:bg-surface"
                >
                  <Avatar character={character} size="md" layoutId={`avatar-${character.id}`} />
                  <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="flex items-baseline justify-between gap-8">
                      <span className="truncate text-heading">{character.name}</span>
                      {last ? (
                        <time dateTime={new Date(last.at).toISOString()} className="shrink-0 text-caption text-muted tabular-nums">
                          {relativeTime(last.at, now)}
                        </time>
                      ) : null}
                    </span>
                    <span className="flex items-center justify-between gap-8">
                      <span className="truncate text-label font-normal text-muted">
                        {state.typing[character.id] ? 'Typing' : preview(last, character.name)}
                      </span>
                      {convo.unread > 0 ? (
                        <span className="inline-flex h-[var(--badge-size)] min-w-[var(--badge-size)] shrink-0 items-center justify-center rounded-full bg-accent px-6 text-caption text-on-accent tabular-nums">
                          {convo.unread}
                          <span className="sr-only"> unread</span>
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
