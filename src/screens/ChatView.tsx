/*
  One conversation, after the reference image: header (a liquid-glass
  hamburger at the left, her avatar + name pill centered and tappable to open
  her profile), messages (bubbles, the grouped card message, the typing
  bubble), the composer pill, and the chats drawer (the only list of chats).
  The floating tab bar stays visible below (the composer pads with --tabbar-h).
  Focus theme: her theme + her scene plate; the UI over her world stays quiet.

  Atmosphere wiring (RTPC model; refs only, never per-frame state):
  - mount: setTheme(her theme, her scene) FIRST (it zeroes typing and drag),
    then affinity and typing, in that one effect; unmount parks affinity.
  - affinity = min(1, messages / 40) whenever the history grows.
  - typing 1/0 whenever her typing state flips.
  - gust when I send: 0.5 + min(0.5, chars / 120), capped at 0.6 when more
    than 2 sends land within 3s.
  - bloom when her message lands (never for the history present at mount):
    1 for the first of a batch, 0.4 for later ones, 0.6 for 3 words or fewer.
*/
import { useEffect, useRef, useState, type JSX } from 'react';
import { GallerySheet } from '../components/GallerySheet';
import { ChatHeader } from '../components/chat/ChatHeader';
import { ChatsDrawer, takeDrawerFocus } from '../components/chat/ChatsDrawer';
import { Composer } from '../components/chat/Composer';
import { MessageList } from '../components/chat/MessageList';
import { pulseStrength } from '../lib/motion';
import { useApp, useCharacter } from '../state/store';
import { useFrameTheme } from '../theme/ThemeProvider';

export function ChatView(props: { characterId: string }): JSX.Element {
  const { characterId } = props;
  const { state, actions } = useApp();
  const character = useCharacter(characterId);
  const { setTheme, setParam, pulse } = useFrameTheme();
  const menuRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const messages = state.conversations[characterId]?.messages ?? [];
  const typing = Boolean(state.typing[characterId]);
  const affinity = Math.min(1, messages.length / pulseStrength.affinityMessagesForMax);
  const drawerOpen = state.drawerOpen;
  const isOpen = state.openChatId === characterId;

  // Latest values for the mount effect without re-running it.
  const live = useRef({ affinity, typing });
  live.current = { affinity, typing };

  // The gallery belongs to the chat on screen; a chat switch starts it closed.
  useEffect(() => {
    setGalleryOpen(false);
  }, [characterId]);

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

  // Her reply lands: bloom. Never for the history present at mount.
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

  // Drawer focus contract: focus returns to the hamburger when the drawer
  // closes over this chat. A pick that switches chats hands focus to the
  // incoming view's hamburger instead (takeDrawerFocus).
  const wasOpen = useRef(drawerOpen);
  useEffect(() => {
    if (wasOpen.current && !drawerOpen && isOpen) menuRef.current?.focus({ preventScroll: true });
    wasOpen.current = drawerOpen;
  }, [drawerOpen, isOpen]);

  // Focus moves into the chat as it opens: the drawer pick lands on the
  // hamburger; anything else (the Chats tab, the match modal) on her name.
  useEffect(() => {
    if (takeDrawerFocus()) {
      menuRef.current?.focus({ preventScroll: true });
    } else if (!sectionRef.current?.contains(document.activeElement)) {
      titleRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const sends = useRef<number[]>([]);
  const send = (text: string) => {
    if (!character) return;
    actions.send(character.id, text);
    const now = Date.now();
    sends.current = [...sends.current.filter((t) => now - t < pulseStrength.sendBurstWindowMs), now];
    const strength =
      pulseStrength.sendBase + Math.min(pulseStrength.sendMaxExtra, text.length / pulseStrength.sendCharsForMax);
    pulse(
      'gust',
      sends.current.length > pulseStrength.sendBurstCount ? Math.min(pulseStrength.sendBurstCap, strength) : strength
    );
  };

  if (!character) {
    return (
      <section className="safe-x flex h-full flex-col items-center justify-center gap-16 pb-[var(--tabbar-h)] text-center">
        <p className="text-body text-muted">This conversation is no longer here.</p>
        <button
          type="button"
          onClick={actions.closeChat}
          className="min-h-[var(--target)] rounded-full bg-accent px-24 text-label text-on-accent"
        >
          Back to Explore
        </button>
      </section>
    );
  }

  return (
    <section ref={sectionRef} aria-label={`Chat with ${character.name}`} className="flex h-full flex-col">
      <ChatHeader
        character={character}
        drawerOpen={drawerOpen && isOpen}
        galleryOpen={galleryOpen}
        menuRef={menuRef}
        titleRef={titleRef}
        onMenu={() => actions.setDrawer(true)}
        onProfile={() => actions.openProfile(character.id)}
        onGallery={() => setGalleryOpen(true)}
      />
      <MessageList character={character} messages={messages} typing={typing} />
      <Composer name={character.name} onSend={send} />
      <ChatsDrawer currentId={character.id} anchor={menuRef} />
      <GallerySheet
        character={character}
        open={galleryOpen}
        anchor={sectionRef}
        onClose={() => setGalleryOpen(false)}
      />
    </section>
  );
}
