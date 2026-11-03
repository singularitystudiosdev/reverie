// STUB: replaced by the chats unit
/*
  One conversation: header (back, her avatar + name pill, profile pill),
  messages (text bubbles and the grouped card message), a composer that calls
  send. Focus theme: her theme + her scene.
*/
import { ChevronLeft, SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { Avatar } from '../components/Avatar';
import { artSize } from '../data/characters';
import type { CardItem, Message } from '../data/types';
import { cn } from '../lib/cn';
import { pulseStrength } from '../lib/motion';
import { useApp, useCharacter } from '../state/store';
import { useFrameTheme } from '../theme/ThemeProvider';

export function ChatView(props: { characterId: string }): JSX.Element {
  const { characterId } = props;
  const { state, actions } = useApp();
  const character = useCharacter(characterId);
  const { setTheme, setParam, pulse } = useFrameTheme();
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  const messages = state.conversations[characterId]?.messages ?? [];
  const typing = Boolean(state.typing[characterId]);
  const affinity = Math.min(1, messages.length / pulseStrength.affinityMessagesForMax);

  // Latest values for the mount effect without re-running it.
  const live = useRef({ affinity, typing });
  live.current = { affinity, typing };

  // RTPC call order: setTheme FIRST (it zeroes typing and drag), then the
  // params. Leaving the chat parks affinity at rest.
  useEffect(() => {
    if (!character) return;
    setTheme(character.theme, character.scene);
    setParam('affinity', live.current.affinity);
    setParam('typing', live.current.typing ? 1 : 0);
    return () => setParam('affinity', pulseStrength.affinityAtRest);
  }, [character, setTheme, setParam]);

  useEffect(() => {
    setParam('typing', typing ? 1 : 0);
  }, [typing, setParam]);

  useEffect(() => {
    setParam('affinity', affinity);
  }, [affinity, setParam]);

  // Her reply lands: bloom. Never on the initial render.
  const seen = useRef(messages.length);
  useEffect(() => {
    const fresh = messages.slice(seen.current).filter((m) => m.from === 'her');
    seen.current = messages.length;
    fresh.forEach((m, i) => {
      const words = (m.text ?? '').trim().split(/\s+/).filter(Boolean).length;
      const strength =
        m.kind === 'text' && words <= pulseStrength.bloomShortWords
          ? pulseStrength.bloomShort
          : i === 0
            ? pulseStrength.bloomFirst
            : pulseStrength.bloomLater;
      pulse('bloom', strength);
    });
  }, [messages, pulse]);

  const sends = useRef<number[]>([]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  if (!character) {
    return (
      <section className="safe-x flex h-full flex-col items-center justify-center gap-16 text-center">
        <p className="text-body text-muted">This conversation is no longer here.</p>
        <button
          type="button"
          onClick={actions.closeChat}
          className="min-h-[var(--target)] rounded-full bg-accent px-16 text-label text-on-accent"
        >
          Back to Chats
        </button>
      </section>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    actions.send(character.id, text);
    const now = Date.now();
    sends.current = [...sends.current.filter((t) => now - t < pulseStrength.sendBurstWindowMs), now];
    const strength =
      pulseStrength.sendBase +
      Math.min(pulseStrength.sendMaxExtra, text.length / pulseStrength.sendCharsForMax);
    pulse(
      'gust',
      sends.current.length > pulseStrength.sendBurstCount ? Math.min(pulseStrength.sendBurstCap, strength) : strength
    );
    setDraft('');
  };

  return (
    <section aria-label={`Chat with ${character.name}`} className="flex h-full flex-col">
      <header className="safe-x grid grid-cols-[1fr_auto_1fr] items-start gap-8 pt-[calc(var(--statusbar-h)+var(--spacing-8))] pb-8">
        <button
          type="button"
          aria-label="Back to Chats"
          onClick={actions.closeChat}
          className="grid size-[var(--target-touch)] place-items-center justify-self-start rounded-full border border-hairline bg-surface-strong text-ink"
        >
          <ChevronLeft aria-hidden="true" className="size-20" />
        </button>
        <div className="flex flex-col items-center gap-4">
          <Avatar character={character} size="md" layoutId={`avatar-${character.id}`} eager />
          <h1 className="rounded-full bg-surface-strong px-12 py-2 text-label">{character.name}</h1>
        </div>
        <button
          type="button"
          onClick={() => actions.openProfile(character.id)}
          className="h-[var(--target-touch)] justify-self-end rounded-full border border-hairline bg-surface-strong px-16 text-label text-ink"
        >
          Profile
        </button>
      </header>

      <div
        ref={scroller}
        role="region"
        aria-label="Messages"
        tabIndex={0}
        className="safe-x min-h-0 flex-1 overflow-y-auto py-12"
      >
        <ol className="flex flex-col gap-8" aria-live="polite" aria-relevant="additions">
          {messages.map((m) => (
            <li key={m.id} className={cn('flex', m.from === 'me' ? 'justify-end' : 'justify-start')}>
              <MessageBody message={m} />
            </li>
          ))}
        </ol>
        {typing ? (
          <p className="pt-8 text-caption text-muted" role="status">
            {character.name} is typing
          </p>
        ) : null}
      </div>

      <form onSubmit={submit} className="safe-x flex items-center gap-8 pt-8 pb-[var(--tabbar-h)]">
        <label htmlFor="composer" className="sr-only">
          Message {character.name}
        </label>
        <input
          id="composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          autoComplete="off"
          enterKeyHint="send"
          className="h-[var(--target-touch)] min-w-0 flex-1 rounded-full border border-hairline bg-surface-strong px-16 text-body text-ink placeholder:text-muted"
        />
        <button
          type="submit"
          aria-label="Send"
          className="grid size-[var(--target-touch)] shrink-0 place-items-center rounded-full bg-accent text-on-accent"
        >
          <SendHorizontal aria-hidden="true" className="size-20" />
        </button>
      </form>
    </section>
  );
}

function MessageBody(props: { message: Message }): JSX.Element {
  const { message } = props;
  if (message.kind === 'cards' && message.cards?.length) {
    return (
      <ul className="w-[var(--bubble-max)] rounded-20 bg-surface p-8">
        {message.cards.map((card) => (
          <CardRow key={card.title} card={card} />
        ))}
      </ul>
    );
  }
  const mine = message.from === 'me';
  return (
    <p
      className={cn(
        'max-w-[var(--bubble-max)] rounded-20 px-16 py-12 text-body',
        mine ? 'bg-me text-on-me' : 'bg-surface text-ink'
      )}
    >
      {message.text}
    </p>
  );
}

function CardRow(props: { card: CardItem }): JSX.Element {
  const { card } = props;
  const [ok, setOk] = useState(true);
  return (
    <li className="flex items-center gap-12 p-8">
      <span className="relative size-[var(--thumb)] shrink-0 overflow-hidden rounded-12 bg-surface-strong">
        {ok && card.image ? (
          <img
            src={card.image}
            alt=""
            width={artSize.sm.width}
            height={artSize.sm.height}
            decoding="async"
            loading="lazy"
            onError={() => setOk(false)}
            className="size-full object-cover"
            style={{
              objectPosition: card.imagePosition,
              transform: card.imageScale ? `scale(${card.imageScale})` : undefined,
              transformOrigin: card.imagePosition,
            }}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-label text-ink">{card.title}</span>
        <span className="truncate text-caption text-muted">{card.subtitle}</span>
        <span className="truncate text-caption text-muted">{card.meta}</span>
      </span>
    </li>
  );
}
