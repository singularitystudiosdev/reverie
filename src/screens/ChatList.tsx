/*
  Chats (tab 1). Focus theme: 'base' (the quiet mist; no character in focus).
  - Title "Chats" in Instrument Serif.
  - The bold element: the New matches row (live rings in each accent).
  - Conversation rows, most recent activity first. The row avatar carries
    layoutId `avatar-${id}`: opening a chat morphs it into the header.
  - First paint: skeleton rows with the row anatomy until the avatars decode.
  - The one entrance: the New matches row then the rows stagger in ONCE per
    session (40ms apart, at most 8), when the skeleton gives way. Returning from a chat never replays it, so
    the avatar morph back into its row stays the only motion. Reduced motion:
    no entrance at all.
  - Empty: one sentence, one action (Explore).
*/
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { chatEntries, newMatches, useImagesReady, useNow } from '../components/chat/chatData';
import { ConversationRow, ConversationRowSkeleton } from '../components/chat/ConversationRow';
import { NewMatches, NewMatchesSkeleton } from '../components/chat/NewMatches';
import { dur, ease, stagger } from '../lib/motion';
import { useApp } from '../state/store';
import { useFrameTheme } from '../theme/ThemeProvider';

/* The stagger plays once per session, on the first mount that shows rows. */
let rowsEntered = false;

/** How far a staggered row rises as it fades in (a spacing token). */
const rise = 'var(--spacing-8)';

/** The n-th element of the entrance: the New matches row is 0, rows follow. */
const staggerAt = (n: number): Transition => ({ duration: dur.base, ease: ease.enter, delay: n * stagger.step });

export function ChatList(): JSX.Element {
  const { state, actions } = useApp();
  const { setTheme } = useFrameTheme();
  const reduce = useReducedMotion() ?? false;
  const now = useNow();

  useEffect(() => {
    setTheme('base');
  }, [setTheme]);

  const entries = useMemo(
    () => chatEntries(state.matchIds, state.conversations),
    [state.matchIds, state.conversations]
  );
  const fresh = useMemo(() => newMatches(entries, now), [entries, now]);

  // Skeleton until the avatars above the fold have decoded.
  const firstPaint = useMemo(() => {
    const rowAvatars = entries.slice(0, stagger.maxRows).map((e) => e.character.portraitSm);
    const ringAvatars = (fresh.length ? fresh : entries).map((e) => e.character.portraitSm);
    return [...new Set([...ringAvatars, ...rowAvatars])];
  }, [entries, fresh]);
  const ready = useImagesReady(firstPaint);

  const [animateIn] = useState(() => !rowsEntered);
  useEffect(() => {
    if (ready) rowsEntered = true;
  }, [ready]);
  const enter = animateIn && !reduce;

  return (
    <section aria-labelledby="chats-title" className="flex h-full flex-col pt-[var(--statusbar-h)]">
      <header className="safe-x pt-16 pb-8">
        <h1 id="chats-title" className="font-display text-title">
          Chats
        </h1>
      </header>

      {entries.length === 0 ? (
        <div className="safe-x flex flex-1 flex-col items-center justify-center gap-16 pb-[var(--tabbar-h)] text-center">
          <p className="max-w-[var(--measure)] text-body text-balance text-muted">
            Your matches and their messages will show up here.
          </p>
          <button
            type="button"
            onClick={() => actions.setTab('explore')}
            className="min-h-[var(--target)] rounded-full bg-accent px-24 text-label text-on-accent"
          >
            Explore
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-[var(--tabbar-h)]">
          {/* Its own presence scope: the route's AnimatePresence (initial={false})
              would otherwise block the entrance of rows mounted after first paint. */}
          <AnimatePresence mode="wait">
            {ready ? (
              <div key="rows" className="flex flex-col gap-16">
                <motion.div
                  initial={enter ? { opacity: 0, y: rise } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={staggerAt(0)}
                >
                  <NewMatches fresh={fresh} all={entries} onOpen={actions.openChat} />
                </motion.div>
                <section aria-labelledby="messages-title" className="flex flex-col gap-4">
                  <h2 id="messages-title" className="safe-x text-label text-muted">
                    Messages
                  </h2>
                  <ul className="flex flex-col px-8">
                    {entries.map((entry, i) => (
                      <motion.li
                        key={entry.character.id}
                        initial={enter && i + 1 < stagger.maxRows ? { opacity: 0, y: rise } : false}
                        animate={{ opacity: 1, y: 0 }}
                        transition={staggerAt(i + 1)}
                      >
                        <ConversationRow
                          entry={entry}
                          now={now}
                          typing={Boolean(state.typing[entry.character.id])}
                          onOpen={actions.openChat}
                        />
                      </motion.li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : (
              <div key="skeleton" role="status" aria-label="Loading chats" className="flex flex-col gap-16">
                <NewMatchesSkeleton count={Math.min(fresh.length || entries.length, stagger.maxRows)} />
                <div className="flex flex-col gap-4">
                  <span className="safe-x" aria-hidden="true">
                    <span className="block h-12 w-1/5 rounded-full bg-hairline motion-safe:animate-pulse" />
                  </span>
                  <div className="px-8">
                    {entries.slice(0, stagger.maxRows).map((e) => (
                      <ConversationRowSkeleton key={e.character.id} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
