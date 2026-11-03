/* Unread count in the accent: the one status mark a chat row carries. */
import type { JSX } from 'react';

export function UnreadBadge(props: { count: number }): JSX.Element | null {
  if (props.count <= 0) return null;
  return (
    <span
      data-slot="unread-badge"
      className="inline-flex h-[var(--badge-size)] min-w-[var(--badge-size)] shrink-0 items-center justify-center rounded-full bg-accent px-4 text-caption text-on-accent tabular-nums"
    >
      {props.count}
      <span className="sr-only"> unread</span>
    </span>
  );
}
