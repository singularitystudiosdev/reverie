/*
  Gallery sheet: every image and clip she has sent, in one place (v4, opened
  from the photos button at the top right of the chat header).
  - Sources, read from her messages: her video messages (the clip, autoplaying
    muted on a loop while on screen, no badge; reduced motion keeps the poster
    and a play badge) and every image in her cards messages (her scene / portrait plates).
    Deduplicated by source and shown newest first, two columns of 9:16 tiles.
  - Tapping a tile opens it full-frame INSIDE the same sheet: the media fills
    the sheet, with the sender ("From <Name>") and a close control that returns
    to the grid. A clip autoplays muted on a loop; a tap pauses or resumes it. Escape closes the preview first, then the sheet; the scrim and
    the header close control close the sheet.
  - Empty state: one sentence and one action back to the chat.
  - An opaque sheet (surface-solid, no blur), rendered into the frame's UI
    layer through a portal so it covers the floating tab bar. Focus moves in,
    Tab stays inside, and focus returns to the trigger on close.
  - Motion: the sheet enters on the base band from below and leaves on the
    quick band; the preview cross-fades; tiles stagger in (40ms, at most 8).
    Reduced motion: fades only, no autoplay, no stagger.
  - No title line: the grid starts right under the close control.
*/
import { clsx } from 'clsx';
import { Play, X } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { artSize } from '../data/characters';
import type { Character, Message } from '../data/types';
import { dur, ease, useReducedMotion } from '../lib/motion';
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
  const previewClose = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (preview) previewClose.current?.focus({ preventScroll: true });
  }, [preview]);

  const closePreview = () => {
    pendingTile.current = previewId;
    setPreviewId(null);
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
        <div data-slot="gallery-scrim" className="absolute inset-0 bg-[var(--scrim)]" onClick={onClose} />
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
            'pointer-events-auto flex w-full flex-col overflow-hidden rounded-t-20 border-t border-hairline surface-solid text-ink',
            'land:mx-auto land:max-w-[var(--sheet-max-w)]',
            preview ? 'h-[var(--sheet-max-h)]' : 'max-h-[var(--sheet-max-h)]'
          )}
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
          {preview ? (
            <div className="flex shrink-0 items-center justify-between gap-8 px-16 py-8">
              <p className="min-w-0 truncate text-label font-normal text-muted">From {character.name}</p>
              <button
                ref={previewClose}
                type="button"
                aria-label="Close preview"
                onClick={closePreview}
                className={clsx(
                  stateLayer,
                  'relative grid size-[var(--target-touch)] shrink-0 place-items-center rounded-full text-ink'
                )}
              >
                <X aria-hidden="true" className="size-20" />
              </button>
            </div>
          ) : (
            <header className="flex shrink-0 items-center justify-end px-16 pt-8">
              <button
                type="button"
                aria-label={`Close ${character.name}'s gallery`}
                onClick={onClose}
                className={clsx(
                  stateLayer,
                  'relative grid size-[var(--target-touch)] shrink-0 place-items-center rounded-full text-ink'
                )}
              >
                <X aria-hidden="true" className="size-20" />
              </button>
            </header>
          )}

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
              <Preview key="preview" item={preview} character={character} />
            ) : (
              <Grid
                key="grid"
                character={character}
                items={items}
                active={isPresent}
                reduce={reduce}
                onClose={onClose}
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
  onClose(): void;
  onPreview(id: string): void;
  registerTile(id: string, el: HTMLButtonElement | null): void;
}): JSX.Element {
  const { character, items, active, reduce, onClose, onPreview, registerTile } = props;

  if (items.length === 0) {
    return (
      <div
        key="empty"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-16 px-24 pt-16 pb-[calc(var(--spacing-24)+var(--safe-bottom))] text-center"
      >
        <p className="max-w-[var(--measure)] text-body text-muted">Photos and clips she sends will show up here.</p>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[var(--target)] rounded-full bg-accent px-24 text-label text-on-accent"
        >
          Back to chat
        </button>
      </div>
    );
  }

  return (
    <ul
      key="grid"
      aria-label={`Media from ${character.name}`}
      className="grid min-h-0 flex-1 grid-cols-2 content-start gap-8 overflow-y-auto overscroll-contain px-16 pt-8 pb-[calc(var(--spacing-24)+var(--safe-bottom))]"
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
            onClick={() => onPreview(item.id)}
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

function Preview(props: { item: GalleryItem; character: Character }): JSX.Element {
  const { item, character } = props;
  return (
    <div key="preview-body" className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-[var(--t-canvas)]">
        {item.kind === 'video' ? (
          <PreviewVideo item={item} name={character.name} />
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
function PreviewVideo(props: { item: GalleryItem; name: string }): JSX.Element {
  const { item, name } = props;
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
    if (!el) return;
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
