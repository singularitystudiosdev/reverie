/*
  Profile sheet: a bottom sheet over a scrim (reads state.profileId; App
  renders it above the tab bar). Opened from her avatar or name in the chat
  header, or a tap on a swipe card; no theme change, it opens over a frame
  already themed to her.
  - Content (v4, slimmed): her animated portrait (Portrait) as the header
    image with her name (--text-name) over a bottom scrim, then her bio with
    AnimatedBio. No interest chips, no Message button, no close button, no
    kind or style lines.
  - Mechanics (useSwipeDismiss): a swipe DOWN that starts anywhere in the
    window (the sheet, the scrim, or outside the frame) drags the sheet and
    tracks the finger 1:1; the scrim lightens as she is pulled down. It closes
    only when pulled most of the way or to the bottom edge of the window,
    otherwise it springs back; a quick flick alone does not close it. Escape
    and a tap on the scrim (one that did not drag) dismiss. Focus moves into the sheet on open, Tab stays inside, and
    focus returns to the trigger as it closes.
  - Motion: in on the base band (enter easing), out on the quick band. The hero
    eases in with a slight scale, then the bio fades up after it. Reduced
    motion: fades only, no scale or rise; a drag still follows the finger.
  - v6 rendered FX (components/fx): when her clips exist (public/fx/<id>), the
    intro plays once over the whole frame then her ambient loop takes over
    (Discord's two layers), with her frame decoration beneath them. They are
    drawn on the frame's single overlay canvas, so they sit above the sheet and
    the scrim without owning a canvas or a WebGL context here. Avatar rings are
    hidden while the sheet is open. Without clips nothing renders and AnimatedBio
    keeps its v5 CSS cinematic.
*/
import {
  AnimatePresence,
  motion,
  useIsPresent,
} from 'motion/react';
import { useEffect, useId, useRef, type JSX } from 'react';
import { trapTab } from './chat/focus';
import { AnimatedBio } from './chat/AnimatedBio';
import type { Character } from '../data/types';
import { dur, durMs, ease, useReducedMotion } from '../lib/motion';
import { useSwipeDismiss } from '../lib/useSwipeDismiss';
import { useApp, useCharacter } from '../state/store';
import { Portrait } from './Portrait';
import { FxSurface } from './fx/FxSurface';
import { suspendBase } from './fx/renderer';
import { useCharacterFx } from './fx/useCharacterFx';
import type { FxLayer } from './fx/types';

export function ProfileSheet(): JSX.Element {
  const { state } = useApp();
  const character = useCharacter(state.profileId);

  return <AnimatePresence>{character ? <Sheet key={character.id} character={character} /> : null}</AnimatePresence>;
}

function Sheet(props: { character: Character }): JSX.Element {
  const { character } = props;
  const { actions } = useApp();
  const reduce = useReducedMotion();
  const isPresent = useIsPresent();
  const dialog = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const nameId = useId();

  // Rendered FX: intro then loop on one surface, her frame art on another.
  const fx = useCharacterFx(character.id);
  const sequence = [fx.has.intro ? fx.fx?.intro : undefined, fx.has.loop ? fx.fx?.loop : undefined].filter(
    (l): l is FxLayer => l !== undefined
  );
  const frameLayer = fx.has.frame ? fx.fx?.frame : undefined;

  // The avatar rings in the header sit under this sheet, not over it.
  useEffect(() => suspendBase(), []);

  const close = () => actions.openProfile(null);

  // Focus moves in on open (the dialog itself, so its name is read first).
  useEffect(() => {
    // Capture the trigger once (a Strict Mode re-run would see the dialog).
    if (!returnTo.current && document.activeElement instanceof HTMLElement) {
      returnTo.current = document.activeElement;
    }
    dialog.current?.focus({ preventScroll: true });
  }, []);

  // ...and back to the trigger as soon as it starts closing.
  useEffect(() => {
    if (!isPresent) returnTo.current?.focus({ preventScroll: true });
  }, [isPresent]);

  useEffect(() => {
    if (!isPresent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.openProfile(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isPresent, actions]);

  // A swipe down from anywhere drags the sheet; `dragged` keeps a swipe that
  // ends over the scrim from also counting as a tap that closes.
  const swipe = useSwipeDismiss({ direction: 'down', panel: dialog, onDismiss: close });

  return (
    <motion.div key="profile" data-slot="profile-layer" className="absolute inset-0 z-30">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.enter } }}
        exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
      >
        <motion.div
          data-slot="sheet-scrim"
          className="absolute inset-0 touch-none bg-[var(--scrim)]"
          style={{ opacity: swipe.scrimOpacity }}
          onClick={() => {
            if (!swipe.dragged.current) close();
          }}
        />
      </motion.div>

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end">
        <motion.div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby={nameId}
          tabIndex={-1}
          onKeyDown={trapTab}
          data-slot="profile-sheet"
          className="pointer-events-auto flex max-h-[var(--sheet-max-h)] w-full touch-none flex-col overflow-y-auto overscroll-contain rounded-t-20 border-t border-hairline surface-solid text-ink select-none"
          style={{ y: swipe.offset }}
          initial={reduce ? { opacity: 0 } : { y: '100%' }}
          animate={
            reduce
              ? { opacity: 1, transition: { duration: dur.quick } }
              : { y: 0, transition: { duration: dur.base, ease: ease.enter } }
          }
          exit={
            reduce
              ? { opacity: 0, transition: { duration: dur.quick } }
              : { y: '100%', transition: { duration: dur.quick, ease: ease.exit } }
          }
        >
          <div
            data-slot="profile-hero"
            className="relative aspect-square min-h-[var(--avatar-xl)] w-full shrink touch-none overflow-hidden bg-surface select-none"
          >
            <motion.div
              className="size-full origin-center"
              initial={reduce ? false : { scale: 1.06, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1, transition: { duration: dur.slow, ease: ease.enter } }}
            >
              <Portrait
                character={character}
                priority
                className="size-full"
                style={{ objectPosition: character.avatarPosition }}
              />
            </motion.div>
            <span
              aria-hidden="true"
              className="absolute top-8 left-1/2 h-4 w-32 -translate-x-1/2 rounded-full bg-neutral-0 shadow-2"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-[var(--scrim)] via-[var(--scrim)] to-transparent px-24 pt-48 pb-16 text-neutral-0">
              <h2 id={nameId} className="font-display text-name">
                {character.name}
              </h2>
            </div>
          </div>

          <motion.div
            className="flex flex-col px-24 pt-16 pb-[calc(var(--spacing-24)+var(--safe-bottom))]"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { duration: dur.base, ease: ease.enter, delay: dur.quick },
            }}
          >
            <AnimatedBio text={character.bio} style={character.style} />
          </motion.div>
        </motion.div>
      </div>

      {frameLayer ? <FxSurface layers={[frameLayer]} fadeOutMs={durMs.quick} /> : null}
      {sequence.length > 0 ? <FxSurface layers={sequence} fadeOutMs={durMs.quick} /> : null}
    </motion.div>
  );
}
