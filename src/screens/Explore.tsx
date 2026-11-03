/*
  Explore: the swipe deck. No visible title (v4): an sr-only heading still names
  the section, so the card takes the space the heading held. The top card with
  the next one behind it (her animated portrait, see Portrait), and two round
  liquid glass buttons (X passes, check likes), the only two actions. Drag the
  card, tap the buttons, or press Left / Right. There are no filters: the card
  takes the height the style chips and the title used to hold.

  Atmosphere (RTPC): the top card's world is the frame's theme. While the top
  card is dragged, `drag` follows its offset over the commit threshold and the
  next card's world shows through under the finger (setPreview weight =
  |drag|). A cancelled drag eases both back to 0 and leaves the next world
  armed; a commit gusts, then the new top card's theme is set (the engine
  promotes the armed preview). An empty deck is the base theme. A match never
  touches the deck: the match notification (MatchNotice) drops over the top of
  the frame in HER palette and leaves Explore live under it, so a like advances
  the deck exactly like a pass.

  Entrance: the top card rises in, once, on the first visit (not under reduced
  motion).

  A short screen (`short:`, measured on the section itself) tightens the
  gutters and uses the smaller round buttons so the card keeps its height.
*/
import { Check, X } from 'lucide-react';
import { motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, type JSX } from 'react';
import { EmptyDeck } from '../components/explore/EmptyDeck';
import { SwipeCard, type SwipeCardHandle } from '../components/explore/SwipeCard';
import { deckConfig, type SwipeDir } from '../components/explore/deckConfig';
import { dur, ease, pulseStrength, spring } from '../lib/motion';
import { useApp, useDeck } from '../state/store';
import { useFrameTheme } from '../theme/ThemeProvider';

export function Explore(): JSX.Element {
  const { state, actions } = useApp();
  const deck = useDeck();
  const top = deck[0];
  const next = deck[1];
  const { setTheme, setPreview, setParam, pulse } = useFrameTheme();
  const reduce = useReducedMotion() ?? false;

  const progress = useMotionValue(0);
  const topHandle = useRef<SwipeCardHandle>(null);
  const entered = useRef(false);
  useEffect(() => {
    entered.current = true;
  }, []);

  // The focus world: the top card's, or base when the deck is empty.
  useEffect(() => {
    if (top) setTheme(top.theme, top.scene);
    else setTheme('base');
  }, [top, setTheme]);

  // Arm (and pre-decode) the world the frame goes to next: the second card, at
  // weight 0. Order matters: this runs AFTER the focus-world effect above,
  // because setTheme to the armed world is what promotes it, and re-arming
  // first would replace it. On a commit (a pass or a like, instant match or
  // not) the deck advances, the effect above sets the new top's theme = the
  // armed one, then this re-arms the card behind it.
  useEffect(() => {
    if (next) setPreview(next.theme, next.scene, 0);
    else setPreview(null);
  }, [next, setPreview]);

  // Leaving Explore disarms the preview and releases the drag.
  useEffect(
    () => () => {
      setPreview(null);
      setParam('drag', 0);
    },
    [setPreview, setParam]
  );

  // The deck advanced: the next card is now the top card, at rest.
  useLayoutEffect(() => {
    progress.set(0);
    setParam('drag', 0);
  }, [top?.id, progress, setParam]);

  const onDrag = useCallback(
    (d: number) => {
      setParam('drag', d);
      progress.set(Math.abs(d));
      if (next) setPreview(next.theme, next.scene, Math.abs(d));
    },
    [next, progress, setParam, setPreview]
  );

  const onCommitStart = useCallback(() => {
    pulse('gust', pulseStrength.cardCommit);
  }, [pulse]);

  const decide = useCallback(
    (id: string, dir: SwipeDir) => {
      if (dir === 'like') actions.like(id);
      else actions.pass(id);
    },
    [actions]
  );

  // Left = pass, Right = like: a 150ms fade only, no fly.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (!top || state.profileId) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      e.preventDefault();
      topHandle.current?.swipe(e.key === 'ArrowRight' ? 'like' : 'pass', 'fade');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [top, state.profileId]);

  const cards = deck.slice(0, 2);
  const rise = !reduce && !entered.current;

  return (
    <section
      aria-labelledby="explore-title"
      className="flex h-full flex-col pt-[var(--statusbar-h)] pb-[var(--tabbar-h)] [container-type:size]"
    >
      <h1 id="explore-title" className="sr-only">
        Explore
      </h1>

      {top ? (
        <>
          <motion.div
            className="safe-x min-h-0 flex-1 pt-16 pb-[var(--deck-peek)] short:pt-8"
            initial={rise ? { opacity: 0, y: deckConfig.riseY } : false}
            animate={{
              opacity: 1,
              y: 0,
              transition: {
                opacity: { duration: dur.base, ease: ease.enter },
                y: spring.gentle,
              },
            }}
          >
            {/* The card sizes from the room it has: full width, but never wider
                than 3:4 of its height, so a short phone keeps a portrait card. */}
            <div className="size-full [container-type:size]">
              <div className="relative mx-auto h-full w-[min(100cqw,calc(100cqh*var(--deck-card-ratio)))]">
              {cards.map((c, i) => (
                <SwipeCard
                  key={c.id}
                  ref={i === 0 ? topHandle : undefined}
                  character={c}
                  isTop={i === 0}
                  progress={progress}
                  onDrag={onDrag}
                  onCommitStart={onCommitStart}
                  onDecide={(dir) => decide(c.id, dir)}
                  onOpen={() => actions.openProfile(c.id)}
                />
              ))}
              </div>
            </div>
          </motion.div>
          <p aria-live="polite" className="sr-only">
            {`${top.name}, ${top.kind}`}
          </p>
          <div className="flex items-center justify-center gap-24 pt-12 pb-12 short:pt-8 short:pb-8">
            <button
              type="button"
              aria-label={`Pass on ${top.name}`}
              onClick={() => topHandle.current?.swipe('pass', 'fly')}
              className="deck-button liquid-glass grid size-[var(--deck-button)] short:size-[var(--deck-button-short)] place-items-center rounded-full"
            >
              <X aria-hidden="true" className="size-24" />
            </button>
            <button
              type="button"
              aria-label={`Like ${top.name}`}
              onClick={() => topHandle.current?.swipe('like', 'fly')}
              className="deck-button deck-button--like liquid-glass liquid-glass--accent grid size-[var(--deck-button)] short:size-[var(--deck-button-short)] place-items-center rounded-full"
            >
              <Check aria-hidden="true" className="size-24" />
            </button>
          </div>
        </>
      ) : (
        <EmptyDeck />
      )}
    </section>
  );
}
