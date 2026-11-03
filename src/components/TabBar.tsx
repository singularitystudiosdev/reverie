/*
  TabBar: the floating pill at the bottom of every screen. Two items with
  visible labels, 44px targets, a sliding active indicator (shared layoutId,
  snappy spring on transform; instant under reduced motion), and the unread
  total on Chats. One of the three surfaces allowed a backdrop blur
  (--blur-ui, 12px max).
*/
import { MessageCircle, Search, type LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { JSX } from 'react';
import { cn } from '../lib/cn';
import { instant, spring } from '../lib/motion';
import { useApp, type AppState } from '../state/store';

const items: { tab: AppState['tab']; label: string; icon: LucideIcon }[] = [
  { tab: 'chats', label: 'Chats', icon: MessageCircle },
  { tab: 'explore', label: 'Explore', icon: Search },
];

export function TabBar(): JSX.Element {
  const { state, actions } = useApp();
  const reduce = useReducedMotion();
  const unread = state.matchIds.reduce((sum, id) => sum + (state.conversations[id]?.unread ?? 0), 0);
  // An open chat belongs to Chats.
  const active: AppState['tab'] = state.openChatId ? 'chats' : state.tab;

  return (
    <nav
      aria-label="Primary"
      data-slot="tab-bar"
      className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--tabbar-gap)+var(--safe-bottom))] z-20 flex justify-center"
    >
      <ul className="pointer-events-auto flex h-[var(--tabbar-pill-h)] items-center gap-4 rounded-full border border-hairline bg-surface-strong p-[var(--tabbar-pad)] shadow-8 backdrop-blur-[var(--blur-ui)]">
        {items.map(({ tab, label, icon: Icon }) => {
          const isActive = active === tab;
          return (
            <li key={tab} className="flex">
              <button
                type="button"
                data-slot="tab"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => actions.setTab(tab)}
                className={cn(
                  'relative flex h-[var(--target-touch)] min-w-[var(--target-touch)] items-center gap-8 rounded-full px-16 text-label',
                  'transition-colors duration-[var(--duration-150)] ease-standard',
                  isActive ? 'text-on-accent' : 'text-muted hover:text-ink'
                )}
              >
                {isActive ? (
                  <motion.span
                    layoutId="tab-indicator"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-accent"
                    transition={reduce ? instant : spring.snappy}
                  />
                ) : null}
                <Icon aria-hidden="true" className="relative size-20" />
                <span className="relative">{label}</span>
                {tab === 'chats' && unread > 0 ? (
                  <span
                    data-slot="tab-badge"
                    className={cn(
                      'relative inline-flex h-[var(--badge-size)] min-w-[var(--badge-size)] items-center justify-center rounded-full px-6 text-caption tabular-nums',
                      isActive ? 'bg-on-accent text-accent' : 'bg-accent text-on-accent'
                    )}
                  >
                    <span className="sr-only">, </span>
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
