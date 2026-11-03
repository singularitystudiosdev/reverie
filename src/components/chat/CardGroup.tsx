/*
  A 'cards' message: ONE grouped card (her surface, radius-20) holding list
  rows, after the reference's product list: a 56px thumbnail (radius-12,
  cropped by the item's imagePosition / imageScale), a title, a subtitle and
  a muted meta line. Rows are list rows inside one card, never cards.
*/
import { clsx } from 'clsx';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type JSX } from 'react';
import { artSize } from '../../data/characters';
import type { CardItem } from '../../data/types';
import { dur, ease } from '../../lib/motion';

/** Local motion numbers: row stagger (s), rise (px), press squish. */
const motionSpec = { stagger: 0.06, rise: 8, press: 0.985 } as const;

export function CardGroup(props: { cards: CardItem[]; from: string; animateIn?: boolean }): JSX.Element {
  const reduce = useReducedMotion() ?? false;
  const list: Variants = {
    hidden: {},
    shown: { transition: { staggerChildren: reduce ? 0 : motionSpec.stagger } },
  };
  return (
    <motion.ul
      variants={list}
      initial={props.animateIn ? 'hidden' : false}
      animate="shown"
      whileTap={reduce ? undefined : { scale: motionSpec.press }}
      transition={{ duration: dur.quick, ease: ease.continuous }}
      style={{ originX: 0, originY: 0.5 }}
      aria-label={`${props.cards.length} ideas from ${props.from}`}
      data-slot="card-group"
      className="flex w-[var(--bubble-max)] flex-col rounded-20 bg-surface p-8 text-ink"
    >
      {props.cards.map((card) => (
        <CardRow key={card.title} card={card} reduce={reduce} />
      ))}
    </motion.ul>
  );
}

function CardRow(props: { card: CardItem; reduce: boolean }): JSX.Element {
  const { card, reduce } = props;
  const row: Variants = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: motionSpec.rise },
    shown: { opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.enter } },
  };
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const img = useRef<HTMLImageElement>(null);

  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setState('ready');
  }, [card.image]);

  return (
    <motion.li variants={row} className="flex items-center gap-12 p-8">
      <span className="relative size-[var(--thumb)] shrink-0 overflow-hidden rounded-12 bg-surface-strong">
        {card.image && state !== 'missing' ? (
          <img
            ref={img}
            src={card.image}
            alt=""
            width={artSize.sm.width}
            height={artSize.sm.height}
            decoding="async"
            loading="lazy"
            draggable={false}
            onLoad={() => setState('ready')}
            onError={() => setState('missing')}
            className={clsx(
              'size-full object-cover transition-opacity duration-[var(--duration-150)] ease-standard',
              state === 'ready' ? 'opacity-100' : 'opacity-0'
            )}
            style={{
              objectPosition: card.imagePosition,
              transform: card.imageScale ? `scale(${card.imageScale})` : undefined,
              transformOrigin: card.imagePosition,
            }}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-label">{card.title}</span>
        <span className="truncate text-caption">{card.subtitle}</span>
        <span className="truncate text-caption text-muted">{card.meta}</span>
      </span>
    </motion.li>
  );
}
