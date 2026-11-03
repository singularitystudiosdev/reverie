/*
  Three dots that brighten in turn while she types: each dot tweens its fill
  from muted to ink and back, a quick-band step apart. Color only, nothing
  moves; under reduced motion the dots hold still in muted. Decorative: the
  caller renders the words ("typing") for assistive tech.
*/
import { clsx } from 'clsx';
import { motion } from 'motion/react';
import type { JSX } from 'react';
import { dur, ease, useReducedMotion } from '../../lib/motion';

const dots = ['first', 'second', 'third'] as const;

export function TypingDots(props: { size: 'sm' | 'md'; className?: string }): JSX.Element {
  const reduce = useReducedMotion();
  return (
    <span
      aria-hidden="true"
      data-slot="typing-dots"
      className={clsx('inline-flex shrink-0 items-center gap-4', props.className)}
    >
      {dots.map((dot, i) => (
        <motion.span
          key={dot}
          className={clsx('rounded-full bg-muted', props.size === 'sm' ? 'size-6' : 'size-8')}
          animate={reduce ? undefined : { backgroundColor: ['var(--t-muted)', 'var(--t-ink)'] }}
          transition={
            reduce
              ? undefined
              : {
                  duration: dur.deliberate /* deliberate */,
                  ease: ease.continuous,
                  repeat: Infinity,
                  repeatType: 'reverse',
                  delay: i * dur.quick,
                }
          }
        />
      ))}
    </span>
  );
}
