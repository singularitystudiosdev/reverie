/*
  Chats drawer: the hamburger in the chat header slides the chat list in from
  the LEFT over a scrim, for quick switching (state.drawerOpen / setDrawer).
  - The only list of chats (there is no Chats screen): compact rows with
    avatar sm, name, preview, time, unread; the open chat is marked
    (aria-current + a fill of the ink colour at --drawer-current-mix, never the
    ink at full strength). Preview and time use --drawer-muted-mix so they hold
    4.5:1 on that fill in every world. A clip as the last message reads "Sent
    you a video". No heading and no close button: the dialog is labelled with
    aria-label and the first row sits at the top, under the status bar. With
    one chat the list says how to get more (one sentence, one Explore action).
  - Closes on a pick, a tap on the scrim, Escape, or a LEFT swipe that starts
    anywhere (panel, scrim, or outside the frame; useSwipeDismiss). The panel
    follows the finger 1:1 and the scrim lightens with it; it closes only when
    dragged most of the way or to the left edge of the window, otherwise it
    springs back open. A quick flick alone does not close it.
  - Rows rise in with a 30ms stagger (first 10) when the drawer opens, and
    the open chat's highlight is a shared layout element that slides between
    rows.
  - Rows carry 12px of padding inside the pressed/hover state layer (v4), so
    the highlight never hugs the name or preview.
  - Focus moves in (to the open chat's row) and returns to the hamburger on
    close; Tab stays inside while open. aria-expanded lives on the hamburger
    (ChatHeader).
  - Rendered into the frame's UI layer (the parent of <main>) through a
    portal, so it covers the screen and its floating controls and stays under
    the profile sheet (z-30). Opaque panel (surface-solid): no blur, per the
    blur budget.
  - Motion: the panel slides in on the base band with enter easing and leaves
    on the quick band; the scrim fades.
*/
import { clsx } from 'clsx';
import { Search } from 'lucide-react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '../Avatar';
import type { Message } from '../../data/types';
import { dur, ease, instant, lens, rowStagger, spring, useReducedMotion } from '../../lib/motion';
import { useSwipeDismiss } from '../../lib/useSwipeDismiss';
import { isoTime, relativeTime } from '../../lib/time';
import { useApp } from '../../state/store';
import { chatEntries, previewText, useNow } from './chatData';
import { trapTab } from './focus';
import { stateLayer } from './stateLayer';
import { TypingDots } from './TypingDots';
import { UnreadBadge } from './UnreadBadge';

export const chatsDrawerId = 'chats-drawer';

/** The row's last line: a clip has no text, so it says what was sent. */
function rowPreview(last: Message | undefined, name: string): string {
  if (last?.kind === 'video') return last.from === 'me' ? 'You: Sent a video' : 'Sent you a video';
  return previewText(last, name);
}

/* Set when a pick switches to another chat: the incoming chat view focuses
   its own hamburger, since the one that opened the drawer is leaving. */
let focusMenuOnMount = false;

/** Called once by ChatView on mount: true when a drawer pick brought it in. */
export function takeDrawerFocus(): boolean {
  const take = focusMenuOnMount;
  focusMenuOnMount = false;
  return take;
}

export function ChatsDrawer(props: {
  currentId: string;
  anchor: RefObject<HTMLElement | null>;
}): JSX.Element | null {
  const { currentId, anchor } = props;
  const { state, actions } = useApp();
  const reduce = useReducedMotion();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setHost(anchor.current?.closest('main')?.parentElement ?? null);
  }, [anchor]);

  // Only the chat on screen owns the drawer (a leaving chat view never does).
  const open = state.drawerOpen && state.openChatId === currentId;
  const close = () => actions.setDrawer(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, actions]);

  const pick = (id: string) => {
    if (id === currentId) {
      close();
      return;
    }
    focusMenuOnMount = true;
    actions.openChat(id);
  };

  const layer = (
    <AnimatePresence>
      {open ? (
        <motion.div key="drawer" data-slot="chats-drawer-layer" className="absolute inset-0 z-25">
          <DrawerPanel
            currentId={currentId}
            reduce={reduce}
            onClose={close}
            onPick={pick}
            matchIds={state.matchIds}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return host ? createPortal(layer, host) : layer;
}

function DrawerPanel(props: {
  currentId: string;
  reduce: boolean;
  matchIds: string[];
  onClose(): void;
  onPick(id: string): void;
}): JSX.Element {
  const { currentId, reduce, matchIds, onClose, onPick } = props;
  const { state, actions } = useApp();
  const now = useNow();
  const panel = useRef<HTMLDivElement>(null);
  const controls = useAnimationControls();
  const swipe = useSwipeDismiss({ direction: 'left', panel, onDismiss: onClose });
  const entries = useMemo(
    () => chatEntries(matchIds, state.conversations),
    [matchIds, state.conversations]
  );

  // Focus moves in: to the open chat's row, else the panel itself.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const current = el.querySelector<HTMLElement>('[aria-current="page"]');
    (current ?? el).focus({ preventScroll: true });
  }, []);

  // In on the base band with enter easing (reduced motion: a fade).
  useEffect(() => {
    void controls.start(
      reduce
        ? { opacity: 1, transition: { duration: dur.quick } }
        : { x: 0, transition: { duration: dur.base, ease: ease.enter } }
    );
  }, [controls, reduce]);

  return (
    <>
      <motion.div
        aria-hidden="true"
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.enter } }}
        exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
      >
        <motion.div
          data-slot="drawer-scrim"
          className="absolute inset-0 touch-none bg-[var(--scrim)]"
          style={{ opacity: swipe.scrimOpacity }}
          onClick={() => {
            if (!swipe.dragged.current) onClose();
          }}
        />
      </motion.div>
      <motion.div
        ref={panel}
        id={chatsDrawerId}
        role="dialog"
        aria-modal="true"
        aria-label="Chats"
        tabIndex={-1}
        onKeyDown={trapTab}
        data-slot="chats-drawer"
        className="absolute inset-y-0 left-0 right-48 flex flex-col rounded-r-20 border-r border-hairline surface-solid pt-[var(--statusbar-h)] pb-[var(--safe-bottom)] pl-[var(--notch-left)] text-ink"
        initial={reduce ? { opacity: 0 } : { x: '-100%' }}
        animate={controls}
        style={{ x: swipe.offset, touchAction: 'pan-y' }}
        exit={
          reduce
            ? { opacity: 0, transition: { duration: dur.quick } }
            : { x: '-100%', transition: { duration: dur.quick, ease: ease.exit } }
        }
      >
      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-16 px-16 text-center">
          <p className="text-body text-muted">Your matches and their messages will show up here.</p>
          <button
            type="button"
            onClick={() => actions.setTab('explore')}
            className="min-h-[var(--target)] rounded-full bg-accent px-24 text-label text-on-accent"
          >
            Explore
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto pt-8 pb-16">
          <ul className="px-8">
            {entries.map(({ character, convo, last }, index) => {
              const current = character.id === currentId;
              const typing = Boolean(state.typing[character.id]);
              return (
                <motion.li
                  key={character.id}
                  initial={reduce ? false : { opacity: 0, y: rowStagger.riseY }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: {
                      duration: dur.base,
                      ease: ease.enter,
                      delay: Math.min(index, rowStagger.max - 1) * rowStagger.gap,
                    },
                  }}
                >
                  <button
                    type="button"
                    aria-current={current ? 'page' : undefined}
                    onClick={() => onPick(character.id)}
                    className={clsx(
                      stateLayer,
                      'relative flex min-h-[var(--target-touch)] w-full items-center gap-12 rounded-20 px-12 py-12 text-left'
                    )}
                  >
                    {current ? (
                      <motion.span
                        aria-hidden="true"
                        layoutId="drawer-current-row"
                        data-slot="drawer-current"
                        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-[color-mix(in_oklab,var(--t-ink)_var(--drawer-current-mix),transparent)]"
                        transition={reduce ? instant : spring.snappy}
                      />
                    ) : null}
                    <Avatar character={character} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline gap-8">
                        <span className="min-w-0 flex-1 truncate text-label">{character.name}</span>
                        {last ? (
                          <time dateTime={isoTime(last.at)} className="shrink-0 text-caption text-[color-mix(in_oklab,var(--t-muted)_var(--drawer-muted-mix),var(--t-ink))] tabular-nums">
                            {relativeTime(last.at, now)}
                          </time>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-8">
                        {typing ? (
                          <span className="flex min-w-0 flex-1 items-center gap-8 text-label font-normal text-[color-mix(in_oklab,var(--t-muted)_var(--drawer-muted-mix),var(--t-ink))]">
                            <TypingDots size="sm" />
                            <span>typing</span>
                          </span>
                        ) : (
                          <span
                            className={clsx(
                              'min-w-0 flex-1 truncate text-label',
                              convo.unread > 0 ? 'text-ink' : 'font-normal text-[color-mix(in_oklab,var(--t-muted)_var(--drawer-muted-mix),var(--t-ink))]'
                            )}
                          >
                            {rowPreview(last, character.name)}
                          </span>
                        )}
                        <UnreadBadge count={convo.unread} />
                      </span>
                    </span>
                    {current ? <span className="sr-only">, open now</span> : null}
                  </button>
                </motion.li>
              );
            })}
          </ul>
          {entries.length === 1 ? (
            <div className="flex flex-col items-center gap-12 px-16 pt-24 text-center">
              <p className="text-label font-normal text-muted">Swipe right on more people to start new chats.</p>
              <motion.button
                type="button"
                aria-label="Explore new people"
                onClick={() => actions.setTab('explore')}
                whileTap={reduce ? undefined : { scale: lens.pressScale }}
                transition={spring.snappy}
                className="liquid-glass grid size-[var(--target-touch)] place-items-center rounded-full"
              >
                <Search aria-hidden="true" className="size-20" />
              </motion.button>
            </div>
          ) : null}
        </div>
      )}
      </motion.div>
    </>
  );
}
