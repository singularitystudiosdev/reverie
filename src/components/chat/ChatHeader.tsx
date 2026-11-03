/*
  The chat header, after the reference: a round liquid-glass hamburger at the
  left (opens the chats drawer, aria-expanded), her avatar centered with her
  name in a small pill under it. Her avatar and name are ONE button that opens
  her profile sheet ("View <name>'s profile"). At the top right, a second
  liquid-glass button with the photos icon opens her gallery sheet. There is
  no Profile pill.
*/
import { clsx } from 'clsx';
import { Images, Menu } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { JSX, Ref } from 'react';
import { Avatar } from '../Avatar';
import type { Character } from '../../data/types';
import { lens, spring } from '../../lib/motion';
import { chatsDrawerId } from './ChatsDrawer';
import { stateLayer } from './stateLayer';

const pill = 'border border-hairline bg-surface-strong text-ink backdrop-blur-[var(--blur-ui)]';

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
  const reduce = useReducedMotion() ?? false;
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
          <span aria-hidden="true" className={clsx(pill, 'relative -mt-4 rounded-full px-12 py-2 text-label')}>
            {character.name}
          </span>
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
