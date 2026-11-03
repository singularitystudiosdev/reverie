/*
  One Chats-list row (a list row, not a card): her avatar (the shared
  `avatar-${id}` element that morphs into the chat header), her name with her
  kind as a quiet caption, the last message (or the typing dots while she
  types), the timestamp and the unread badge. Press feedback is the state
  layer. ConversationRowSkeleton reproduces the same anatomy for first paint.
*/
import { clsx } from 'clsx';
import type { JSX } from 'react';
import { Avatar } from '../Avatar';
import { isoTime, relativeTime } from '../../lib/time';
import { previewText, type ChatEntry } from './chatData';
import { stateLayer } from './stateLayer';
import { TypingDots } from './TypingDots';
import { UnreadBadge } from './UnreadBadge';

export function ConversationRow(props: {
  entry: ChatEntry;
  now: number;
  typing: boolean;
  onOpen(id: string): void;
}): JSX.Element {
  const { entry, now, typing, onOpen } = props;
  const { character, convo, last } = entry;
  const unread = convo.unread > 0;

  return (
    <button
      type="button"
      data-slot="chat-row"
      onClick={() => onOpen(character.id)}
      className={clsx(
        stateLayer,
        'relative flex min-h-[var(--target)] w-full items-center gap-12 rounded-20 px-8 py-12 text-left text-ink'
      )}
    >
      <Avatar character={character} size="md" layoutId={`avatar-${character.id}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-baseline gap-8">
          <span className="shrink-0 text-heading">{character.name}</span>
          <span className="min-w-0 flex-1 truncate text-caption text-muted">{character.kind}</span>
          {last ? (
            <time dateTime={isoTime(last.at)} className="shrink-0 text-caption text-muted tabular-nums">
              {relativeTime(last.at, now)}
            </time>
          ) : null}
        </span>
        <span className="flex items-center gap-8">
          {typing ? (
            <span className="flex min-w-0 flex-1 items-center gap-8 text-label font-normal text-muted">
              <TypingDots size="sm" />
              <span>typing</span>
            </span>
          ) : (
            <span
              className={clsx(
                'min-w-0 flex-1 truncate text-label',
                unread ? 'text-ink' : 'font-normal text-muted'
              )}
            >
              {previewText(last, character.name)}
            </span>
          )}
          <UnreadBadge count={convo.unread} />
        </span>
      </span>
    </button>
  );
}

/** Placeholder with the row's anatomy: avatar, name + caption + time, preview. */
export function ConversationRowSkeleton(): JSX.Element {
  return (
    <div aria-hidden="true" data-slot="chat-row-skeleton" className="flex items-center gap-12 px-8 py-12">
      <span className="size-[var(--avatar-md)] shrink-0 rounded-full bg-hairline motion-safe:animate-pulse" />
      <span className="flex min-w-0 flex-1 flex-col gap-8">
        <span className="flex items-center gap-8">
          <span className="h-12 w-1/4 rounded-full bg-hairline motion-safe:animate-pulse" />
          <span className="h-8 w-1/3 rounded-full bg-hairline motion-safe:animate-pulse" />
          <span className="ml-auto h-8 w-1/12 rounded-full bg-hairline motion-safe:animate-pulse" />
        </span>
        <span className="h-12 w-3/4 rounded-full bg-hairline motion-safe:animate-pulse" />
      </span>
    </div>
  );
}
