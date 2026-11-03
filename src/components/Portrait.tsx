/*
  Portrait: her animated portrait, the "animated gif" of the app. Every place a
  character's portrait shows (swipe cards, avatars, the profile hero, the
  instant-match modal) renders this instead of a bare image.

  - A muted, looping, inline <video> (public/characters/<id>-loop.mp4, encoded
    by scripts/encode-loops.sh) over her still portrait. The still is the
    poster, so there is always a picture: before the video has a frame, when
    autoplay is refused (low power mode), and when the video fails to load.
  - preload: "auto" when `priority` (the top card, the chat header), else
    "metadata" so a deck of cards and a drawer of avatars do not pull 14 clips.
  - It only plays while it can be seen: an IntersectionObserver pauses it
    offscreen (covered drawers, the card behind the top one scrolled away) and
    it pauses while the document is hidden. Playback is started with play()
    when it comes into view rather than with the autoplay attribute, which
    would start (and download) a clip nobody can see.
  - Reduced motion: no video element at all, only the still <img>. A video
    error does the same.
  - className sizes and positions the wrapper; mediaClassName and style go on
    the <video> and <img> alike (Avatar puts its object-position + scale crop
    there). `small` picks the 360x640 still for round crops.
*/
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { artSize } from '../data/characters';
import type { Character } from '../data/types';
import { cn } from '../lib/cn';

export interface PortraitProps {
  character: Character;
  className?: string;
  mediaClassName?: string;
  style?: CSSProperties;
  /** Above the fold and about to be seen: load eagerly and preload the clip. */
  priority?: boolean;
  /** Use the small still (360x640): round crops and thumbnails. */
  small?: boolean;
  /** Empty by default: the name is almost always rendered beside the portrait. */
  alt?: string;
}

export function Portrait({
  character,
  className,
  mediaClassName,
  style,
  priority = false,
  small = false,
  alt = '',
}: PortraitProps): JSX.Element {
  const reduce = useReducedMotion() ?? false;
  const wrap = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [stillLoaded, setStillLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);

  const still = small ? character.portraitSm : character.portrait;
  const stillSize = small ? artSize.sm : artSize.full;
  const animated = !reduce && !failed;
  const shouldPlay = animated && inView && pageVisible;

  // A cached still can finish before React attaches onLoad.
  useEffect(() => {
    setStillLoaded(false);
    if (img.current?.complete && img.current.naturalWidth > 0) setStillLoaded(true);
  }, [still]);

  // A new character reuses this component only when the parent re-keys it; if
  // the clip changes, forget that the old one was playing.
  useEffect(() => {
    setPlaying(false);
    setFailed(false);
  }, [character.loop]);

  useEffect(() => {
    if (!animated) return;
    const node = wrap.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setInView(last.isIntersecting);
    });
    io.observe(node);
    return () => io.disconnect();
  }, [animated]);

  useEffect(() => {
    if (!animated) return;
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [animated]);

  useEffect(() => {
    const node = video.current;
    if (!node) return;
    node.muted = true;
    if (shouldPlay) {
      // Refused autoplay leaves the still showing; nothing to recover.
      node.play().catch(() => undefined);
    } else {
      node.pause();
    }
  }, [shouldPlay, character.loop]);

  const label = alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true as const };

  return (
    <span ref={wrap} data-slot="portrait" className={cn('relative block overflow-hidden bg-surface', className)}>
      <img
        ref={img}
        src={still}
        alt={alt}
        width={stillSize.width}
        height={stillSize.height}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        draggable={false}
        onLoad={() => setStillLoaded(true)}
        className={cn(
          'absolute inset-0 size-full object-cover transition-opacity duration-[var(--duration-150)] ease-standard',
          stillLoaded ? 'opacity-100' : 'opacity-0',
          mediaClassName
        )}
        style={style}
      />
      {animated ? (
        <video
          ref={video}
          src={character.loop}
          poster={still}
          width={artSize.loop.width}
          height={artSize.loop.height}
          muted
          loop
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          controls={false}
          preload={priority ? 'auto' : 'metadata'}
          draggable={false}
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
          className={cn(
            'pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-[var(--duration-150)] ease-standard',
            playing ? 'opacity-100' : 'opacity-0',
            mediaClassName
          )}
          style={style}
          {...label}
        />
      ) : null}
    </span>
  );
}
