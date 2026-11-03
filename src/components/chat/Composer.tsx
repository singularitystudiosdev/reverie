/*
  The composer pill ("+  Message", after the reference), one of the three
  surfaces allowed a backdrop blur (--blur-ui).
  - "+" toggles a row of quick-reply chips (aria-expanded), one line that
    scrolls sideways edge to edge. The three strings are fixed: the reply
    engine recognises them. A chip sends at once; any send closes the row.
  - The input is 16px (no iOS zoom), Enter sends (form submit).
  - The send button (accent circle, arrow up) scales in once there is text:
    a snappy spring on scale, opacity tweened; reduced motion fades only.
  - Focus: no ring and no outline anywhere. On :focus-within the whole pill
    (the + button and the field are one surface) darkens toward ink by
    --composer-focus-mix, on the quick duration.
*/
import { clsx } from 'clsx';
import { ArrowUp, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { dur, ease, instant, spring, useReducedMotion } from '../../lib/motion';
import { stateLayer } from './stateLayer';

export const quickReplies = [
  'Tell me about your world',
  'What are you doing right now?',
  'Take me somewhere',
] as const;

/** How far the chip row rises as it opens (a spacing token). */
const rise = 'var(--spacing-8)';

export function Composer(props: { name: string; onSend(text: string): void }): JSX.Element {
  const { name, onSend } = props;
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState('');
  const [chipsOpen, setChipsOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ids = useId();
  const inputId = `${ids}-input`;
  const chipsId = `${ids}-chips`;
  const hasText = draft.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    setChipsOpen(false);
    input.current?.focus({ preventScroll: true });
  };

  const sendChip = (text: string) => {
    onSend(text);
    setChipsOpen(false);
    input.current?.focus({ preventScroll: true });
  };

  return (
    <div data-slot="composer" className="safe-x flex flex-col gap-8 pt-8 pb-[var(--tabbar-h)]">
      <AnimatePresence initial={false}>
        {chipsOpen ? (
          <motion.ul
            key="chips"
            id={chipsId}
            aria-label="Quick replies"
            className="-mx-[var(--gutter)] flex snap-x scroll-px-[var(--gutter)] gap-8 overflow-x-auto px-[var(--gutter)] [scrollbar-width:none]"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: rise }}
            animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.enter } }}
            exit={{ opacity: 0, transition: { duration: dur.quick, ease: ease.exit } }}
          >
            {quickReplies.map((text) => (
              <li key={text} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => sendChip(text)}
                  className={clsx(
                    stateLayer,
                    'relative min-h-[var(--target)] whitespace-nowrap rounded-12 border border-hairline bg-surface-strong px-12 text-label text-ink'
                  )}
                >
                  {text}
                </button>
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>

      <form
        onSubmit={submit}
        className={clsx(
          'flex items-center gap-4 rounded-full border border-hairline bg-surface-strong p-4 text-ink backdrop-blur-[var(--blur-ui)]',
          'transition-[background-color] duration-[var(--duration-150)] ease-standard',
          'focus-within:bg-[color-mix(in_oklab,var(--t-surface-strong),var(--t-ink)_var(--composer-focus-mix))]'
        )}
      >
        <button
          type="button"
          aria-label="Quick replies"
          aria-expanded={chipsOpen}
          aria-controls={chipsOpen ? chipsId : undefined}
          onClick={() => setChipsOpen((open) => !open)}
          className={clsx(stateLayer, 'relative grid size-[var(--target)] shrink-0 place-items-center rounded-full')}
        >
          {chipsOpen ? (
            <X aria-hidden="true" className="size-20" />
          ) : (
            <Plus aria-hidden="true" className="size-20" />
          )}
        </button>
        <label htmlFor={inputId} className="sr-only">
          Message {name}
        </label>
        <input
          ref={input}
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          autoComplete="off"
          enterKeyHint="send"
          className="h-[var(--target)] min-w-0 flex-1 rounded-full bg-transparent px-4 text-body text-ink outline-none placeholder:text-muted"
        />
        <AnimatePresence initial={false}>
          {hasText ? (
            <motion.button
              key="send"
              type="submit"
              aria-label="Send"
              // Keep focus (and the phone keyboard) on the field.
              onPointerDown={(e) => e.preventDefault()}
              className="grid size-[var(--target)] shrink-0 place-items-center rounded-full bg-accent text-on-accent"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              whileTap={reduce ? undefined : { scale: 0.88, transition: spring.snappy }}
              animate={{
                opacity: 1,
                scale: 1,
                transition: { scale: reduce ? instant : spring.snappy, opacity: { duration: dur.quick } },
              }}
              exit={{
                opacity: 0,
                scale: reduce ? 1 : 0.6,
                transition: { duration: dur.quick, ease: ease.exit },
              }}
            >
              <ArrowUp aria-hidden="true" className="size-20" />
            </motion.button>
          ) : null}
        </AnimatePresence>
      </form>
    </div>
  );
}
