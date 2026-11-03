// STUB: replaced by the explore unit
/*
  The top card of the deck with pass (X) and like (check). Tap the card for
  her profile. Focus theme: the top card's theme + scene; 'base' when the deck
  is empty. While a match moment shows, the overlay owns the theme.
*/
import { Check, X } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';
import { artSize } from '../data/characters';
import type { Character } from '../data/types';
import { cn } from '../lib/cn';
import { pulseStrength } from '../lib/motion';
import { useApp, useDeck } from '../state/store';
import { useFrameTheme } from '../theme/ThemeProvider';

export function Explore(): JSX.Element {
  const { state, actions } = useApp();
  const deck = useDeck();
  const top = deck[0];
  const next = deck[1];
  const { setTheme, setPreview, pulse } = useFrameTheme();

  useEffect(() => {
    if (state.pendingMatchId) return;
    if (top) setTheme(top.theme, top.scene);
    else setTheme('base');
  }, [top, state.pendingMatchId, setTheme]);

  // RTPC: as soon as a second card exists, arm (and pre-decode) her world.
  useEffect(() => {
    if (next) setPreview(next.theme, next.scene, 0);
    else setPreview(null);
  }, [next, setPreview]);

  // Leaving Explore disarms the preview.
  useEffect(() => () => setPreview(null), [setPreview]);

  // A card committed off the deck: gust first, then the store moves on and
  // the theme effect above promotes the next world.
  const commit = (decide: (id: string) => void, id: string) => {
    pulse('gust', pulseStrength.cardCommit);
    decide(id);
  };

  return (
    <section aria-labelledby="explore-title" className="flex h-full flex-col pt-[var(--statusbar-h)] pb-[var(--tabbar-h)]">
      <header className="safe-x pt-16 pb-12">
        <h1 id="explore-title" className="font-display text-title">
          Explore
        </h1>
      </header>

      {top ? (
        <>
          <div className="safe-x min-h-0 flex-1">
            <TopCard key={top.id} character={top} onOpen={() => actions.openProfile(top.id)} />
          </div>
          <div className="flex items-center justify-center gap-24 pt-16">
            <button
              type="button"
              aria-label={`Pass on ${top.name}`}
              onClick={() => commit(actions.pass, top.id)}
              className="grid size-[var(--deck-button)] place-items-center rounded-full border border-hairline bg-surface-strong text-ink"
            >
              <X aria-hidden="true" className="size-24" />
            </button>
            <button
              type="button"
              aria-label={`Like ${top.name}`}
              onClick={() => commit(actions.like, top.id)}
              className="grid size-[var(--deck-button)] place-items-center rounded-full bg-accent text-on-accent"
            >
              <Check aria-hidden="true" className="size-24" />
            </button>
          </div>
        </>
      ) : (
        <EmptyDeck />
      )}
    </section>
  );
}

function TopCard(props: { character: Character; onOpen: () => void }): JSX.Element {
  const { character, onOpen } = props;
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${character.name}, view profile`}
      className="relative block size-full overflow-hidden rounded-20 border border-hairline bg-surface text-left"
    >
      <img
        src={character.portrait}
        alt=""
        width={artSize.full.width}
        height={artSize.full.height}
        decoding="async"
        loading="eager"
        fetchPriority="high"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={cn(
          'absolute inset-0 size-full object-cover transition-opacity duration-[var(--duration-150)] ease-standard',
          loaded ? 'opacity-100' : 'opacity-0'
        )}
      />
      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-4 bg-surface-strong px-16 py-12">
        <span className="font-display text-title text-ink">{character.name}</span>
        <span className="text-label font-normal text-muted">{character.tagline}</span>
      </span>
    </button>
  );
}

function EmptyDeck(): JSX.Element {
  const { state, actions } = useApp();
  const empty =
    state.filter !== 'All'
      ? { text: `No ${state.filter} characters left in your deck.`, action: 'Show everyone', run: () => actions.setFilter('All') }
      : state.passedIds.length > 0
        ? { text: "You've seen everyone for now. Bring back the ones you passed.", action: 'See them again', run: actions.resetDeck }
        : { text: "You've matched with everyone. Your chats are waiting.", action: 'Open Chats', run: () => actions.setTab('chats') };
  return (
    <div className="safe-x flex flex-1 flex-col items-center justify-center gap-16 text-center">
      <p className="text-body text-muted">{empty.text}</p>
      <button
        type="button"
        onClick={empty.run}
        className="min-h-[var(--target)] rounded-full bg-accent px-16 text-label text-on-accent"
      >
        {empty.action}
      </button>
    </div>
  );
}
