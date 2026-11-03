/*
  The chat header, after the reference: a round liquid-glass hamburger at the
  left (opens the chats drawer, aria-expanded), her avatar centered with her
  name in a small pill under it. Her avatar and name are ONE button that opens
  her profile sheet ("View <name>'s profile"). At the top right, a second
  liquid-glass button with the photos icon opens her gallery sheet. There is
  no Profile pill.

  The name pill carries a second line, her thought: an emoji and a short
  teasing action. It shows while she types, for ~4s after she speaks, and for
  ~5s every 12-18s while the chat is idle. The pill resizes with a layout
  spring (the line fades and rises); under reduced motion the line swaps.
*/
import { clsx } from 'clsx';
import { Images, Menu } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type JSX, type Ref } from 'react';
import { Avatar } from '../Avatar';
import { thoughts, type Thought } from '../../data/thoughts';
import type { Character } from '../../data/types';
import { dur, ease, instant, lens, spring, useReducedMotion } from '../../lib/motion';
import { useApp } from '../../state/store';
import { chatsDrawerId } from './ChatsDrawer';
import { stateLayer } from './stateLayer';

const pill = 'border border-hairline bg-surface-strong text-ink backdrop-blur-[var(--blur-ui)]';

/** How long her line stays after she speaks, and how long an idle one stays. */
const spokeHoldMs = 4000;
const idleHoldMs = 5000;
const idleGapMs = { min: 12000, max: 18000 };

/**
 * The line under her avatar, or null while only the name shows. A new line
 * never repeats the one before it.
 */
function useThought(characterId: string): Thought | null {
  const { state } = useApp();
  const typing = state.typing[characterId] === true;
  const messages = state.conversations[characterId]?.messages;
  const last = messages && messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastHerKey = last && last.from === 'her' ? `${last.id}` : null;
  const [line, setLine] = useState<Thought | null>(null);
  const lineRef = useRef<Thought | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const seenKey = useRef<string | null>(lastHerKey);
  const typingRef = useRef(typing);
  typingRef.current = typing;

  const show = (holdMs: number | null): void => {
    window.clearTimeout(hideTimer.current);
    const pool = thoughts[characterId] ?? [];
    if (pool.length === 0) return;
    const choices = pool.filter((t) => t !== lineRef.current);
    const next = choices[Math.floor(Math.random() * choices.length)] ?? pool[0];
    lineRef.current = next;
    setLine(next);
    if (holdMs !== null) hideTimer.current = window.setTimeout(() => hide(), holdMs);
  };
  const hide = (): void => {
    window.clearTimeout(hideTimer.current);
    lineRef.current = null;
    setLine(null);
  };

  // Typing holds a line up; when she stops, it lingers a moment.
  const wasTyping = useRef(false);
  useEffect(() => {
    if (typing) {
      if (!lineRef.current) show(null);
      else window.clearTimeout(hideTimer.current);
    } else if (wasTyping.current && lineRef.current) {
      hideTimer.current = window.setTimeout(() => hide(), spokeHoldMs);
    }
    wasTyping.current = typing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing]);

  // A new message from her: a fresh line for a few seconds.
  useEffect(() => {
    if (lastHerKey === seenKey.current) return;
    seenKey.current = lastHerKey;
    if (lastHerKey !== null && !typingRef.current) show(spokeHoldMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastHerKey]);

  // Idle: every 12-18s she lets a line slip for ~5s.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = (): void => {
      const gap = idleGapMs.min + Math.random() * (idleGapMs.max - idleGapMs.min);
      timer = window.setTimeout(() => {
        if (!typingRef.current && !lineRef.current) show(idleHoldMs);
        schedule();
      }, gap);
    };
    schedule();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(hideTimer.current);
      lineRef.current = null;
      setLine(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  return line;
}

export function ChatHeader(props: {
  character: Character;
  drawerOpen: boolean;
  galleryOpen: boolean;
  menuRef: Ref<HTMLButtonElement>;
  titleRef: Ref<HTMLButtonElement>;
  onMenu(): void;
  onProfile(): void;
  onGallery(): void;
}): JSX.Element {
  const { character, drawerOpen, galleryOpen, menuRef, titleRef, onMenu, onProfile, onGallery } = props;
  const reduce = useReducedMotion();
  const thought = useThought(character.id);
  return (
    <header data-slot="chat-header" className="pt-[var(--statusbar-h)]">
      <div className="safe-x grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-8 pt-8 pb-4">
        <motion.button
          ref={menuRef}
          type="button"
          aria-label="Chats"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls={drawerOpen ? chatsDrawerId : undefined}
          onClick={onMenu}
          whileTap={reduce ? undefined : { scale: lens.pressScale }}
          transition={spring.snappy}
          className="liquid-glass grid size-[var(--target-touch)] place-items-center justify-self-start rounded-full"
        >
          <Menu aria-hidden="true" className="size-20" />
        </motion.button>

        {/* Focus lands here when the chat opens. */}
        <button
          ref={titleRef}
          type="button"
          aria-label={`View ${character.name}'s profile`}
          aria-haspopup="dialog"
          onClick={onProfile}
          className={clsx(stateLayer, 'relative flex min-h-[var(--target-touch)] flex-col items-center rounded-20 p-4 text-ink')}
        >
          <Avatar character={character} size="md" eager />
          <motion.span
            aria-hidden="true"
            layout={!reduce}
            transition={reduce ? instant : spring.gentle}
            style={{ borderRadius: 14 }}
            className={clsx(pill, 'relative -mt-4 flex max-w-full flex-col items-center px-12 py-2 text-label')}
          >
            <motion.span layout={reduce ? false : 'position'} transition={reduce ? instant : spring.gentle}>
              {character.name}
            </motion.span>
            <AnimatePresence initial={false} mode="wait">
              {thought ? (
                <motion.span
                  key={thought.text}
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0, transition: instant } : { opacity: 0, y: -2 }}
                  transition={reduce ? instant : { duration: dur.base, ease: ease.enter }}
                  className="whitespace-nowrap text-caption text-muted"
                >
                  <span className="mr-4">{thought.emoji}</span>
                  {thought.text}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </motion.span>
        </button>

        <motion.button
          type="button"
          aria-label={`Open ${character.name}'s gallery`}
          aria-haspopup="dialog"
          aria-expanded={galleryOpen}
          onClick={onGallery}
          whileTap={reduce ? undefined : { scale: lens.pressScale }}
          transition={spring.snappy}
          className="liquid-glass grid size-[var(--target-touch)] place-items-center justify-self-end rounded-full"
        >
          <Images aria-hidden="true" className="size-20" />
        </motion.button>
      </div>
    </header>
  );
}
