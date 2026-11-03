/*
  The chat header, after the reference: a round liquid-glass hamburger at the
  left (opens the chats drawer, aria-expanded), her avatar centered with her
  name in a small pill under it. Her avatar and name are ONE button that opens
  her profile sheet ("View <name>'s profile"). The top right is a cluster of
  liquid-glass buttons: the magnifier is always the LAST one (it is the way to
  Explore, there is no bottom bar), and the photos button opens her gallery
  sheet to its LEFT; that one is only there once she has sent an image or a clip
  in this chat, and springs in when the first one arrives (never on a chat that
  already has media). The cluster is right-aligned, so the magnifier never moves
  when the gallery button comes or goes. There is no Profile pill.

  The name pill carries a second line, her thought: an emoji and a short
  teasing action. It shows while she types, for ~4s after she speaks, and for
  ~5s every 12-18s while the chat is idle. The pill resizes with a layout
  spring (the line fades and rises); under reduced motion the line swaps.
*/
import { clsx } from 'clsx';
import { Images, Menu, Search } from 'lucide-react';
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
  /** She has sent at least one image or clip: the gallery button shows. */
  hasGallery: boolean;
  menuRef: Ref<HTMLButtonElement>;
  titleRef: Ref<HTMLButtonElement>;
  onMenu(): void;
  onProfile(): void;
  onGallery(): void;
  /** The magnifier: leave this chat for Explore. */
  onExplore(): void;
}): JSX.Element {
  const { character, drawerOpen, galleryOpen, hasGallery, menuRef, titleRef, onMenu, onProfile, onGallery, onExplore } =
    props;
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

        <div className="flex items-center gap-8 justify-self-end">
          <AnimatePresence initial={false}>
            {hasGallery ? (
              <motion.button
                key="gallery"
                type="button"
                aria-label={`Open ${character.name}'s gallery`}
                aria-haspopup="dialog"
                aria-expanded={galleryOpen}
                onClick={onGallery}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1, transition: { scale: spring.snappy, opacity: { duration: dur.quick } } }}
                exit={{ opacity: 0, scale: 0.6, transition: { duration: dur.quick, ease: ease.exit } }}
                whileTap={reduce ? undefined : { scale: lens.pressScale }}
                className="liquid-glass grid size-[var(--target-touch)] place-items-center rounded-full"
              >
                <Images aria-hidden="true" className="size-20" />
              </motion.button>
            ) : null}
          </AnimatePresence>
          <motion.button
            type="button"
            aria-label="Explore new people"
            onClick={onExplore}
            whileTap={reduce ? undefined : { scale: lens.pressScale }}
            transition={spring.snappy}
            className="liquid-glass grid size-[var(--target-touch)] place-items-center rounded-full"
          >
            <Search aria-hidden="true" className="size-20" />
          </motion.button>
        </div>
      </div>
    </header>
  );
}
