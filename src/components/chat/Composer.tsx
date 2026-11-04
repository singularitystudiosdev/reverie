/*
  The composer pill ("+  Message", after the reference): a floating
  .liquid-glass pane, the same material as the chat header's round buttons.
  - "+" toggles a row of quick-reply chips (aria-expanded), one line that
    scrolls sideways edge to edge. The three strings are fixed: the reply
    engine recognises them. A chip sends at once; any send closes the row.
  - The input is 16px (no iOS zoom), Enter sends (form submit).
  - One slot at the right end holds the send button (accent circle, arrow up)
    once there is text, and a plain mic button while the field is empty. They
    swap in place on a snappy spring on scale, opacity tweened.
  - The mic dictates into the field through the Web Speech API. While it
    listens it stays in the slot (so it can be stopped) with an accent-tinted
    fill and a pulsing ring; listening ends on a tap, on silence or on any
    error, quietly. Without the API (Firefox) a tap focuses the field, where
    the phone keyboard carries its own dictation key.
  - Focus: no ring and no outline anywhere. On :focus-within the whole pill
    (the + button and the field are one surface) takes a darker tint of ink
    (--composer-focus-mix) over the glass, on the quick duration.
*/
import { clsx } from 'clsx';
import { ArrowUp, Mic, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { dur, ease, instant, spring, useReducedMotion } from '../../lib/motion';
import { stateLayer } from './stateLayer';

export const quickReplies = [
  'Tell me about your world',
  'What are you doing right now?',
  'Take me somewhere',
] as const;

/** The slice of the Web Speech API the composer uses (lib.dom does not ship it). */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

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
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  // Mic while the field is empty or while dictating; send once there is text.
  const showMic = listening || !hasText;

  // Detach before aborting: an aborted session fires end/error late, and the
  // handlers ignore any session that is no longer the current one.
  const cancelDictation = () => {
    const current = recognition.current;
    recognition.current = null;
    setListening(false);
    if (!current) return;
    current.onresult = null;
    current.onerror = null;
    current.onend = null;
    try {
      current.abort();
    } catch {
      // Already over: nothing to stop.
    }
  };
  useEffect(() => cancelDictation, []);

  const toggleDictation = () => {
    if (recognition.current) {
      // Stop (not abort): the words heard so far still land in the field.
      try {
        recognition.current.stop();
      } catch {
        cancelDictation();
      }
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      input.current?.focus({ preventScroll: true });
      return;
    }
    const base = draft.trimEnd();
    try {
      const rec = new Ctor();
      rec.lang = navigator.language;
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        if (recognition.current !== rec) return;
        let heard = '';
        for (let i = 0; i < e.results.length; i += 1) heard += e.results[i]?.[0]?.transcript ?? '';
        heard = heard.trim();
        setDraft(base && heard ? `${base} ${heard}` : base || heard);
      };
      const finish = () => {
        if (recognition.current !== rec) return;
        recognition.current = null;
        setListening(false);
      };
      rec.onerror = finish;
      rec.onend = finish;
      recognition.current = rec;
      setListening(true);
      rec.start();
    } catch {
      cancelDictation();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    cancelDictation();
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
    <div data-slot="composer" className="safe-x flex flex-col gap-8 pt-8 pb-[var(--bottom-room)]">
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
          'liquid-glass flex items-center gap-4 rounded-full border border-transparent p-6',
          'bg-[color-mix(in_oklab,var(--t-surface-strong)_var(--composer-tint),transparent)]',
          'transition-[background-color] duration-[var(--duration-150)] ease-standard',
          'focus-within:bg-[color-mix(in_oklab,var(--t-ink)_var(--composer-focus-mix),color-mix(in_oklab,var(--t-surface-strong)_var(--composer-tint),transparent))]'
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
          onChange={(e) => {
            // Typing takes over from the microphone.
            cancelDictation();
            setDraft(e.target.value);
          }}
          placeholder="Message"
          autoComplete="off"
          enterKeyHint="send"
          className="h-[var(--target)] min-w-0 flex-1 rounded-full bg-transparent px-4 text-body text-ink outline-none placeholder:text-[color-mix(in_oklab,var(--t-ink)_var(--composer-placeholder-mix),transparent)]"
        />
        <div className="relative size-[var(--target)] shrink-0">
          <AnimatePresence initial={false}>
            {showMic ? (
              <motion.button
                key="mic"
                type="button"
                aria-label={listening ? 'Stop dictation' : 'Dictate a message'}
                aria-pressed={listening}
                onClick={toggleDictation}
                className={clsx(
                  stateLayer,
                  'absolute inset-0 grid place-items-center rounded-full',
                  'transition-[background-color,color] duration-[var(--duration-150)] ease-standard',
                  listening &&
                    'bg-[color-mix(in_oklab,var(--t-accent)_var(--dictate-fill-mix),transparent)] text-accent'
                )}
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
                {listening ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 animate-dictate-pulse rounded-full border-2 border-accent"
                  />
                ) : null}
                <Mic aria-hidden="true" className="size-20" />
              </motion.button>
            ) : (
              <motion.button
                key="send"
                type="submit"
                aria-label="Send"
                // Keep focus (and the phone keyboard) on the field.
                onPointerDown={(e) => e.preventDefault()}
                className="absolute inset-0 grid place-items-center rounded-full bg-accent text-on-accent"
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
            )}
          </AnimatePresence>
        </div>
      </form>
    </div>
  );
}
