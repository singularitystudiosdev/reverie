/*
  Avatar: a round crop of her animated portrait (Portrait: the looping clip
  over the small still).
  - Crop: object-position + transform scale with the same origin
    (character.avatarPosition / avatarScale), so the face fills the circle.
  - Skeleton: the theme surface color until the still loads, then a 150ms fade.
  - eager: the clip preloads (the chat header, the match modal).
  - ring: the live ring, a conic stroke in HER theme accent (the one place a
    component reads themes.ts for a color) turning slowly. The turn is
    motion-safe only; under reduced motion the ring is still drawn, still.
  - layoutId: shared-element morph (convention `avatar-${id}`).
*/
import { motion } from 'motion/react';
import type { CSSProperties, JSX } from 'react';
import type { Character } from '../data/types';
import { cn } from '../lib/cn';
import { getTheme } from '../theme/themes';
import { Portrait } from './Portrait';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

/** Diameter tokens: sm 40, md 56, lg 72, xl 132 (tokens.css). */
export const avatarSizeVar: Record<AvatarSize, string> = {
  sm: 'var(--avatar-sm)',
  md: 'var(--avatar-md)',
  lg: 'var(--avatar-lg)',
  xl: 'var(--avatar-xl)',
};

export interface AvatarProps {
  character: Character;
  size: AvatarSize;
  ring?: boolean;
  layoutId?: string;
  className?: string;
  /** Empty by default: the name is almost always rendered beside the avatar. */
  alt?: string;
  /** Load eagerly (above the fold, e.g. the chat header). */
  eager?: boolean;
}

export function Avatar({
  character,
  size,
  ring = false,
  layoutId,
  className,
  alt = '',
  eager = false,
}: AvatarProps): JSX.Element {
  const dim = avatarSizeVar[size];
  const style = {
    width: dim,
    height: dim,
    '--ring-color': getTheme(character.theme).colors.accent,
  } as CSSProperties;

  return (
    <motion.span
      layoutId={layoutId}
      data-slot="avatar"
      className={cn('relative inline-block shrink-0 rounded-full', className)}
      style={style}
    >
      {ring ? (
        <span
          aria-hidden="true"
          data-slot="avatar-ring"
          className="avatar-ring absolute -inset-[calc(var(--ring-width)+var(--ring-gap))] rounded-full motion-safe:animate-ring-spin"
        />
      ) : null}
      <Portrait
        character={character}
        small
        priority={eager}
        alt={alt}
        className="absolute inset-0 rounded-full"
        style={{
          objectPosition: character.avatarPosition,
          transform: `scale(${character.avatarScale})`,
          transformOrigin: character.avatarPosition,
        }}
      />
    </motion.span>
  );
}
