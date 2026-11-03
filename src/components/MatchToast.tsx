/*
  "<Name> matched with you": the small toast a delayed match raises when the
  user is out on the deck (never over a chat, the profile sheet or the match
  modal). It sits above
  the floating tab bar and clears the deck's X/check row, so the two deck
  actions stay tappable while it shows. One at a time (the store keeps the
  queue), opens her chat on tap, and dismisses itself after 5s. Escape dismisses
  it too. Entrance: rise + fade (base band); reduced motion: fade only.
*/
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, type JSX } from 'react';
import { dur, ease, matchToastMs } from '../lib/motion';
import { useApp, useCharacter } from '../state/store';
import { Avatar } from './Avatar';

export function MatchToast(): JSX.Element {
  const { state, actions } = useApp();
  const id = state.matchToasts[0] ?? null;
  const character = useCharacter(id);
  const reduce = useReducedMotion() ?? false;

  // Auto-dismiss: 5s per toast, and the next one in the queue takes its place.
  useEffect(() => {
    if (!id) return;
    const timer = window.setTimeout(() => actions.dismissToast(id), matchToastMs);
    return () => window.clearTimeout(timer);
  }, [id, actions]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.dismissToast(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, actions]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="match-toast"
      className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--tabbar-h)+var(--deck-button)+var(--spacing-24))] z-30 flex justify-center px-[var(--gutter)]"
    >
      <AnimatePresence>
        {character && id ? (
          <motion.button
            key={id}
            type="button"
            onClick={() => {
              actions.openChat(id);
              actions.dismissToast(id);
            }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.enter } }}
            exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
            className="pointer-events-auto flex min-h-[var(--target-touch)] items-center gap-12 rounded-full border border-hairline bg-surface-strong py-6 pr-20 pl-6 text-left text-label text-ink shadow-16"
          >
            <Avatar character={character} size="sm" />
            <span>
              <span className="font-medium">{character.name}</span> matched with you
            </span>
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
