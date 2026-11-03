/*
  The Chats list's one bold element: a horizontal row of her avatars, each
  ringed by the live, slowly turning ring in HER theme accent, her name under
  it. Tap opens the chat. Shows everyone matched in the last week; when nobody
  is that new it becomes "Your matches" so the row never lies about its
  label. The ring's turn is motion-safe inside Avatar.
*/
import type { JSX } from 'react';
import { Avatar } from '../Avatar';
import type { ChatEntry } from './chatData';
import { stateLayer } from './stateLayer';

export function NewMatches(props: {
  fresh: ChatEntry[];
  all: ChatEntry[];
  onOpen(id: string): void;
}): JSX.Element | null {
  const { fresh, all, onOpen } = props;
  const entries = fresh.length ? fresh : all;
  if (!entries.length) return null;
  const title = fresh.length ? 'New matches' : 'Your matches';

  return (
    <section aria-labelledby="new-matches-title" data-slot="new-matches" className="flex flex-col gap-4">
      <h2 id="new-matches-title" className="safe-x text-label text-muted">
        {title}
      </h2>
      <ul className="safe-x flex snap-x gap-8 overflow-x-auto py-8 [scrollbar-width:none]">
        {entries.map(({ character, convo }) => (
          <li key={character.id} className="shrink-0 snap-start">
            <button
              type="button"
              data-slot="new-match"
              onClick={() => onOpen(character.id)}
              className={`${stateLayer} relative flex min-h-[var(--target)] flex-col items-center gap-8 rounded-20 p-8 text-ink`}
            >
              <Avatar character={character} size="lg" ring />
              <span className="max-w-[var(--avatar-lg)] truncate text-label">{character.name}</span>
              {convo.unread > 0 ? <span className="sr-only">, {convo.unread} unread</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Placeholder with the row's anatomy: ringed circles with a name under each. */
export function NewMatchesSkeleton(props: { count: number }): JSX.Element | null {
  if (props.count <= 0) return null;
  return (
    <div aria-hidden="true" data-slot="new-matches-skeleton" className="flex flex-col gap-4">
      <span className="safe-x">
        <span className="block h-12 w-1/4 rounded-full bg-hairline motion-safe:animate-pulse" />
      </span>
      <span className="safe-x flex gap-8 overflow-hidden py-8">
        {Array.from({ length: props.count }, (_, i) => (
          <span key={i} className="flex shrink-0 flex-col items-center gap-8 p-8">
            <span className="size-[var(--avatar-lg)] rounded-full bg-hairline motion-safe:animate-pulse" />
            <span className="h-12 w-3/4 rounded-full bg-hairline motion-safe:animate-pulse" />
          </span>
        ))}
      </span>
    </div>
  );
}
