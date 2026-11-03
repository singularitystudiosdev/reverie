/*
  The empty deck: one sentence and one action, fading up (reduced motion: a
  plain fade). "Start over" brings back the
  characters you passed. When nobody is left to
  bring back (you matched with everyone), the one action opens Chats instead.
*/
import { motion } from 'motion/react';
import type { JSX } from 'react';
import { dur, ease, useReducedMotion } from '../../lib/motion';
import { useApp } from '../../state/store';
import { deckConfig } from './deckConfig';

export function EmptyDeck(): JSX.Element {
  const { state, actions } = useApp();
  const reduce = useReducedMotion();
  const nothingToRestore = state.passedIds.length === 0;
  const copy = nothingToRestore
    ? { text: 'You have matched with everyone.', action: 'Open Chats', run: () => actions.setTab('chats') }
    : {
        text: 'You have met everyone for now.',
        action: 'Start over',
        run: () => {
          actions.resetDeck();
        },
      };

  return (
    <motion.div
      className="safe-x flex min-h-0 flex-1 flex-col items-center justify-center gap-24 text-center"
      initial={{ opacity: 0, y: reduce ? 0 : deckConfig.emptyRiseY }}
      animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.enter } }}
    >
      <p className="font-display text-title text-ink">{copy.text}</p>
      <button
        type="button"
        onClick={copy.run}
        className="inline-flex h-[var(--target-touch)] items-center rounded-full bg-accent px-24 text-label text-on-accent transition-opacity duration-[var(--duration-150)] ease-standard active:opacity-80"
      >
        {copy.action}
      </button>
    </motion.div>
  );
}
