/*
  Profile sheet: a bottom sheet over a scrim (reads state.profileId; App
  renders it above the tab bar). Opened from the chat header's Profile pill
  or a tap on a swipe card; no theme change, it opens over a frame already
  themed to her.
  - Content: her portrait as the tall header image with her name (--text-name)
    over a bottom scrim; kind, style, bio, the 3 interest chips; a primary
    "Message" when matched (opens the chat), else "Close".
  - Mechanics after design-web sheet.tsx: the header image is the drag handle
    and tracks the finger directly (no easing while dragging); on release the
    position is projected along the velocity and the nearer rest wins (open
    or dismissed); the scrim lightens as she is pulled down. Escape, the scrim
    and the close button dismiss. Focus moves into the sheet on open, Tab
    stays inside, and focus returns to the trigger as it closes.
  - Motion: in on the base band (enter easing), out on the quick band. Reduced
    motion: fades only; a drag still follows the finger.
*/
import { X } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useDragControls,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from 'motion/react';
import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { clsx } from 'clsx';
import { trapTab } from './chat/focus';
import { stateLayer } from './chat/stateLayer';
import { artSize } from '../data/characters';
import type { Character } from '../data/types';
import { dur, ease, spring } from '../lib/motion';
import { useApp, useCharacter } from '../state/store';

export function ProfileSheet(): JSX.Element {
  const { state } = useApp();
  const character = useCharacter(state.profileId);
  const matched = character ? state.matchIds.includes(character.id) : false;

  return (
    <AnimatePresence>
      {character ? <Sheet key={character.id} character={character} matched={matched} /> : null}
    </AnimatePresence>
  );
}

function Sheet(props: { character: Character; matched: boolean }): JSX.Element {
  const { character, matched } = props;
  const { actions } = useApp();
  const reduce = useReducedMotion() ?? false;
  const isPresent = useIsPresent();
  const dialog = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const controls = useDragControls();
  const nameId = useId();
  const [loaded, setLoaded] = useState(false);

  const close = () => actions.openProfile(null);

  // The drag offset (px). The scrim lightens as the sheet is pulled down.
  const y = useMotionValue(0);
  const scrimOpacity = useTransform(y, (v: number | string) => {
    const h = dialog.current?.offsetHeight;
    return typeof v === 'number' && h ? Math.max(0, 1 - v / h) : 1;
  });

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

  // Release: project along the velocity, settle on the nearer rest.
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const h = dialog.current?.offsetHeight ?? 0;
    const projected = info.offset.y + info.velocity.y * dur.base;
    if (Math.abs(h - projected) < Math.abs(projected)) close();
  };

  const message = () => {
    close();
    actions.openChat(character.id);
  };

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
          className="absolute inset-0 bg-[var(--scrim)]"
          style={{ opacity: scrimOpacity }}
          onClick={close}
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
          className="pointer-events-auto flex max-h-[var(--sheet-max-h)] w-full flex-col overflow-y-auto overscroll-contain rounded-t-20 land:mx-auto land:max-w-[var(--sheet-max-w)] border-t border-hairline surface-solid text-ink"
          style={{ y }}
          drag="y"
          dragListener={false}
          dragControls={controls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 1 }}
          dragMomentum={false}
          dragTransition={{ bounceStiffness: spring.snappy.stiffness, bounceDamping: spring.snappy.damping }}
          onDragEnd={onDragEnd}
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
          {/* The header image is the drag handle. */}
          <div
            data-slot="profile-hero"
            onPointerDown={(e) => controls.start(e)}
            className="relative aspect-square min-h-[var(--avatar-xl)] w-full shrink touch-none overflow-hidden bg-surface select-none"
          >
            <img
              src={character.portrait}
              alt=""
              width={artSize.full.width}
              height={artSize.full.height}
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              className={clsx(
                'size-full object-cover transition-opacity duration-[var(--duration-150)] ease-standard',
                loaded ? 'opacity-100' : 'opacity-0'
              )}
              style={{ objectPosition: character.avatarPosition }}
            />
            <span
              aria-hidden="true"
              className="absolute top-8 left-1/2 h-4 w-32 -translate-x-1/2 rounded-full bg-neutral-0 shadow-2"
            />
            <button
              type="button"
              aria-label="Close profile"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={close}
              className={clsx(
                stateLayer,
                'absolute top-16 right-16 z-1 grid size-[var(--target-touch)] place-items-center rounded-full border border-hairline bg-surface-strong text-ink'
              )}
            >
              <X aria-hidden="true" className="size-20" />
            </button>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-[var(--scrim)] via-[var(--scrim)] to-transparent px-24 pt-48 pb-16 text-neutral-0">
              <h2 id={nameId} className="font-display text-name">
                {character.name}
              </h2>
            </div>
          </div>

          <div className="flex min-h-0 shrink-0 flex-col gap-16 overflow-y-auto px-24 pt-16 pb-[calc(var(--spacing-24)+var(--safe-bottom))]">
            <div className="flex flex-col">
              <p className="text-heading">{character.kind}</p>
              <p className="text-label font-normal text-muted">{character.style} style</p>
            </div>
            <p className="max-w-[var(--measure)] text-body">{character.bio}</p>
            <ul aria-label="Interests" className="flex flex-wrap gap-8">
              {character.interests.map((interest) => (
                <li key={interest} className="rounded-12 border border-hairline px-12 py-4 text-label">
                  {interest}
                </li>
              ))}
            </ul>
            {matched ? (
              <button
                type="button"
                onClick={message}
                className="min-h-[var(--target-touch)] w-full rounded-full bg-accent px-24 text-label text-on-accent"
              >
                Message
              </button>
            ) : (
              <button
                type="button"
                onClick={close}
                className={clsx(
                  stateLayer,
                  'relative min-h-[var(--target-touch)] w-full rounded-full border border-hairline bg-surface px-24 text-label text-ink'
                )}
              >
                Close
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
