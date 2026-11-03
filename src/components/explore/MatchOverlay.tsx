/*
  The instant-match modal: reads state.pendingMatchId, which the store sets
  only when a right swipe is an instant match. A SMALL card centered in the
  frame over a light scrim, so her world (the frame is themed to her and her
  particles burst) stays visible around it: her animated portrait in the live
  ring, her name in Instrument Serif, "You Matched!", and one primary "Chat"
  button (opens the chat). Escape or a tap on the scrim dismisses and keeps
  exploring.

  Entrance: a scale from 0.92 to 1 on the snappy spring plus a fade. Reduced
  motion: a fade only, no scale, no burst.
  Dialog: role="dialog" aria-modal, named by her name and the heading; focus
  moves to "Chat" (the only control, so Tab stays on it) and returns on close.
*/
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Avatar } from '../Avatar';
import { dur, ease, instant, spring } from '../../lib/motion';
import { useApp, useCharacter } from '../../state/store';
import { useFrameTheme } from '../../theme/ThemeProvider';
import { deckConfig } from './deckConfig';
import './explore.css';

export function MatchOverlay(): JSX.Element {
  const { state, actions } = useApp();
  const character = useCharacter(state.pendingMatchId);
  const { setTheme, burst } = useFrameTheme();
  const reduce = useReducedMotion() ?? false;
  const chat = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const id = character?.id;

  // On open: her world, her burst, focus inside; on close: focus goes back.
  useEffect(() => {
    if (!character) return;
    const before = document.activeElement;
    setTheme(character.theme, character.scene);
    if (!reduce) burst();
    chat.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        actionsRef.current.dismissMatch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
    // Keyed on her id: a re-render must not re-burst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // One control: Tab and Shift+Tab stay on it.
  const holdFocus = (e: ReactKeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      chat.current?.focus();
    }
  };

  return (
    <AnimatePresence>
      {character ? (
        <motion.div
          key={character.id}
          className="safe-x absolute inset-0 z-40 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.enter } }}
          exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
        >
          <div
            aria-hidden="true"
            data-slot="match-scrim"
            onClick={actions.dismissMatch}
            className="absolute inset-0 bg-(color:--match-scrim)"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="match-name match-title"
            onKeyDown={holdFocus}
            className="surface-solid relative flex w-full max-w-[var(--match-card-w)] flex-col items-center gap-16 rounded-20 border border-hairline p-24 text-center text-ink shadow-16"
            initial={reduce ? false : { scale: deckConfig.matchModalFrom }}
            animate={{ scale: 1, transition: reduce ? instant : spring.snappy }}
          >
            <Avatar character={character} size="xl" ring eager />
            <div className="flex flex-col items-center gap-4">
              <p id="match-name" className="font-display text-name">
                {character.name}
              </p>
              <h2 id="match-title" className="text-heading text-muted">
                You Matched!
              </h2>
            </div>
            <button
              ref={chat}
              type="button"
              onClick={() => {
                actions.openChat(character.id);
                actions.dismissMatch();
              }}
              className="mt-8 inline-flex h-[var(--target-touch)] w-full items-center justify-center rounded-full bg-accent px-24 text-label text-on-accent transition-opacity duration-[var(--duration-150)] ease-standard active:opacity-80 motion-reduce:transition-none"
            >
              Chat
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
