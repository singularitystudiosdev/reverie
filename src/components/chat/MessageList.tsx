/*
  The conversation: her bubbles left on her surface, mine right on `me`
  (radius-20, 16px body), the grouped card message, her video message (a
  rounded 9:16 clip: poster until played, muted, playsInline, tap to pause,
  no caption line under it in v4), and the typing bubble.
  - Arrival is an event, not an entrance: a text bubble that lands after mount
    springs in (scale .92 to 1 from its own side, a slight rise); a clip or
    card group fades up; the history present at mount renders still. The typing
    bubble leaves the flow as it fades so her reply takes its slot (a
    crossfade, no jump). A tap squishes a bubble gently. Reduced motion: a
    fade only, no squish.
  - Spacing groups a run of one sender (4px) and opens up between senders.
  - Auto-scroll: the newest message stays in view (instant on mount and under
    reduced motion, smooth otherwise), and a resize (the keyboard opening)
    keeps the bottom pinned when it was pinned.
  - role="log": new messages are announced politely; the typing state is a
    hidden status line, not the dots.
*/
import { clsx } from 'clsx';
import { Play } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { Character, Message } from '../../data/types';
import { dur, ease } from '../../lib/motion';
import { CardGroup } from './CardGroup';
import { TypingDots } from './TypingDots';

/** Local motion numbers: the rise in px (transform only), the entering scale, the press squish. */
const motionSpec = {
  rise: 8,
  scaleFrom: 0.92,
  press: 0.97,
  pressVideo: 0.98,
  spring: { type: 'spring', stiffness: 380, damping: 28, mass: 0.8 },
} as const;

export function MessageList(props: { character: Character; messages: Message[]; typing: boolean }): JSX.Element {
  const { character, messages, typing } = props;
  const reduce = useReducedMotion() ?? false;
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const mounted = useRef(false);

  // Messages already here at mount never animate.
  const [history] = useState(() => new Set(messages.map((m) => m.id)));

  // Text bubbles spring in from their own side; clips and cards fade up.
  const fadeUp = reduce ? { opacity: 0 } : { opacity: 0, y: motionSpec.rise };
  const springFrom = (mine: boolean) =>
    reduce ? { opacity: 0 } : { opacity: 0, y: motionSpec.rise, scale: motionSpec.scaleFrom, originX: mine ? 1 : 0, originY: 1 };
  const arrive: TargetAndTransition = {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: reduce
      ? { duration: dur.quick, ease: ease.enter }
      : { default: motionSpec.spring, opacity: { duration: dur.base, ease: ease.enter } },
  };
  const arriveFade: TargetAndTransition = {
    opacity: 1,
    y: 0,
    transition: { duration: dur.base, ease: ease.enter },
  };
  const leave: TargetAndTransition = { opacity: 0, transition: { duration: dur.quick, ease: ease.exit } };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollHeight;
    if (!mounted.current || reduce) el.scrollTop = top;
    else el.scrollTo({ top, behavior: 'smooth' });
    mounted.current = true;
    pinned.current = true;
  }, [messages.length, typing, reduce]);

  // Keep the newest message in view when the viewport shrinks (keyboard).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight;
    };
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={scroller}
      role="log"
      aria-label={`Messages with ${character.name}`}
      tabIndex={0}
      data-slot="message-list"
      className="safe-x min-h-0 flex-1 overflow-y-auto py-16 [mask-image:linear-gradient(to_bottom,transparent,black_var(--spacing-32),black_calc(100%-var(--gutter)),transparent)]"
    >
      <ol className="relative flex min-h-full flex-col justify-end">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const mine = m.from === 'me';
          const plain = !((m.kind === 'cards' && m.cards?.length) || (m.kind === 'video' && m.src));
          const fresh = !history.has(m.id);
          return (
            <motion.li
              key={m.id}
              initial={fresh ? (plain ? springFrom(mine) : fadeUp) : false}
              animate={plain ? arrive : arriveFade}
              className={clsx(
                'flex',
                mine ? 'justify-end' : 'justify-start',
                !prev ? '' : prev.from === m.from ? 'mt-4' : 'mt-12'
              )}
            >
              <MessageBody message={m} character={character} fresh={fresh} reduce={reduce} />
            </motion.li>
          );
        })}
        {/* popLayout: the dots leave the flow as they fade, so her reply lands in the same slot (a crossfade, no jump). */}
        <AnimatePresence initial={false} mode="popLayout">
          {typing ? (
            <motion.li
              key="typing"
              initial={springFrom(false)}
              animate={arrive}
              exit={leave}
              className={clsx('flex justify-start', messages.length ? 'mt-12' : '')}
            >
              <span className="inline-flex rounded-20 bg-surface px-16 py-12" data-slot="typing-bubble">
                <span className="flex h-[var(--text-body--line-height)] items-center">
                  <TypingDots size="md" />
                </span>
              </span>
            </motion.li>
          ) : null}
        </AnimatePresence>
      </ol>
      <p role="status" className="sr-only">
        {typing ? `${character.name} is typing` : ''}
      </p>
    </div>
  );
}

function MessageBody(props: { message: Message; character: Character; fresh: boolean; reduce: boolean }): JSX.Element {
  const { message, character, fresh, reduce } = props;
  if (message.kind === 'cards' && message.cards?.length) {
    return <CardGroup cards={message.cards} from={character.name} animateIn={fresh} />;
  }
  if (message.kind === 'video' && message.src) {
    return <VideoBubble message={message} name={character.name} reduce={reduce} />;
  }
  const mine = message.from === 'me';
  return (
    <motion.p
      whileTap={reduce ? undefined : { scale: motionSpec.press }}
      transition={{ duration: dur.quick, ease: ease.continuous }}
      style={{ originX: mine ? 1 : 0, originY: 0.5 }}
      className={clsx(
        'max-w-[var(--bubble-max)] rounded-20 px-16 py-12 text-body [overflow-wrap:anywhere]',
        mine ? 'bg-me text-on-me' : 'bg-surface text-ink'
      )}
    >
      {mine ? <span className="sr-only">You: </span> : <span className="sr-only">{character.name}: </span>}
      {message.text}
    </motion.p>
  );
}

/**
 * Her clip: a 9:16 video message, about 220px wide, radius-20. The poster is
 * what shows until the user presses play; the clip is muted and playsInline
 * with no controls chrome. Tap the frame to play or pause. It never autoplays
 * (so reduced motion always gets the poster and a play button). The bubble is
 * the video alone: v4 removed the caption line that used to sit under it.
 */
function VideoBubble(props: { message: Message; name: string; reduce: boolean }): JSX.Element {
  const { message, name, reduce } = props;
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      setStarted(true);
      void el
        .play()
        .then(() => setPlaying(true))
        .catch(() => {
          setStarted(false);
          setPlaying(false);
        });
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const label = playing ? `Pause ${name}'s video message` : `Play ${name}'s video message`;

  return (
    <motion.div
      data-slot="video-message"
      whileTap={reduce ? undefined : { scale: motionSpec.pressVideo }}
      transition={{ duration: dur.quick, ease: ease.continuous }}
      style={{ originX: 0, originY: 0.5 }}
      className="w-224 overflow-hidden rounded-20 border border-hairline bg-surface shadow-8"
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={playing}
        className="relative block w-full cursor-pointer"
        style={{ aspectRatio: message.aspect ?? 9 / 16 }}
      >
        {message.poster ? (
          <img
            src={message.poster}
            alt=""
            aria-hidden="true"
            width={360}
            height={640}
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
        <video
          ref={video}
          src={message.src}
          poster={message.poster}
          aria-hidden="true"
          muted
          playsInline
          loop
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => {
            setStarted(false);
            setPlaying(false);
          }}
          className={clsx(
            'absolute inset-0 size-full object-cover transition-opacity duration-[var(--duration-150)] ease-standard motion-reduce:transition-none',
            started ? 'opacity-100' : 'opacity-0'
          )}
        />
        <span
          aria-hidden="true"
          className={clsx(
            'absolute inset-0 grid place-items-center bg-[color-mix(in_oklab,var(--t-ink)_16%,transparent)] transition-opacity duration-[var(--duration-150)] ease-standard motion-reduce:transition-none',
            playing ? 'opacity-0' : 'opacity-100'
          )}
        >
          <span className="grid size-[var(--target-touch)] place-items-center rounded-full bg-surface-strong/90 text-ink shadow-8">
            <Play aria-hidden="true" className="size-20 translate-x-1" />
          </span>
        </span>
      </button>
    </motion.div>
  );
}
