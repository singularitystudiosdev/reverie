/*
  The empty deck: one sentence and one action. "Start over" brings back the
  characters you passed and clears the style filter. When nobody is left to
  bring back (you matched with everyone), the one action opens Chats instead.
*/
import type { JSX } from 'react';
import { useApp } from '../../state/store';

export function EmptyDeck(): JSX.Element {
  const { state, actions } = useApp();
  const nothingToRestore = state.passedIds.length === 0 && state.filter === 'All';
  const copy = nothingToRestore
    ? { text: 'You have matched with everyone.', action: 'Open Chats', run: () => actions.setTab('chats') }
    : {
        text: 'You have met everyone for now.',
        action: 'Start over',
        run: () => {
          actions.setFilter('All');
          actions.resetDeck();
        },
      };

  return (
    <div className="safe-x flex min-h-0 flex-1 flex-col items-center justify-center gap-24 text-center">
      <p className="font-display text-title text-ink">{copy.text}</p>
      <button
        type="button"
        onClick={copy.run}
        className="inline-flex h-[var(--target-touch)] items-center rounded-full bg-accent px-24 text-label text-on-accent transition-opacity duration-[var(--duration-150)] ease-standard active:opacity-80"
      >
        {copy.action}
      </button>
    </div>
  );
}
