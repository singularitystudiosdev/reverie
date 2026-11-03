/*
  The chat header, after the reference: a round hamburger at the left (opens
  the chats drawer, aria-expanded), her avatar centered with her name in a
  small pill under it, a "Profile" pill at the right. The avatar carries
  layoutId `avatar-${id}`: the morph from her Chats row IS the chat's
  entrance. The pills are one of the three surfaces allowed a backdrop blur.
*/
import { clsx } from 'clsx';
import { Menu } from 'lucide-react';
import type { JSX, Ref } from 'react';
import { Avatar } from '../Avatar';
import type { Character } from '../../data/types';
import { chatsDrawerId } from './ChatsDrawer';
import { stateLayer } from './stateLayer';

const pill = 'border border-hairline bg-surface-strong text-ink backdrop-blur-[var(--blur-ui)]';

export function ChatHeader(props: {
  character: Character;
  drawerOpen: boolean;
  menuRef: Ref<HTMLButtonElement>;
  titleRef: Ref<HTMLHeadingElement>;
  onMenu(): void;
  onProfile(): void;
}): JSX.Element {
  const { character, drawerOpen, menuRef, titleRef, onMenu, onProfile } = props;
  return (
    <header data-slot="chat-header" className="pt-[var(--statusbar-h)]">
      <div className="safe-x grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-8 pt-8 pb-4">
        <button
          ref={menuRef}
          type="button"
          aria-label="Chats"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls={drawerOpen ? chatsDrawerId : undefined}
          onClick={onMenu}
          className={clsx(stateLayer, pill, 'relative grid size-[var(--target-touch)] place-items-center justify-self-start rounded-full')}
        >
          <Menu aria-hidden="true" className="size-20" />
        </button>

        <div className="flex flex-col items-center">
          <Avatar character={character} size="md" layoutId={`avatar-${character.id}`} eager />
          {/* Focus lands here when the chat opens (tabIndex -1: not a Tab stop). */}
          <h1 ref={titleRef} tabIndex={-1} className={clsx(pill, 'relative -mt-4 rounded-full px-12 py-2 text-label')}>
            {character.name}
          </h1>
        </div>

        <button
          type="button"
          aria-haspopup="dialog"
          onClick={onProfile}
          className={clsx(stateLayer, pill, 'relative h-[var(--target-touch)] justify-self-end rounded-full px-16 text-label')}
        >
          Profile
        </button>
      </div>
    </header>
  );
}
