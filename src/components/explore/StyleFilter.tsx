/*
  The style filter: a horizontally scrolling row of chips (All plus the five
  styles). One is pressed at a time; choosing one narrows the deck.
*/
import type { JSX } from 'react';
import type { StyleFilter as StyleFilterValue } from '../../data/types';
import { cn } from '../../lib/cn';
import './explore.css';

export const styleFilters: StyleFilterValue[] = ['All', 'Anime', 'Goth', 'Realistic', 'Cartoon', 'Fantasy'];

export function StyleFilter(props: {
  value: StyleFilterValue;
  onChange(value: StyleFilterValue): void;
}): JSX.Element {
  const { value, onChange } = props;
  return (
    <div role="group" aria-label="Filter by style" className="deck-scroll-x flex gap-8 overflow-x-auto safe-x py-4">
      {styleFilters.map((style) => {
        const pressed = style === value;
        return (
          <button
            key={style}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(style)}
            className={cn(
              'inline-flex h-[var(--target)] shrink-0 items-center rounded-12 border px-16 text-label',
              'transition-colors duration-[var(--duration-150)] ease-standard',
              pressed
                ? 'border-transparent bg-ink text-canvas'
                : 'border-hairline bg-surface-strong text-ink'
            )}
          >
            {style}
          </button>
        );
      })}
    </div>
  );
}
