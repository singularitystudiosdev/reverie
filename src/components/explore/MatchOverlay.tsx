// STUB: replaced by the explore unit
/*
  The match moment: reads state.pendingMatchId. Themes the frame to her and
  fires a burst, shows her portrait in the live ring, then "Say hi" (opens the
  chat) or "Keep exploring" (dismisses; Explore re-themes to the next card).
*/
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type JSX } from 'react';
import { Avatar } from '../Avatar';
import { dur, ease, instant, matchPopFrom, spring } from '../../lib/motion';
import { useApp, useCharacter } from '../../state/store';
import { useFrameTheme } from '../../theme/ThemeProvider';

export function MatchOverlay(): JSX.Element {
  const { state, actions } = useApp();
  const character = useCharacter(state.pendingMatchId);
  const { setTheme, burst } = useFrameTheme();
  const reduce = useReducedMotion();
  const sayHi = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!character) return;
    setTheme(character.theme, character.scene);
    burst();
    sayHi.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.dismissMatch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [character, setTheme, burst, actions]);

  return (
    <AnimatePresence>
      {character ? (
        <motion.div
          key={character.id}
          role="dialog"
          aria-modal="true"
          aria-labelledby="match-title"
          className="safe-x absolute inset-0 z-40 flex flex-col items-center justify-center bg-[var(--scrim)] text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.enter } }}
          exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
        >
          <div className="flex w-full flex-col items-center gap-16 rounded-20 border border-hairline surface-solid p-24 text-ink">
            <motion.div
              initial={{ scale: reduce ? 1 : matchPopFrom }}
              animate={{ scale: 1 }}
              transition={reduce ? instant : spring.playful}
            >
              <Avatar character={character} size="xl" ring eager />
            </motion.div>
            <h2 id="match-title" className="font-display text-name">
              You and {character.name} matched
            </h2>
            <p className="text-body text-muted">{character.tagline}</p>
            <div className="flex w-full flex-col gap-8">
              <button
                ref={sayHi}
                type="button"
                onClick={() => {
                  actions.openChat(character.id);
                  actions.dismissMatch();
                }}
                className="h-[var(--target-touch)] rounded-full bg-accent px-16 text-label text-on-accent"
              >
                Say hi
              </button>
              <button
                type="button"
                onClick={actions.dismissMatch}
                className="h-[var(--target-touch)] rounded-full px-16 text-label text-ink"
              >
                Keep exploring
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
