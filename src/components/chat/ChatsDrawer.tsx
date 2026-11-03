/*
  Chats drawer: the hamburger in the chat header slides the chat list in from
  the LEFT over a scrim, for quick switching (state.drawerOpen / setDrawer).
  - Compact rows: avatar sm, name, preview, time, unread; the open chat is
    marked (aria-current + the selected state layer).
  - Closes on a pick, the scrim, the close button or Escape. Focus moves in
    (to the open chat's row) and returns to the hamburger on close; Tab stays
    inside while open. aria-expanded lives on the hamburger (ChatHeader).
  - Rendered into the frame's UI layer (the parent of <main>) through a
    portal, so it covers the floating tab bar (z-20) and stays under the
    profile sheet (z-30). Opaque panel (surface-solid): no blur, per the
    blur budget.
  - Motion: the panel slides in on the base band with enter easing and leaves
    on the quick band; the scrim fades. Reduced motion: fades only.
*/
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '../Avatar';
import { dur, ease } from '../../lib/motion';
import { isoTime, relativeTime } from '../../lib/time';
import { useApp } from '../../state/store';
import { chatEntries, previewText, useNow } from './chatData';
import { trapTab } from './focus';
import { stateLayer, stateLayerSelected } from './stateLayer';
import { TypingDots } from './TypingDots';
import { UnreadBadge } from './UnreadBadge';

export const chatsDrawerId = 'chats-drawer';

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
  const reduce = useReducedMotion() ?? false;
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
          <motion.div
            aria-hidden="true"
            data-slot="drawer-scrim"
            className="absolute inset-0 bg-[var(--scrim)]"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.enter } }}
            exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
          />
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

  return (
    <motion.div
      ref={panel}
      id={chatsDrawerId}
      role="dialog"
      aria-modal="true"
      aria-labelledby="chats-drawer-title"
      tabIndex={-1}
      onKeyDown={trapTab}
      data-slot="chats-drawer"
      className="absolute inset-y-0 left-0 right-48 flex flex-col rounded-r-20 border-r border-hairline surface-solid pt-[var(--statusbar-h)] pb-[var(--safe-bottom)] text-ink"
      initial={reduce ? { opacity: 0 } : { x: '-100%' }}
      animate={reduce ? { opacity: 1, transition: { duration: dur.quick } } : { x: 0, transition: { duration: dur.base, ease: ease.enter } }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: dur.quick } }
          : { x: '-100%', transition: { duration: dur.quick, ease: ease.exit } }
      }
    >
      <div className="flex items-center justify-between gap-8 py-8 pr-8 pl-16">
        <h2 id="chats-drawer-title" className="font-display text-title">
          Chats
        </h2>
        <button
          type="button"
          aria-label="Close chats"
          onClick={onClose}
          className={clsx(stateLayer, 'relative grid size-[var(--target-touch)] place-items-center rounded-full')}
        >
          <X aria-hidden="true" className="size-20" />
        </button>
      </div>

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
        <ul className="min-h-0 flex-1 overflow-y-auto px-8 pb-16">
          {entries.map(({ character, convo, last }) => {
            const current = character.id === currentId;
            const typing = Boolean(state.typing[character.id]);
            return (
              <li key={character.id}>
                <button
                  type="button"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => onPick(character.id)}
                  className={clsx(
                    stateLayer,
                    current && stateLayerSelected,
                    'relative flex min-h-[var(--target-touch)] w-full items-center gap-12 rounded-20 p-8 text-left'
                  )}
                >
                  <Avatar character={character} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline gap-8">
                      <span className="min-w-0 flex-1 truncate text-label">{character.name}</span>
                      {last ? (
                        <time dateTime={isoTime(last.at)} className="shrink-0 text-caption text-muted tabular-nums">
                          {relativeTime(last.at, now)}
                        </time>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-8">
                      {typing ? (
                        <span className="flex min-w-0 flex-1 items-center gap-8 text-label font-normal text-muted">
                          <TypingDots size="sm" />
                          <span>typing</span>
                        </span>
                      ) : (
                        <span
                          className={clsx(
                            'min-w-0 flex-1 truncate text-label',
                            convo.unread > 0 ? 'text-ink' : 'font-normal text-muted'
                          )}
                        >
                          {previewText(last, character.name)}
                        </span>
                      )}
                      <UnreadBadge count={convo.unread} />
                    </span>
                  </span>
                  {current ? <span className="sr-only">, open now</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
