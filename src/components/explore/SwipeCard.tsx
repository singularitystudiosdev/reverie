/*
  One card of the Explore deck. The deck renders two of these, the top card
  and the next one behind it; the same element moves from "next" to "top" when
  the deck advances, so her portrait (an animated loop, see Portrait) never reloads.

  Gesture model (motion values only, no React state per frame):
  - the inner layer drags on x; rotation and the Pass / Like stamps are derived
    from x; release past 30% of the card width, or a fast flick, commits.
  - commit: the card flies out on a snappy spring that carries the release
    velocity, then onDecide(dir). Otherwise it springs back to centre.
  - the outer layer is the card's place in the stack: the next card is scaled
    down and offset, rising toward the top card's pose as `progress` (written
    by the top card's drag, shared through Explore) goes 0 -> 1.
  - reduced motion: still follows the finger, but a commit fades out instead
    of flying and a cancel snaps back with no spring.
  - arrow keys and the round buttons reach the card through the `swipe` handle.
*/
import { Check, X } from 'lucide-react';
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type PanInfo,
} from 'motion/react';
import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type JSX,
  type Ref,
} from 'react';
import type { Character } from '../../data/types';
import { dur, ease, instant, spring } from '../../lib/motion';
import { Portrait } from '../Portrait';
import { clamp, deckConfig, type SwipeDir } from './deckConfig';
import './explore.css';

export type SwipeMode = 'fly' | 'fade';

export interface SwipeCardHandle {
  swipe(dir: SwipeDir, mode: SwipeMode): void;
}

export interface SwipeCardProps {
  character: Character;
  isTop: boolean;
  /** 0..1: how far the top card is dragged toward its commit point. */
  progress: MotionValue<number>;
  ref?: Ref<SwipeCardHandle>;
  /** Drag offset over the commit threshold, -1..1 (negative = pass side). */
  onDrag(d: number): void;
  /** The decision is made (release or key): the atmosphere gusts here. */
  onCommitStart(dir: SwipeDir): void;
  /** The card has left: the store moves on. */
  onDecide(dir: SwipeDir): void;
  onOpen(): void;
}

export function SwipeCard(props: SwipeCardProps): JSX.Element {
  const { character, isTop, progress, ref, onDrag, onCommitStart, onDecide, onOpen } = props;
  const reduce = useReducedMotion() ?? false;

  const x = useMotionValue(0);
  const fade = useMotionValue(1);
  const rank = useMotionValue(isTop ? 0 : 1);
  const layer = useRef<HTMLDivElement>(null);
  const width = useRef(1);
  const isTopRef = useRef(isTop);
  const busy = useRef(false);
  const gone = useRef(false);
  const dragged = useRef(false);

  useLayoutEffect(() => {
    isTopRef.current = isTop;
    rank.set(isTop ? 0 : 1);
  }, [isTop, rank]);

  useLayoutEffect(() => {
    const node = layer.current;
    if (!node) return;
    width.current = node.offsetWidth || 1;
    const ro = new ResizeObserver(() => {
      width.current = node.offsetWidth || 1;
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const threshold = () => width.current * deckConfig.commitShare;

  const rotate = useTransform(x, (v) => clamp(v / width.current, -1, 1) * deckConfig.maxRotateDeg);
  const stamp = (share: number) =>
    clamp(
      (share - deckConfig.stampStartAt) / (deckConfig.stampFullAt - deckConfig.stampStartAt),
      0,
      1
    );
  const likeOpacity = useTransform(x, (v) => stamp(v / threshold()));
  const passOpacity = useTransform(x, (v) => stamp(-v / threshold()));

  // The card's place in the stack.
  const stackScale = useTransform(() =>
    rank.get() === 0
      ? 1
      : deckConfig.nextScale + (1 - deckConfig.nextScale) * clamp(progress.get(), 0, 1)
  );
  const stackY = useTransform(() =>
    rank.get() === 0 ? '0px' : `calc(var(--deck-peek) * ${1 - clamp(progress.get(), 0, 1)})`
  );

  useMotionValueEvent(x, 'change', (v) => {
    if (!isTopRef.current || gone.current) return;
    onDrag(clamp(v / threshold(), -1, 1));
  });

  const finish = (dir: SwipeDir, mode: SwipeMode, velocity: number) => {
    if (busy.current) return;
    busy.current = true;
    if (layer.current) layer.current.style.pointerEvents = 'none';
    onCommitStart(dir);

    const decide = () => {
      if (gone.current) return;
      gone.current = true;
      onDecide(dir);
    };

    if (mode === 'fly' && !reduce) {
      const sign = dir === 'like' ? 1 : -1;
      animate(x, sign * width.current * deckConfig.flyTargetShare, {
        ...spring.snappy,
        velocity,
        onUpdate: (v) => {
          if (Math.abs(v) >= width.current * deckConfig.goneShare) decide();
        },
      }).then(decide);
    } else {
      animate(fade, 0, { duration: dur.quick, ease: ease.exit }).then(decide);
    }
  };

  useImperativeHandle(ref, () => ({ swipe: (dir, mode) => finish(dir, mode, 0) }));

  const onDragEnd = (_: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
    if (busy.current) return;
    const offset = info.offset.x;
    const velocity = info.velocity.x;
    const past = Math.abs(offset) >= threshold();
    const flick =
      Math.abs(velocity) >= deckConfig.flickVelocity &&
      Math.abs(offset) >= deckConfig.flickMinTravel &&
      Math.sign(velocity) === Math.sign(offset);
    if (past || flick) {
      finish(offset > 0 ? 'like' : 'pass', 'fly', velocity);
    } else {
      animate(x, 0, reduce ? instant : { ...spring.snappy, velocity });
    }
  };

  return (
    <motion.div
      aria-hidden={isTop ? undefined : true}
      inert={!isTop}
      className="absolute inset-0 origin-bottom"
      style={{ scale: stackScale, y: stackY, zIndex: isTop ? 1 : 0 }}
    >
      <motion.div
        ref={layer}
        drag={isTop ? 'x' : false}
        dragMomentum={false}
        onPointerDown={() => {
          dragged.current = false;
        }}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={onDragEnd}
        className="relative size-full origin-bottom overflow-hidden rounded-20 border border-hairline bg-surface shadow-16"
        style={{ x, rotate, opacity: fade }}
      >
        <button
          type="button"
          aria-label={`${character.name}, ${character.kind}. View profile`}
          onClick={() => {
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            if (!busy.current) onOpen();
          }}
          className="absolute inset-0 block size-full text-left focus-visible:[outline-offset:calc(var(--focus-ring-width)*-1)]"
        >
          <Portrait
            character={character}
            priority={isTop}
            className="absolute inset-0 size-full"
          />
          <span
            aria-hidden="true"
            className="deck-scrim pointer-events-none absolute inset-x-0 bottom-0 h-[var(--deck-scrim-height)]"
          />
          <span className="absolute inset-x-0 bottom-0 flex flex-col px-16 pb-16 text-(color:--deck-on-photo)">
            <span className="font-display text-name">{character.name}</span>
            <span className="text-label text-(color:--deck-on-photo-soft)">{character.kind}</span>
            <span className="pt-4 text-body text-(color:--deck-on-photo)">{character.tagline}</span>
            <span className="flex flex-wrap gap-8 pt-12">
              {character.interests.map((interest) => (
                <span
                  key={interest}
                  className="inline-flex h-[var(--deck-chip-h)] items-center rounded-12 bg-surface-strong px-8 text-caption text-ink"
                >
                  {interest}
                </span>
              ))}
            </span>
          </span>
        </button>

        <motion.span
          aria-hidden="true"
          style={{ opacity: likeOpacity }}
          className="pointer-events-none absolute top-16 left-16 inline-flex h-[var(--deck-stamp-h)] items-center gap-6 rounded-full bg-accent px-12 text-label text-on-accent"
        >
          <Check className="size-16" />
          Like
        </motion.span>
        <motion.span
          aria-hidden="true"
          style={{ opacity: passOpacity }}
          className="pointer-events-none absolute top-16 right-16 inline-flex h-[var(--deck-stamp-h)] items-center gap-6 rounded-full border border-hairline bg-surface-strong px-12 text-label text-ink"
        >
          <X className="size-16" />
          Pass
        </motion.span>
      </motion.div>
    </motion.div>
  );
}
