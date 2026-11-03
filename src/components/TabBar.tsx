/*
  TabBar: the floating liquid-glass pill at the bottom of every screen. Two
  items with visible labels and 44px targets: Chats and Explore.
  - Material: .liquid-glass (glass.css), the one place the pane is refractive;
    the active tab sits in a .liquid-glass-lens that SLIDES between tabs on the
    snappy spring and STRETCHES along its direction of travel by its own speed,
    then settles. Presses squish the tab (scale 0.96, spring). Reduced motion:
    the lens jumps, no stretch, no squish, no nudge.
  - Chats is LOCKED until the first right swipe (no matches): a lock icon in
    place of the chat bubble, aria-disabled, and a tap nudges the tab (one short
    horizontal shift) and shows a hint bubble for 2s. The moment the first match
    exists the lock swaps into the chat icon (one quick scale/opacity swap) and
    the tab works: it opens the last chat. Chats is the active tab whenever a
    chat is open. Its badge totals the unread messages.
  - A frame under 280px wide (a landscape phone) stacks icon over label.
*/
import { Lock, MessageCircle, Search, type LucideIcon } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useAnimationControls,
  useMotionValue,
  useTransform,
  useVelocity,
} from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { cn } from '../lib/cn';
import { dur, ease, lens, lockedTab, spring, useReducedMotion } from '../lib/motion';
import { useApp, useChatUnlocked, type AppState } from '../state/store';

const items: { tab: AppState['tab']; label: string; icon: LucideIcon }[] = [
  { tab: 'chats', label: 'Chats', icon: MessageCircle },
  { tab: 'explore', label: 'Explore', icon: Search },
];

const hintText = 'Swipe right on someone to unlock chat';

interface Geo {
  xs: number[];
  y: number;
  w: number;
  h: number;
}

export function TabBar(): JSX.Element {
  const { state, actions } = useApp();
  const unlocked = useChatUnlocked();
  const reduce = useReducedMotion();
  const unread = state.matchIds.reduce((sum, id) => sum + (state.conversations[id]?.unread ?? 0), 0);
  // An open chat belongs to Chats; a locked Chats can never be the active tab.
  const active: AppState['tab'] = state.openChatId ? 'chats' : state.tab;
  const activeIndex = Math.max(0, items.findIndex((it) => it.tab === active));

  const listRef = useRef<HTMLUListElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);

  // The lens follows the active tab's box, measured (equal columns, so one width).
  const measure = useCallback(() => {
    const tabs = tabRefs.current;
    const first = tabs[0];
    if (!first) return;
    setGeo({
      xs: tabs.map((t) => t?.offsetLeft ?? 0),
      y: first.offsetTop,
      w: first.offsetWidth,
      h: first.offsetHeight,
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [measure, unread, unlocked]);

  const lensX = useMotionValue(0);
  const velocity = useVelocity(lensX);
  const stretch = useTransform(velocity, (v) => 1 + Math.min(Math.abs(v) / lens.speedForMax, 1) * lens.maxStretch);
  const squash = useTransform(stretch, (s) => 1 - (s - 1) * lens.squash);
  const placed = useRef<number | null>(null);

  useEffect(() => {
    if (!geo) return;
    const target = geo.xs[activeIndex] ?? 0;
    if (placed.current === null || placed.current === activeIndex || reduce) {
      lensX.jump(target);
    } else {
      const controls = animate(lensX, target, spring.snappy);
      placed.current = activeIndex;
      return () => controls.stop();
    }
    placed.current = activeIndex;
  }, [geo, activeIndex, reduce, lensX]);

  // Locked Chats: nudge, then a 2s hint bubble.
  const nudge = useAnimationControls();
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<number | null>(null);
  const clearHint = useCallback(() => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = null;
    setHint(false);
  }, []);

  useEffect(() => {
    if (unlocked) clearHint();
  }, [unlocked, clearHint]);
  useEffect(() => clearHint, [clearHint]);

  const press = (tab: AppState['tab']) => {
    if (tab === 'chats' && !unlocked) {
      if (!reduce) {
        void nudge.start({
          x: [0, lockedTab.nudgeX, 0],
          transition: { duration: lockedTab.nudgeS, ease: ease.continuous },
        });
      }
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
      setHint(true);
      hintTimer.current = window.setTimeout(clearHint, lockedTab.hintMs);
      return;
    }
    actions.setTab(tab);
  };

  return (
    <nav
      aria-label="Primary"
      data-slot="tab-bar"
      className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--tabbar-gap)+var(--safe-bottom))] z-20 flex flex-col items-center gap-8 [container-type:inline-size]"
    >
      <div role="status" className="flex justify-center">
        <AnimatePresence>
          {hint ? (
            <motion.p
              key="hint"
              data-slot="tab-hint"
              className="pointer-events-none mx-[var(--gutter)] rounded-20 border border-hairline bg-surface-strong px-16 py-8 text-center text-label text-ink shadow-8 narrow:px-12 narrow:py-4 narrow:text-caption"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.enter } }}
              exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
            >
              {hintText}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      <ul
        ref={listRef}
        className="liquid-glass pointer-events-auto grid h-[var(--tabbar-pill-h)] auto-cols-fr grid-flow-col items-center gap-4 rounded-full p-[var(--tabbar-pad)]"
      >
        {geo ? (
          <motion.span
            aria-hidden="true"
            data-slot="tab-lens"
            className="liquid-glass-lens pointer-events-none absolute top-0 left-0 -z-1 rounded-full"
            style={{
              x: lensX,
              scaleX: reduce ? 1 : stretch,
              scaleY: reduce ? 1 : squash,
              top: geo.y,
              width: geo.w,
              height: geo.h,
            }}
          />
        ) : null}
        {items.map(({ tab, label, icon }, i) => {
          const isActive = active === tab;
          const locked = tab === 'chats' && !unlocked;
          const Icon = locked ? Lock : icon;
          return (
            <li key={tab} className="flex">
              <motion.button
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                data-slot="tab"
                aria-current={isActive ? 'page' : undefined}
                aria-disabled={locked ? true : undefined}
                onClick={() => press(tab)}
                animate={tab === 'chats' ? nudge : undefined}
                whileTap={reduce ? undefined : { scale: lens.pressScale }}
                transition={spring.snappy}
                className={cn(
                  'relative flex h-[var(--target-touch)] min-w-[var(--target-touch)] flex-1 items-center justify-center gap-8 rounded-full px-16 text-label',
                  'narrow:flex-col narrow:gap-0 narrow:px-8 narrow:text-caption',
                  'transition-colors duration-[var(--duration-150)] ease-standard',
                  isActive ? 'text-ink' : 'text-ink/80 hover:text-ink'
                )}
              >
                <span className="relative grid size-20 place-items-center narrow:size-16">
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={locked ? 'lock' : 'open'}
                      className="grid place-items-center"
                      initial={{ opacity: 0, scale: reduce ? 1 : 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: reduce ? 1 : 0.6 }}
                      transition={{ opacity: { duration: dur.quick }, scale: spring.snappy }}
                    >
                      <Icon aria-hidden="true" className="size-20 narrow:size-16" />
                    </motion.span>
                  </AnimatePresence>
                </span>
                <span>{label}</span>
                {locked ? <span className="sr-only">, locked</span> : null}
                {tab === 'chats' && unread > 0 ? (
                  <span
                    data-slot="tab-badge"
                    className="inline-flex h-[var(--badge-size)] min-w-[var(--badge-size)] items-center justify-center rounded-full bg-accent px-6 text-caption text-on-accent tabular-nums narrow:absolute narrow:top-0 narrow:right-4"
                  >
                    <span className="sr-only">, </span>
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
              </motion.button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
