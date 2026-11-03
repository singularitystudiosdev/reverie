// STUB: replaced by the chats unit
/*
  Bottom sheet with her portrait, kind, style, bio and interests. Reads
  state.profileId. Closes on the scrim, the close button or Escape; focus
  moves in on open and returns to the trigger on close. No theme change: it
  opens over a screen already themed to her.
*/
import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type JSX } from 'react';
import { Avatar } from './Avatar';
import { dur, ease, instant } from '../lib/motion';
import { useApp, useCharacter } from '../state/store';

export function ProfileSheet(): JSX.Element {
  const { state, actions } = useApp();
  const character = useCharacter(state.profileId);
  const reduce = useReducedMotion();
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = Boolean(character);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.openProfile(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener.current?.focus?.();
    };
  }, [open, actions]);

  return (
    <AnimatePresence>
      {character ? (
        <motion.div
          key="profile"
          className="absolute inset-0 z-30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.enter } }}
          exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
        >
          <div aria-hidden="true" className="absolute inset-0 bg-[var(--scrim)]" onClick={() => actions.openProfile(null)} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-name"
            className="absolute inset-x-0 bottom-0 flex max-h-[var(--sheet-max-h)] flex-col gap-16 overflow-y-auto rounded-t-20 border-t border-hairline surface-solid px-24 pt-24 pb-[calc(var(--spacing-24)+var(--safe-bottom))] text-ink"
            initial={{ y: reduce ? 0 : '100%' }}
            animate={{ y: 0, transition: reduce ? instant : { duration: dur.base, ease: ease.enter } }}
            exit={{ y: reduce ? 0 : '100%', transition: reduce ? instant : { duration: dur.quick, ease: ease.exit } }}
          >
            <div className="flex items-start gap-16">
              <Avatar character={character} size="lg" eager />
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <h2 id="profile-name" className="font-display text-title">
                  {character.name}
                </h2>
                <p className="text-label font-normal text-muted">{character.kind}</p>
                <p className="text-caption text-muted">{character.style}</p>
              </div>
              <button
                ref={closeButton}
                type="button"
                aria-label="Close profile"
                onClick={() => actions.openProfile(null)}
                className="grid size-[var(--target-touch)] shrink-0 place-items-center rounded-full border border-hairline bg-surface text-ink"
              >
                <X aria-hidden="true" className="size-20" />
              </button>
            </div>
            <p className="max-w-[var(--measure)] text-body">{character.bio}</p>
            <ul className="flex flex-wrap gap-8" aria-label="Interests">
              {character.interests.map((interest) => (
                <li key={interest} className="rounded-12 border border-hairline px-12 py-6 text-label">
                  {interest}
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
