/*
  The match moment: reads state.pendingMatchId. A full-frame dialog in her
  world: the frame is themed to her, a veil of her canvas keeps type legible
  over the moving atmosphere, and the burst of her own particles plays behind.
  Her portrait pops in on the playful spring inside the live ring, then
  "<Name> likes you too" in Instrument Serif, her opener as a quoted line, and
  two buttons: "Say hi" (opens the chat) and "Keep exploring".

  Entrance 500ms. Reduced motion: a fade only, no pop, no rise, no burst.
  Escape dismisses; focus moves in, is held inside, and returns on close.
*/
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Avatar } from '../Avatar';
import { dur, ease, instant, matchPopFrom, spring } from '../../lib/motion';
import { useApp, useCharacter } from '../../state/store';
import { useFrameTheme } from '../../theme/ThemeProvider';
import './explore.css';

export function MatchOverlay(): JSX.Element {
  const { state, actions } = useApp();
  const character = useCharacter(state.pendingMatchId);
  const { setTheme, burst } = useFrameTheme();
  const reduce = useReducedMotion() ?? false;
  const sayHi = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const id = character?.id;

  // On open: her world, her burst, focus inside; on close: focus goes back.
  useEffect(() => {
    if (!character) return;
    const before = document.activeElement;
    setTheme(character.theme, character.scene);
    if (!reduce) burst();
    sayHi.current?.focus();
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

  // Two buttons: Tab and Shift+Tab wrap between them.
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const first = sayHi.current;
    const last = keep.current;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {character ? (
        <motion.div
          key={character.id}
          role="dialog"
          aria-modal="true"
          aria-labelledby="match-title"
          aria-describedby="match-opener"
          onKeyDown={trapTab}
          className="safe-x absolute inset-0 z-40 flex flex-col items-center justify-center gap-24 bg-canvas/(--match-veil) pt-[var(--statusbar-h)] pb-[var(--tabbar-h)] text-center text-ink land:gap-16"
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { duration: reduce ? dur.quick : dur.deliberate /* deliberate */, ease: ease.enter },
          }}
          exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
        >
          <motion.div
            className="flex w-full flex-col items-center gap-24 land:flex-row land:gap-16 land:text-left"
            initial={reduce ? false : { y: 'var(--match-rise)' }}
            animate={{ y: 0, transition: reduce ? instant : spring.gentle }}
          >
            <motion.div
              initial={reduce ? false : { scale: matchPopFrom }}
              animate={{ scale: 1, transition: reduce ? instant : spring.playful }}
            >
              <Avatar character={character} size="xl" ring eager />
            </motion.div>

            {/* Land: beside her portrait, left-aligned, so the moment fits the short height. */}
            <div className="flex flex-col items-center gap-24 land:min-w-0 land:flex-1 land:items-start land:gap-12">
              <h2 id="match-title" className="font-display text-name">
                {character.name} likes you too
              </h2>

              <blockquote
                id="match-opener"
                className="max-w-[var(--match-quote-max)] rounded-20 border border-hairline bg-surface px-16 py-12 text-body text-ink"
              >
                {`“${character.opener}”`}
              </blockquote>
            </div>
          </motion.div>

          <div className="flex w-full flex-col gap-8 land:flex-row land:*:flex-1">
            <button
              ref={sayHi}
              type="button"
              onClick={() => {
                actions.openChat(character.id);
                actions.dismissMatch();
              }}
              className="inline-flex h-[var(--target-touch)] items-center justify-center rounded-full bg-accent px-24 text-label text-on-accent transition-opacity duration-[var(--duration-150)] ease-standard active:opacity-80"
            >
              Say hi
            </button>
            <button
              ref={keep}
              type="button"
              onClick={actions.dismissMatch}
              className="inline-flex h-[var(--target-touch)] items-center justify-center rounded-full border border-hairline bg-surface-strong px-24 text-label text-ink transition-opacity duration-[var(--duration-150)] ease-standard active:opacity-80"
            >
              Keep exploring
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
