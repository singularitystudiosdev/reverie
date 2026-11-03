/*
  Explore: the swipe deck. A title, the style filter, the top card with the
  next one behind it, and two round buttons (X passes, check likes), the only
  two actions. Drag the card, tap the buttons, or press Left / Right.

  Atmosphere (RTPC): the top card's world is the frame's theme. While the top
  card is dragged, `drag` follows its offset over the commit threshold and the
  next card's world shows through under the finger (setPreview weight =
  |drag|). A cancelled drag eases both back to 0 and leaves the next world
  armed; a commit gusts, then the new top card's theme is set (the engine
  promotes the armed preview). An empty deck is the base theme. While a match
  moment shows, the overlay owns the theme, and the preview stays armed on the
  top card (the deck has already advanced under it) so "Keep exploring"
  promotes that decoded world instead of cold-crossfading to it.

  Entrance: the top card rises in, once, on the first visit (not under reduced
  motion).

  A short landscape screen (`land:`) is too short for one column: the card takes
  the left column at full height, the title, filter and buttons the right.
*/
import { Check, X } from 'lucide-react';
import { motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, type JSX } from 'react';
import { EmptyDeck } from '../components/explore/EmptyDeck';
import { StyleFilter } from '../components/explore/StyleFilter';
import { SwipeCard, type SwipeCardHandle } from '../components/explore/SwipeCard';
import { deckConfig, type SwipeDir } from '../components/explore/deckConfig';
import { cn } from '../lib/cn';
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
    if (state.pendingMatchId) return;
    if (top) setTheme(top.theme, top.scene);
    else setTheme('base');
  }, [top, state.pendingMatchId, setTheme]);

  // Arm (and pre-decode) the world the frame goes to next, at weight 0. Order
  // matters: this runs AFTER the focus-world effect above, because setTheme to
  // the armed world is what promotes it, and re-arming first would replace it.
  // - Normally that is the second card (drag-commit: the deck advances, the
  //   effect above sets the new top's theme = the armed one, then this re-arms
  //   the card behind it).
  // - While a match moment shows, the liked card is already gone from the deck
  //   and the overlay owns the theme, so the world to come back to is the top
  //   card's. Arming the second card here would drop that world; on dismissal
  //   (pendingMatchId clears, effect above sets top's theme, this re-arms the
  //   second card) the engine promotes the armed top world instead.
  const armTarget = state.pendingMatchId ? top : next;
  useEffect(() => {
    if (armTarget) setPreview(armTarget.theme, armTarget.scene, 0);
    else setPreview(null);
  }, [armTarget, setPreview]);

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
      if (!top || state.pendingMatchId || state.profileId) return;
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
  }, [top, state.pendingMatchId, state.profileId]);

  const cards = deck.slice(0, 2);
  const rise = !reduce && !entered.current;

  return (
    <section
      aria-labelledby="explore-title"
      inert={!!state.pendingMatchId}
      className={cn(
        'flex h-full flex-col pt-[var(--statusbar-h)] pb-[var(--tabbar-h)]',
        // Land: the section carries the safe insets (rail and notch) and its
        // columns reset them, so each column keeps the plain gutter.
        top &&
          'land:grid land:grid-cols-2 land:grid-rows-[auto_minmax(0,1fr)] land:gap-x-16 land:pr-[var(--safe-right)] land:pl-[var(--safe-left)] land:*:[--safe-left:var(--inset-none)] land:*:[--safe-right:var(--inset-none)]',
        // The match moment owns the frame: the deck steps back behind it.
        'transition-opacity duration-[var(--duration-300)] ease-standard motion-reduce:transition-none',
        state.pendingMatchId && 'opacity-0'
      )}
    >
      <div className="land:col-start-2 land:row-start-1 land:min-w-0">
        <header className="safe-x pt-16 pb-8">
          <h1 id="explore-title" className="font-display text-title text-ink">
            Explore
          </h1>
        </header>
        <StyleFilter value={state.filter} onChange={actions.setFilter} />
      </div>

      {top ? (
        <>
          <motion.div
            className="safe-x min-h-0 flex-1 pt-12 pb-[var(--deck-peek)] land:col-start-1 land:row-span-2 land:row-start-1 land:px-0"
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
            <div className="relative size-full">
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
          </motion.div>
          <p aria-live="polite" className="sr-only">
            {`${top.name}, ${top.kind}`}
          </p>
          <div className="flex items-center justify-center gap-24 pt-12 pb-12 land:col-start-2 land:row-start-2 land:self-center">
            <button
              type="button"
              aria-label={`Pass on ${top.name}`}
              onClick={() => topHandle.current?.swipe('pass', 'fly')}
              className="grid size-[var(--deck-button)] place-items-center rounded-full border border-hairline bg-surface-strong text-ink transition-opacity duration-[var(--duration-150)] ease-standard active:opacity-80"
            >
              <X aria-hidden="true" className="size-24" />
            </button>
            <button
              type="button"
              aria-label={`Like ${top.name}`}
              onClick={() => topHandle.current?.swipe('like', 'fly')}
              className="grid size-[var(--deck-button)] place-items-center rounded-full bg-accent text-on-accent transition-opacity duration-[var(--duration-150)] ease-standard active:opacity-80"
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
