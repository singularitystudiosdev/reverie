/*
  Avatar: a round crop of her portrait.
  - Crop: object-position + transform scale with the same origin
    (character.avatarPosition / avatarScale), so the face fills the circle.
  - Skeleton: the theme surface color until the image loads, then a 150ms fade.
  - ring: the live ring, a conic stroke in HER theme accent (the one place a
    component reads themes.ts for a color) turning slowly. The turn is
    motion-safe only; under reduced motion the ring is still drawn, still.
  - layoutId: shared-element morph (convention `avatar-${id}`).
*/
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { artSize } from '../data/characters';
import type { Character } from '../data/types';
import { cn } from '../lib/cn';
import { getTheme } from '../theme/themes';

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
  const [loaded, setLoaded] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setLoaded(true);
  }, [character.portraitSm]);

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
      <span className="absolute inset-0 overflow-hidden rounded-full bg-surface">
        <img
          ref={img}
          src={character.portraitSm}
          alt={alt}
          width={artSize.sm.width}
          height={artSize.sm.height}
          decoding="async"
          loading={eager ? 'eager' : 'lazy'}
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={cn(
            'size-full object-cover transition-opacity duration-[var(--duration-150)] ease-standard',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
          style={{
            objectPosition: character.avatarPosition,
            transform: `scale(${character.avatarScale})`,
            transformOrigin: character.avatarPosition,
          }}
        />
      </span>
    </motion.span>
  );
}
