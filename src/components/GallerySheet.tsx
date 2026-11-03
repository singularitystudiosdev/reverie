/*
  Gallery sheet: every image and clip she has sent, in one place (v4, opened
  from the photos button at the top right of the chat header, which only
  exists once she has sent a first image or clip: hasGalleryMedia).
  - Sources, read from her messages: her video messages (the clip, autoplaying
    muted on a loop while on screen, no badge) and every image in her cards
    messages (her scene / portrait plates). Deduplicated by source and shown
    newest first, two columns of 9:16 tiles.
  - Tapping a tile opens it full-frame INSIDE the same sheet: the media fills
    the sheet. A clip autoplays muted on a loop; a tap pauses or resumes it.
  - No close button anywhere, like the profile sheet (ProfileSheet.tsx): a swipe
    that starts anywhere on the sheet, or on the scrim above it, drags the sheet
    and tracks the finger directly; on release the position is projected along
    the velocity and the nearer rest wins. Past the midpoint a grid closes the
    sheet and a full-frame preview returns to the grid. A tap on the scrim that
    did not drag closes the sheet. Escape returns from a preview to the grid,
    then closes the sheet. When the grid is taller than the sheet it scrolls
    natively, so a swipe that starts on it scrolls; the grabber strip above it
    and the scrim stay drag sources.
  - An opaque sheet (surface-solid, no blur), rendered into the frame's UI
    layer through a portal so it covers the floating tab bar. Focus moves in,
    Tab stays inside, and focus returns to the trigger on close.
  - Motion: the sheet enters on the base band from below and leaves on the
    quick band; the preview cross-fades; tiles stagger in (40ms, at most 8).
*/
import { clsx } from 'clsx';
import { Play } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useDragControls,
  useIsPresent,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'motion/react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { artSize } from '../data/characters';
import type { Character, Message } from '../data/types';
import { dur, ease, spring, useReducedMotion } from '../lib/motion';
import { useApp } from '../state/store';
import { trapTab } from './chat/focus';
import { stateLayer } from './chat/stateLayer';

interface GalleryItem {
  id: string;
  kind: 'video' | 'image';
  src: string;
  poster?: string;
  label: string;
}

/** Her sent media, newest first: clips and the plates inside her cards. */
function galleryItems(messages: Message[]): GalleryItem[] {
  const seen = new Set<string>();
  const out: GalleryItem[] = [];
  for (const message of messages) {
    if (message.from !== 'her') continue;
    if (message.kind === 'video' && message.src && !seen.has(message.src)) {
      seen.add(message.src);
      out.push({ id: message.id, kind: 'video', src: message.src, poster: message.poster, label: 'Video message' });
    }
    if (message.kind === 'cards') {
      for (const card of message.cards ?? []) {
        if (!card.image || seen.has(card.image)) continue;
        seen.add(card.image);
        out.push({ id: `${message.id}:${card.title}`, kind: 'image', src: card.image, label: card.title });
      }
    }
  }
  return out.reverse();
}

/** True once she has sent at least one clip or image card in this chat. */
export function hasGalleryMedia(messages: Message[]): boolean {
  return galleryItems(messages).length > 0;
}

export function GallerySheet(props: {
  character: Character;
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose(): void;
}): JSX.Element {
  const { character, open, anchor, onClose } = props;
  const { state } = useApp();
  const reduce = useReducedMotion();

  // The frame's UI layer (the direct child of [data-frame]) holds the screen
  // stack and the tab bar. The gallery is portaled there, after the tab bar
  // and at z-25, so it covers it and still inherits the current --t-* theme.
  const host =
    anchor.current?.closest('main')?.parentElement ??
    document.querySelector<HTMLElement>('[data-frame] > div.relative.isolate');

  const messages = state.conversations[character.id]?.messages ?? [];
  const items = useMemo(() => galleryItems(messages), [messages]);

  const layer = (
    <AnimatePresence>
      {open ? (
        <Sheet key={character.id} character={character} items={items} reduce={reduce} onClose={onClose} />
      ) : null}
    </AnimatePresence>
  );

  return host ? createPortal(layer, host) : layer;
}

function Sheet(props: {
  character: Character;
  items: GalleryItem[];
  reduce: boolean;
  onClose(): void;
}): JSX.Element {
  const { character, items, reduce, onClose } = props;
  const isPresent = useIsPresent();
  const dialog = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const tiles = useRef(new Map<string, HTMLButtonElement>());
  const pendingTile = useRef<string | null>(null);

  const preview = previewId ? items.find((item) => item.id === previewId) : undefined;

  useEffect(() => {
    if (!returnTo.current && document.activeElement instanceof HTMLElement) {
      returnTo.current = document.activeElement;
    }
    dialog.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!isPresent) returnTo.current?.focus({ preventScroll: true });
  }, [isPresent]);

  // A preview opens with focus on the sheet itself (it has no controls of its own to land on).
  useEffect(() => {
    if (preview) dialog.current?.focus({ preventScroll: true });
  }, [preview]);

  // The drag offset (px). The scrim lightens as the sheet is pulled down.
  const y = useMotionValue(0);
  const scrimOpacity = useTransform(y, (v: number | string) => {
    const h = dialog.current?.offsetHeight;
    return typeof v === 'number' && h ? Math.max(0, 1 - v / h) : 1;
  });
  const controls = useDragControls();

  // `dragged` keeps a swipe that ends over the scrim, a tile or the clip from also counting as a tap.
  const dragged = useRef(false);
  const startDrag = (e: ReactPointerEvent) => {
    dragged.current = false;
    controls.start(e);
  };

  const closePreview = () => {
    pendingTile.current = previewId;
    setPreviewId(null);
  };

  // Release: project along the velocity; the nearer rest wins. Past the
  // midpoint a grid closes the sheet and a preview steps back to the grid.
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const h = dialog.current?.offsetHeight ?? 0;
    const projected = info.offset.y + info.velocity.y * dur.base;
    if (Math.abs(h - projected) >= Math.abs(projected)) return;
    if (previewId) closePreview();
    else onClose();
  };

  useEffect(() => {
    if (!isPresent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (previewId) closePreview();
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // closePreview is a local setter over the current id; the id is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent, previewId, onClose]);

  return (
    <motion.div key="gallery" data-slot="gallery-layer" className="absolute inset-0 z-25">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: dur.base, ease: ease.enter } }}
        exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
      >
        <motion.div
          data-slot="gallery-scrim"
          className="absolute inset-0 touch-none bg-[var(--scrim)]"
          style={{ opacity: scrimOpacity }}
          onPointerDown={startDrag}
          onClick={() => {
            if (!dragged.current) onClose();
          }}
        />
      </motion.div>

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end">
        <motion.div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-label={preview ? `Media from ${character.name}` : `${character.name}'s gallery`}
          tabIndex={-1}
          onKeyDown={trapTab}
          data-slot="gallery-sheet"
          className={clsx(
            'pointer-events-auto flex w-full touch-none flex-col overflow-hidden overscroll-contain rounded-t-20 border-t border-hairline surface-solid text-ink select-none',
            'land:mx-auto land:max-w-[var(--sheet-max-w)]',
            preview ? 'h-[var(--sheet-max-h)]' : 'max-h-[var(--sheet-max-h)]'
          )}
          style={{ y }}
          onPointerDown={startDrag}
          onDragStart={() => {
            dragged.current = true;
          }}
          drag="y"
          dragListener={false}
          dragControls={controls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 1 }}
          dragMomentum={false}
          dragTransition={{ bounceStiffness: spring.snappy.stiffness, bounceDamping: spring.snappy.damping }}
          onDragEnd={onDragEnd}
          initial={reduce ? { opacity: 0 } : { y: '100%' }}
          animate={
            reduce
              ? { opacity: 1, transition: { duration: dur.quick } }
              : { y: 0, transition: { duration: dur.base, ease: ease.enter } }
          }
          exit={
            reduce
              ? { opacity: 0, transition: { duration: dur.quick } }
              : { y: '100%', transition: { duration: dur.quick, ease: ease.exit } }
          }
        >
          <div aria-hidden="true" className="flex shrink-0 justify-center pt-8 pb-12">
            <span className="h-4 w-32 rounded-full bg-muted opacity-60" />
          </div>

          <AnimatePresence
            mode="wait"
            initial={false}
            onExitComplete={() => {
              const id = pendingTile.current;
              if (!id) return;
              tiles.current.get(id)?.focus({ preventScroll: true });
              pendingTile.current = null;
            }}
          >
            {preview ? (
              <Preview key="preview" item={preview} character={character} dragged={dragged} />
            ) : (
              <Grid
                key="grid"
                character={character}
                items={items}
                active={isPresent}
                reduce={reduce}
                dragged={dragged}
                onPreview={setPreviewId}
                registerTile={(id, el) => {
                  if (el) tiles.current.set(id, el);
                  else tiles.current.delete(id);
                }}
              />
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.div>
  );
}

function Grid(props: {
  character: Character;
  items: GalleryItem[];
  /** False once the sheet is leaving: every tile clip pauses. */
  active: boolean;
  reduce: boolean;
  dragged: MutableRefObject<boolean>;
  onPreview(id: string): void;
  registerTile(id: string, el: HTMLButtonElement | null): void;
}): JSX.Element {
  const { character, items, active, reduce, dragged, onPreview, registerTile } = props;
  const list = useRef<HTMLUListElement>(null);
  // A grid taller than the sheet scrolls natively (a swipe that starts on it
  // scrolls); a grid that fits hands the swipe to the sheet.
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const update = () => setScrolls(el.scrollHeight > el.clientHeight + 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  return (
    <ul
      ref={list}
      key="grid"
      aria-label={`Media from ${character.name}`}
      onPointerDown={scrolls ? (e) => e.stopPropagation() : undefined}
      className={clsx(
        'grid min-h-0 flex-1 grid-cols-2 content-start gap-8 overflow-y-auto overscroll-contain px-16 pb-[calc(var(--spacing-24)+var(--safe-bottom))]',
        scrolls ? 'touch-pan-y' : 'touch-none'
      )}
    >
      {items.map((item, index) => (
        <motion.li
          key={item.id}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: dur.base, ease: ease.enter, delay: Math.min(index, 7) * 0.04 },
          }}
        >
          <button
            ref={(el) => registerTile(item.id, el)}
            type="button"
            onClick={() => {
              if (!dragged.current) onPreview(item.id);
            }}
            aria-label={
              item.kind === 'video'
                ? `Play ${character.name}'s video message`
                : `Open ${item.label} from ${character.name}`
            }
            className={clsx(
              stateLayer,
              'relative block w-full overflow-hidden rounded-12 border border-hairline bg-surface-strong'
            )}
            style={{ aspectRatio: 'var(--aspect-media)' }}
          >
            {item.kind === 'video' ? (
              <TileVideo item={item} active={active} reduce={reduce} />
            ) : (
              <img
                src={item.src}
                alt=""
                aria-hidden="true"
                width={artSize.sm.width}
                height={artSize.sm.height}
                decoding="async"
                loading="lazy"
                draggable={false}
                className="absolute inset-0 size-full object-cover"
              />
            )}
            {item.kind === 'video' && reduce ? (
              <span
                aria-hidden="true"
                className="absolute inset-0 grid place-items-center bg-[color-mix(in_oklab,var(--t-ink)_var(--media-veil-mix),transparent)]"
              >
                <span className="grid size-[var(--target-touch)] place-items-center rounded-full bg-surface-strong text-ink shadow-8">
                  <Play aria-hidden="true" className="size-20 translate-x-1" />
                </span>
              </span>
            ) : null}
          </button>
        </motion.li>
      ))}
    </ul>
  );
}

/**
 * A grid clip: muted, looping, no controls, playing only while it is on screen
 * and the sheet is open. Reduced motion keeps the poster and never plays.
 */
function TileVideo(props: { item: GalleryItem; active: boolean; reduce: boolean }): JSX.Element {
  const { item, active, reduce } = props;
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el || reduce) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), {
      threshold: 0.25,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduce]);

  useEffect(() => {
    const el = video.current;
    if (!el || reduce) return;
    if (visible && active) void el.play().catch(() => undefined);
    else el.pause();
  }, [visible, active, reduce]);

  return (
    <video
      ref={video}
      src={item.src}
      poster={item.poster}
      aria-hidden="true"
      muted
      loop
      playsInline
      preload={reduce ? 'metadata' : 'auto'}
      className="absolute inset-0 size-full object-cover"
    />
  );
}

function Preview(props: {
  item: GalleryItem;
  character: Character;
  dragged: MutableRefObject<boolean>;
}): JSX.Element {
  const { item, character, dragged } = props;
  return (
    <div key="preview-body" className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-[var(--t-canvas)]">
        {item.kind === 'video' ? (
          <PreviewVideo item={item} name={character.name} dragged={dragged} />
        ) : (
          <img
            key={item.src}
            src={item.src}
            alt={`${character.name}: ${item.label}`}
            width={artSize.sm.width}
            height={artSize.sm.height}
            decoding="async"
            draggable={false}
            className="size-full object-contain"
          />
        )}
      </div>
    </div>
  );
}

/**
 * The clip, full-frame: autoplays muted on a loop with no browser chrome; a
 * tap pauses or resumes. Reduced motion keeps the poster and a play control
 * until the user starts it.
 */
function PreviewVideo(props: {
  item: GalleryItem;
  name: string;
  dragged: MutableRefObject<boolean>;
}): JSX.Element {
  const { item, name, dragged } = props;
  const reduce = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el || reduce) return;
    void el.play().catch(() => undefined);
  }, [reduce]);

  const toggle = () => {
    const el = video.current;
    if (!el || dragged.current) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  return (
    <div className="relative size-full">
      <video
        ref={video}
        src={item.src}
        poster={item.poster}
        aria-hidden="true"
        muted
        loop
        playsInline
        autoPlay={!reduce}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setPlaying(false)}
        className="size-full object-contain"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `Pause ${name}'s video message` : `Play ${name}'s video message`}
        aria-pressed={playing}
        className="absolute inset-0 grid place-items-center"
      >
        <span
          aria-hidden="true"
          className={clsx(
            'grid size-[var(--target-touch)] place-items-center rounded-full bg-surface-strong text-ink shadow-8',
            'transition-opacity duration-[var(--duration-150)] ease-standard',
            playing ? 'opacity-0' : 'opacity-100'
          )}
        >
          <Play aria-hidden="true" className="size-20 translate-x-1" />
        </span>
      </button>
    </div>
  );
}
