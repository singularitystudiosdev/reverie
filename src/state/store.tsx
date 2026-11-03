import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type JSX,
  type ReactNode,
} from 'react';
import { characters, getCharacter } from '../data/characters';
import { getReply } from '../data/replies';
import { deckOrder } from '../data/seed';
import type { Character, Conversation, Message, StyleFilter } from '../data/types';
import { makeId } from '../lib/id';
import { instantMatchChance, typingDelayMs } from '../lib/motion';

export interface AppState {
  tab: 'chats' | 'explore';
  openChatId: string | null;
  matchIds: string[];        // most recent activity first; empty = chat is locked
  lastChatId: string | null; // the last chat opened: what the Chats tab returns to
  passedIds: string[];
  conversations: Record<string, Conversation>;
  typing: Record<string, boolean>;
  drawerOpen: boolean;
  profileId: string | null;  // profile sheet open for this character
  pendingMatchId: string | null; // match moment showing for this character
  filter: StyleFilter;
}

export interface AppActions {
  setTab(tab: AppState['tab']): void;   // 'explore' leaves any chat; 'chats' opens lastChatId (else the most recent match) and does nothing while locked
  openChat(id: string): void;            // marks read, closes drawer, sets tab 'chats' and lastChatId
  closeChat(): void;                     // back to Explore
  setDrawer(open: boolean): void;
  openProfile(id: string | null): void;
  like(id: string): void;     // match: prepend to matchIds, create her conversation, roll an instant match (opener now + pendingMatchId) or let her type (opener lands later, unread)
  pass(id: string): void;
  dismissMatch(): void;
  resetDeck(): void;          // clears passedIds so passed characters return
  send(id: string, text: string): void; // append 'me' message, typing on, await getReply, append, typing off, unread++ if not open, move to top
  setFilter(f: StyleFilter): void;
}

/* ---------------------------------------------------------------- persistence */

const STORAGE_KEY = 'reverie:v2';
const STORAGE_VERSION = 2;

interface Persisted {
  v: typeof STORAGE_VERSION;
  matchIds: string[];
  passedIds: string[];
  conversations: Record<string, Conversation>;
  lastChatId: string | null;
}

type Saved = Pick<AppState, 'matchIds' | 'passedIds' | 'conversations' | 'lastChatId'>;

/** A new user: nobody matched, nothing said, chat locked. */
function fresh(): Saved {
  return { matchIds: [], passedIds: [], conversations: {}, lastChatId: null };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function openerMessage(id: string): Message | null {
  const c = getCharacter(id);
  return c ? { id: makeId('her'), from: 'her', kind: 'text', text: c.opener, at: Date.now() } : null;
}

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Partial<Persisted> | null;
    if (
      !p ||
      p.v !== STORAGE_VERSION ||
      !isStringArray(p.matchIds) ||
      !isStringArray(p.passedIds) ||
      typeof p.conversations !== 'object' ||
      p.conversations === null
    ) {
      return fresh();
    }
    // Drop ids that no longer exist in the roster; every match keeps a conversation.
    const matchIds = p.matchIds.filter((id) => getCharacter(id) && p.conversations?.[id]);
    const passedIds = p.passedIds.filter((id) => getCharacter(id) && !matchIds.includes(id));
    const conversations: Record<string, Conversation> = {};
    for (const id of matchIds) {
      const c = p.conversations[id];
      if (!c || !Array.isArray(c.messages)) return fresh();
      // A reload while she was still typing her opener: deliver it now.
      const opener = c.messages.length === 0 ? openerMessage(id) : null;
      conversations[id] = opener
        ? { characterId: id, messages: [opener], unread: 1 }
        : { characterId: id, messages: c.messages, unread: Number(c.unread) || 0 };
    }
    const lastChatId =
      typeof p.lastChatId === 'string' && matchIds.includes(p.lastChatId) ? p.lastChatId : null;
    return { matchIds, passedIds, conversations, lastChatId };
  } catch {
    return fresh();
  }
}

function save(s: Saved) {
  try {
    const data: Persisted = { v: STORAGE_VERSION, ...s };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked (private mode): the session still works in memory.
  }
}

/**
 * QA hook: `?instant=1` makes every right swipe an instant match, `?instant=0`
 * never. Read once at load; harmless in production (it only picks the roll).
 */
function readInstantOverride(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = new URLSearchParams(window.location.search).get('instant');
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

const instantOverride = readInstantOverride();

function rollInstant(): boolean {
  return instantOverride ?? Math.random() < instantMatchChance;
}

function initState(): AppState {
  return {
    tab: 'explore',
    openChatId: null,
    ...load(),
    typing: {},
    drawerOpen: false,
    profileId: null,
    pendingMatchId: null,
    filter: 'All',
  };
}

/* -------------------------------------------------------------------- reducer */

type Action =
  | { type: 'setTab'; tab: AppState['tab'] }
  | { type: 'openChat'; id: string }
  | { type: 'closeChat' }
  | { type: 'setDrawer'; open: boolean }
  | { type: 'openProfile'; id: string | null }
  | { type: 'like'; id: string; opener: Message; instant: boolean }
  | { type: 'pass'; id: string }
  | { type: 'dismissMatch' }
  | { type: 'resetDeck' }
  | { type: 'sent'; id: string; message: Message }
  | { type: 'received'; id: string; messages: Message[]; stillTyping: boolean }
  | { type: 'setFilter'; filter: StyleFilter };

function toFront(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)];
}

/** The chat on screen: read, remembered as the last chat, drawer shut. */
function opened(state: AppState, id: string): AppState {
  const convo = state.conversations[id];
  return {
    ...state,
    tab: 'chats',
    openChatId: id,
    lastChatId: id,
    drawerOpen: false,
    conversations: convo ? { ...state.conversations, [id]: { ...convo, unread: 0 } } : state.conversations,
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setTab': {
      if (action.tab === 'explore') {
        return { ...state, tab: 'explore', openChatId: null, drawerOpen: false };
      }
      // Chats: locked until the first match; then the last chat you were on.
      if (state.matchIds.length === 0) return state;
      const target =
        state.lastChatId && state.matchIds.includes(state.lastChatId)
          ? state.lastChatId
          : state.matchIds[0];
      return opened(state, target);
    }

    case 'openChat':
      return opened(state, action.id);

    case 'closeChat':
      return { ...state, tab: 'explore', openChatId: null, drawerOpen: false };

    case 'setDrawer':
      return { ...state, drawerOpen: action.open };

    case 'openProfile':
      return { ...state, profileId: action.id };

    case 'like': {
      const existing = state.conversations[action.id];
      const base: AppState = {
        ...state,
        matchIds: toFront(state.matchIds, action.id),
        passedIds: state.passedIds.filter((x) => x !== action.id),
      };
      if (existing) return base;
      if (action.instant) {
        // Her opener is already in the chat; the match modal shows.
        return {
          ...base,
          conversations: {
            ...state.conversations,
            [action.id]: { characterId: action.id, messages: [action.opener], unread: 1 },
          },
          pendingMatchId: action.id,
        };
      }
      // She is typing; the opener lands later (see like() in the provider).
      return {
        ...base,
        conversations: {
          ...state.conversations,
          [action.id]: { characterId: action.id, messages: [], unread: 0 },
        },
        typing: { ...state.typing, [action.id]: true },
      };
    }

    case 'pass':
      return state.passedIds.includes(action.id)
        ? state
        : { ...state, passedIds: [...state.passedIds, action.id] };

    case 'dismissMatch':
      return { ...state, pendingMatchId: null };

    case 'resetDeck':
      return { ...state, passedIds: [] };

    case 'sent': {
      const convo = state.conversations[action.id] ?? {
        characterId: action.id,
        messages: [],
        unread: 0,
      };
      return {
        ...state,
        matchIds: toFront(state.matchIds, action.id),
        conversations: {
          ...state.conversations,
          [action.id]: { ...convo, messages: [...convo.messages, action.message] },
        },
        typing: { ...state.typing, [action.id]: true },
      };
    }

    case 'received': {
      const convo = state.conversations[action.id];
      if (!convo) return { ...state, typing: { ...state.typing, [action.id]: action.stillTyping } };
      const isOpen = state.openChatId === action.id;
      return {
        ...state,
        matchIds: toFront(state.matchIds, action.id),
        conversations: {
          ...state.conversations,
          [action.id]: {
            ...convo,
            messages: [...convo.messages, ...action.messages],
            unread: isOpen ? 0 : convo.unread + action.messages.length,
          },
        },
        typing: { ...state.typing, [action.id]: action.stillTyping },
      };
    }

    case 'setFilter':
      return { ...state, filter: action.filter };
  }
}

/* ------------------------------------------------------------------- provider */

interface AppContextValue {
  state: AppState;
  actions: AppActions;
}

const AppContext = createContext<AppContextValue | null>(null);

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function AppProvider(props: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  // Latest state for async work (reply history) without re-creating actions.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Replies in flight per character: typing stays on until the last one lands.
  const pending = useRef<Record<string, number>>({});

  useEffect(() => {
    save({
      matchIds: state.matchIds,
      passedIds: state.passedIds,
      conversations: state.conversations,
      lastChatId: state.lastChatId,
    });
  }, [state.matchIds, state.passedIds, state.conversations, state.lastChatId]);

  const send = useCallback((id: string, text: string) => {
    const body = text.trim();
    const character = getCharacter(id);
    if (!body || !character) return;

    const message: Message = { id: makeId('me'), from: 'me', kind: 'text', text: body, at: Date.now() };
    const history = [...(stateRef.current.conversations[id]?.messages ?? []), message];
    dispatch({ type: 'sent', id, message });
    pending.current[id] = (pending.current[id] ?? 0) + 1;

    const delay = typingDelayMs.min + Math.random() * (typingDelayMs.max - typingDelayMs.min);
    void Promise.all([getReply(character, body, history), wait(delay)])
      .then(([replies]) => replies)
      .catch((): Message[] => [])
      .then((replies) => {
        pending.current[id] = Math.max(0, (pending.current[id] ?? 1) - 1);
        const now = Date.now();
        dispatch({
          type: 'received',
          id,
          messages: replies.map((m, i) => ({ ...m, at: now + i })),
          stillTyping: pending.current[id] > 0,
        });
      });
  }, []);

  const like = useCallback((id: string) => {
    const c = getCharacter(id);
    if (!c) return;
    const instant = rollInstant();
    const opener: Message = { id: makeId('her'), from: 'her', kind: 'text', text: c.opener, at: Date.now() };
    const first = !stateRef.current.conversations[id];
    dispatch({ type: 'like', id, opener, instant });
    if (instant || !first) return;
    // Not instant: she types, then her opener lands and counts as unread.
    pending.current[id] = (pending.current[id] ?? 0) + 1;
    const delay = typingDelayMs.min + Math.random() * (typingDelayMs.max - typingDelayMs.min);
    void wait(delay).then(() => {
      pending.current[id] = Math.max(0, (pending.current[id] ?? 1) - 1);
      dispatch({
        type: 'received',
        id,
        messages: [{ ...opener, at: Date.now() }],
        stillTyping: pending.current[id] > 0,
      });
    });
  }, []);

  const actions = useMemo<AppActions>(
    () => ({
      setTab: (tab) => dispatch({ type: 'setTab', tab }),
      openChat: (id) => dispatch({ type: 'openChat', id }),
      closeChat: () => dispatch({ type: 'closeChat' }),
      setDrawer: (open) => dispatch({ type: 'setDrawer', open }),
      openProfile: (id) => dispatch({ type: 'openProfile', id }),
      like,
      pass: (id) => dispatch({ type: 'pass', id }),
      dismissMatch: () => dispatch({ type: 'dismissMatch' }),
      resetDeck: () => dispatch({ type: 'resetDeck' }),
      send,
      setFilter: (filter) => dispatch({ type: 'setFilter', filter }),
    }),
    [send, like]
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>;
}

export function useApp(): { state: AppState; actions: AppActions } {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp() must be used inside <AppProvider>');
  return ctx;
}

const deckRank = new Map<string, number>();
deckOrder.forEach((id, i) => deckRank.set(id, i));
const rosterRank = new Map<string, number>(characters.map((c, i) => [c.id, deckOrder.length + i]));

/**
 * Not matched, not passed; in the Explore deck order. The style filter stays in
 * the store for now but the deck ignores it (the filter chips are gone).
 */
export function useDeck(): Character[] {
  const { state } = useApp();
  const { matchIds, passedIds } = state;
  return useMemo(() => {
    const out = characters.filter((c) => !matchIds.includes(c.id) && !passedIds.includes(c.id));
    const rank = (id: string) => deckRank.get(id) ?? rosterRank.get(id) ?? 0;
    return out.sort((a, b) => rank(a.id) - rank(b.id));
  }, [matchIds, passedIds]);
}

/** True once the first right swipe has landed: the Chats tab works. */
export function useChatUnlocked(): boolean {
  const { state } = useApp();
  return state.matchIds.length > 0;
}

export function useCharacter(id: string | null): Character | undefined {
  return useMemo(() => (id ? getCharacter(id) : undefined), [id]);
}
