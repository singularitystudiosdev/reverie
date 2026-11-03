/*
  Chats drawer: the hamburger in the chat header slides the chat list in from
  the LEFT over a scrim, for quick switching (state.drawerOpen / setDrawer).
  - The only list of chats (there is no Chats screen): compact rows with
    avatar sm, name, preview, time, unread; the open chat is marked
    (aria-current + the selected state layer). With one chat the list says how
    to get more (one sentence, one Explore action).
  - Closes on a pick, the scrim, the close button, Escape, or a LEFT swipe:
    the panel tracks the finger directly, projects along its velocity on
    release, and settles on the nearer rest (open or gone), the same physics
    as the profile sheet. The scrim lightens as the panel is pulled left.
  - Rows rise in with a 30ms stagger (first 10) when the drawer opens, and
    the open chat's highlight is a shared layout element that slides between
    rows. Reduced motion: no stagger, the highlight jumps.
  - Rows carry 12px of padding inside the pressed/hover state layer (v4), so
    the highlight never hugs the name or preview.
  - Focus moves in (to the open chat's row) and returns to the hamburger on
    close; Tab stays inside while open. aria-expanded lives on the hamburger
    (ChatHeader).
  - Rendered into the frame's UI layer (the parent of <main>) through a
    portal, so it covers the floating tab bar (z-20) and stays under the
    profile sheet (z-30). Opaque panel (surface-solid): no blur, per the
    blur budget.
  - Motion: the panel slides in on the base band with enter easing and leaves
    on the quick band; the scrim fades. Reduced motion: fades only, and a
    released drag settles without springing.
*/
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useAnimationControls,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '../Avatar';
import { dur, ease, instant, rowStagger, spring, useReducedMotion } from '../../lib/motion';
import { isoTime, relativeTime } from '../../lib/time';
import { useApp } from '../../state/store';
import { chatEntries, previewText, useNow } from './chatData';
import { trapTab } from './focus';
import { stateLayer } from './stateLayer';
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
  const [width, setWidth] = useState(0);
  // 0 at rest, -1 fully off to the left: drives the scrim's lightening.
  const dragProgress = useMotionValue(0);
  const scrimOpacity = useTransform(dragProgress, (v) => Math.min(1, Math.max(0, 1 + v)));
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

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const update = () => setWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // In on the base band with enter easing (reduced motion: a fade).
  useEffect(() => {
    void controls.start(
      reduce
        ? { opacity: 1, transition: { duration: dur.quick } }
        : { x: 0, transition: { duration: dur.base, ease: ease.enter } }
    );
  }, [controls, reduce]);

  const onDrag = (_: unknown, info: PanInfo) => {
    const w = panel.current?.offsetWidth ?? 0;
    dragProgress.set(w ? info.offset.x / w : 0);
  };

  // Release: project along the velocity, settle on the nearer rest (0 or -width).
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const w = panel.current?.offsetWidth ?? 0;
    const projected = info.offset.x + info.velocity.x * dur.base;
    if (Math.abs(projected + w) < Math.abs(projected)) {
      onClose();
      return;
    }
    if (reduce) {
      dragProgress.set(0);
      void controls.start({ x: 0, transition: instant });
      return;
    }
    void animate(dragProgress, 0, { duration: dur.base, ease: ease.enter });
    void controls.start({ x: 0, transition: { duration: dur.base, ease: ease.enter } });
  };

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
          className="absolute inset-0 bg-[var(--scrim)]"
          style={{ opacity: scrimOpacity }}
          onClick={onClose}
        />
      </motion.div>
      <motion.div
        ref={panel}
        id={chatsDrawerId}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chats-drawer-title"
        tabIndex={-1}
        onKeyDown={trapTab}
        data-slot="chats-drawer"
        className="absolute inset-y-0 left-0 right-48 flex flex-col rounded-r-20 border-r border-hairline surface-solid pt-[var(--statusbar-h)] pb-[var(--safe-bottom)] pl-[var(--notch-left)] text-ink"
        initial={reduce ? { opacity: 0 } : { x: '-100%' }}
        animate={controls}
        drag="x"
        dragListener
        dragDirectionLock
        dragConstraints={{ left: -width, right: 0 }}
        dragMomentum={false}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        style={{ touchAction: 'pan-y' }}
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
          className={clsx(stateLayer, 'relative grid size-[var(--target-touch)] shrink-0 place-items-center rounded-full')}
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
        <div className="min-h-0 flex-1 overflow-y-auto pb-16">
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
                        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-current opacity-[var(--state-layer-focus)]"
                        transition={reduce ? instant : spring.snappy}
                      />
                    ) : null}
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
                </motion.li>
              );
            })}
          </ul>
          {entries.length === 1 ? (
            <div className="flex flex-col items-center gap-12 px-16 pt-24 text-center">
              <p className="text-label font-normal text-muted">Swipe right on more people to start new chats.</p>
              <button
                type="button"
                onClick={() => actions.setTab('explore')}
                className="min-h-[var(--target)] rounded-full bg-accent px-24 text-label text-on-accent"
              >
                Explore
              </button>
            </div>
          ) : null}
        </div>
      )}
      </motion.div>
    </>
  );
}
