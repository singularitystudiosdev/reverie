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
import {
  BUILD_TAG,
  clipDelayMs,
  instantMatchChance,
  matchDelayMs,
  typingDelayMs,
} from '../lib/motion';

/** A right swipe that has not landed yet: her match resolves at `at` (epoch ms). */
export interface PendingMatch {
  characterId: string;
  at: number;
}

export interface AppState {
  tab: 'chats' | 'explore';
  openChatId: string | null;
  matchIds: string[];        // resolved matches, most recent activity first; empty = chat is locked
  lastChatId: string | null; // the last chat opened: what the Chats tab returns to
  passedIds: string[];
  conversations: Record<string, Conversation>;
  typing: Record<string, boolean>;
  drawerOpen: boolean;
  profileId: string | null;  // profile sheet open for this character
  pendingMatchId: string | null; // the instant-match modal showing for this character
  pendingMatches: PendingMatch[]; // likes waiting out their 5..30s
  hasMatchedBefore: boolean;  // the first LIKE ever has happened (not the first resolved match)
  sentClipIds: string[];      // characters who have sent their video message (once, ever)
  matchToasts: string[];      // queued "<Name> matched with you" toasts, one shown at a time
  resumingIds: string[];      // matches resolved at load whose opener is still to be typed
  filter: StyleFilter;
}

export interface AppActions {
  setTab(tab: AppState['tab']): void;   // 'explore' leaves any chat; 'chats' opens lastChatId (else the most recent match) and does nothing while locked
  openChat(id: string): void;            // marks read, closes drawer, sets tab 'chats' and lastChatId
  closeChat(): void;                     // back to Explore
  setDrawer(open: boolean): void;
  openProfile(id: string | null): void;
  like(id: string): void;     // records a LIKE: instant (opener now + modal), or a pending match that resolves after 5..30s
  pass(id: string): void;
  dismissMatch(): void;
  dismissToast(id: string): void; // a match toast was tapped or timed out
  resetDeck(): void;          // clears passedIds so passed characters return
  send(id: string, text: string): void; // append 'me' message, typing on, await getReply, append, typing off, unread++ if not open, move to top
  setFilter(f: StyleFilter): void;
}

/* ---------------------------------------------------------------- persistence */

const STORAGE_KEY = 'reverie:v3';
const STORAGE_VERSION = 3;

interface Persisted {
  v: typeof STORAGE_VERSION;
  matchIds: string[];
  passedIds: string[];
  conversations: Record<string, Conversation>;
  lastChatId: string | null;
  pendingMatches: PendingMatch[];
  hasMatchedBefore: boolean;
  sentClipIds: string[];
}

type Saved = Pick<
  AppState,
  'matchIds' | 'passedIds' | 'conversations' | 'lastChatId' | 'pendingMatches' | 'hasMatchedBefore' | 'sentClipIds'
>;

/** A new user: nobody matched, no likes, nothing said, chat locked. */
function fresh(): Saved {
  return {
    matchIds: [],
    passedIds: [],
    conversations: {},
    lastChatId: null,
    pendingMatches: [],
    hasMatchedBefore: false,
    sentClipIds: [],
  };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isPendingMatch(v: unknown): v is PendingMatch {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<PendingMatch>;
  return typeof p.characterId === 'string' && typeof p.at === 'number' && Number.isFinite(p.at);
}

function openerMessage(id: string): Message | null {
  const c = getCharacter(id);
  return c ? { id: makeId('her'), from: 'her', kind: 'text', text: c.opener, at: Date.now() } : null;
}

/** Her clip, the video message she sends once after the user's first message.
 *  v4: no caption line under the bubble; the message is the video only. */
function clipMessage(c: Character): Message {
  return {
    id: makeId('her'),
    from: 'her',
    kind: 'video',
    src: c.clip,
    poster: c.clipPoster,
    aspect: 9 / 16,
    at: Date.now(),
  };
}

interface Loaded extends Saved {
  /** Matches whose time passed while the app was closed: they announce now. */
  toasts: string[];
  /** Of those, the ones whose opener still has to be typed in after the load. */
  resuming: string[];
}

const emptyLoad = (): Loaded => ({ ...fresh(), toasts: [], resuming: [] });

function load(): Loaded {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLoad();
    const p = JSON.parse(raw) as Partial<Persisted> | null;
    if (
      !p ||
      p.v !== STORAGE_VERSION ||
      !isStringArray(p.matchIds) ||
      !isStringArray(p.passedIds) ||
      typeof p.conversations !== 'object' ||
      p.conversations === null
    ) {
      return emptyLoad();
    }
    // Drop ids that no longer exist in the roster; every match keeps a conversation.
    const matchIds = p.matchIds.filter((id) => getCharacter(id) && p.conversations?.[id]);
    const passedIds = p.passedIds.filter((id) => getCharacter(id) && !matchIds.includes(id));
    const conversations: Record<string, Conversation> = {};
    for (const id of matchIds) {
      const c = p.conversations[id];
      if (!c || !Array.isArray(c.messages)) return emptyLoad();
      // A reload while she was still typing her opener: deliver it now.
      const opener = c.messages.length === 0 ? openerMessage(id) : null;
      conversations[id] = opener
        ? { characterId: id, messages: [opener], unread: 1 }
        : { characterId: id, messages: c.messages, unread: Number(c.unread) || 0 };
    }

    // Pending likes survive the reload. Any whose time has already passed
    // resolve now: an empty chat with her typing, the chat moved to lastChatId,
    // and a toast for when we are not inside a chat. The provider delivers her
    // opener after the typing delay (resuming).
    const now = Date.now();
    const pendingMatches: PendingMatch[] = [];
    const toasts: string[] = [];
    const resuming: string[] = [];
    const rawPending = Array.isArray(p.pendingMatches) ? p.pendingMatches : [];
    for (const entry of rawPending) {
      if (!isPendingMatch(entry)) continue;
      const id = entry.characterId;
      if (!getCharacter(id) || matchIds.includes(id)) continue;
      if (conversations[id]) continue;
      if (entry.at <= now) {
        conversations[id] = { characterId: id, messages: [], unread: 0 };
        matchIds.unshift(id);
        toasts.push(id);
        resuming.push(id);
      } else {
        pendingMatches.push({ characterId: id, at: entry.at });
      }
    }

    const lastChatId =
      typeof p.lastChatId === 'string' && matchIds.includes(p.lastChatId)
        ? p.lastChatId
        : toasts[0] ?? (matchIds[0] ?? null);
    const hasMatchedBefore = p.hasMatchedBefore === true || matchIds.length > 0 || pendingMatches.length > 0;
    const sentClipIds = isStringArray(p.sentClipIds) ? p.sentClipIds.filter((id) => getCharacter(id)) : [];
    return {
      matchIds,
      passedIds,
      conversations,
      lastChatId,
      pendingMatches,
      hasMatchedBefore,
      sentClipIds,
      toasts,
      resuming,
    };
  } catch {
    return emptyLoad();
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
 * QA hooks:
 *   ?instant=1 forces every like instant, ?instant=0 forces every like to wait
 *   ?matchDelay=<ms> pins the wait before a pending match resolves
 * Read once at load; harmless in production (they only pick the roll/timer).
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

function readMatchDelayOverride(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = new URLSearchParams(window.location.search).get('matchDelay');
    // `get` returns null when the parameter is absent. `Number(null)` is 0, so
    // parsing it directly pinned EVERY wait to 0ms and every like matched on the
    // next tick. Treat absent/blank as "no override" and only then parse.
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

const instantOverride = readInstantOverride();
const matchDelayOverride = readMatchDelayOverride();

function rollInstant(hasMatchedBefore: boolean): boolean {
  // The very first like ever always matches at once; after that, 30%.
  return instantOverride ?? (!hasMatchedBefore || Math.random() < instantMatchChance);
}

function rollDelay(): number {
  if (matchDelayOverride !== null) return matchDelayOverride;
  const rolled = matchDelayMs.min + Math.random() * (matchDelayMs.max - matchDelayMs.min);
  // Never under the floor: a pending like must actually wait.
  return Math.min(matchDelayMs.max, Math.max(matchDelayMs.min, rolled));
}

let buildLogged = false;

/**
 * Stamp the frame (`data-build`) and log the build once per page, so the user
 * can tell a fresh bundle from the one their tab still has cached. The frame
 * component may also set the attribute from `BUILD_TAG`; this is the fallback
 * that makes the stamp true without touching files outside this unit.
 */
function stampBuild(): void {
  if (typeof document === 'undefined') return;
  const frame = document.querySelector('[data-frame]');
  if (frame instanceof HTMLElement) frame.dataset.build = BUILD_TAG;
  if (!buildLogged) {
    buildLogged = true;
    console.info(`[reverie] build ${BUILD_TAG}`);
  }
}

function initState(): AppState {
  const { toasts, resuming, ...saved } = load();
  const typing: Record<string, boolean> = {};
  for (const id of resuming) typing[id] = true;
  return {
    tab: 'explore',
    openChatId: null,
    ...saved,
    typing,
    drawerOpen: false,
    profileId: null,
    pendingMatchId: null,
    matchToasts: toasts,
    resumingIds: resuming,
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
  | { type: 'like'; id: string; opener: Message; instant: boolean; at: number }
  | { type: 'resolve'; id: string }
  | { type: 'pass'; id: string }
  | { type: 'dismissMatch' }
  | { type: 'dismissToast'; id: string }
  | { type: 'resetDeck' }
  | { type: 'sent'; id: string; message: Message }
  | { type: 'received'; id: string; messages: Message[]; stillTyping: boolean }
  | { type: 'clip'; id: string; message: Message }
  | { type: 'resumingDone' }
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
    matchToasts: state.matchToasts.filter((x) => x !== id),
    conversations: convo ? { ...state.conversations, [id]: { ...convo, unread: 0 } } : state.conversations,
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setTab': {
      if (action.tab === 'explore') {
        return { ...state, tab: 'explore', openChatId: null, drawerOpen: false };
      }
      // Chats: locked until the first RESOLVED match; then the last chat you were on.
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
      // One like per person: an existing chat or a pending timer is final.
      if (
        state.conversations[action.id] ||
        state.pendingMatches.some((p) => p.characterId === action.id)
      ) {
        return state;
      }
      const base: AppState = {
        ...state,
        hasMatchedBefore: true,
        passedIds: state.passedIds.filter((x) => x !== action.id),
      };
      if (action.instant) {
        // Her opener is already in the chat; the match modal shows.
        return {
          ...base,
          matchIds: toFront(state.matchIds, action.id),
          lastChatId: action.id,
          conversations: {
            ...state.conversations,
            [action.id]: { characterId: action.id, messages: [action.opener], unread: 1 },
          },
          pendingMatchId: action.id,
        };
      }
      // She is a pending match: the deck drops her, nothing shows on the card,
      // and her match resolves when the timer in the provider fires.
      return {
        ...base,
        pendingMatches: [...state.pendingMatches, { characterId: action.id, at: action.at }],
      };
    }

    case 'resolve': {
      const pendingMatches = state.pendingMatches.filter((p) => p.characterId !== action.id);
      const base: AppState = {
        ...state,
        pendingMatches,
        matchIds: toFront(state.matchIds, action.id),
        lastChatId: action.id,
      };
      const convo = state.conversations[action.id];
      if (convo) return base;
      const withChat: AppState = {
        ...base,
        conversations: {
          ...state.conversations,
          [action.id]: { characterId: action.id, messages: [], unread: 0 },
        },
        typing: { ...state.typing, [action.id]: true },
      };
      // The toast only when the user is looking at the deck, never over a chat,
      // the profile sheet or the match modal; the queue keeps them one at a time.
      if (state.openChatId !== null || state.pendingMatchId !== null || state.profileId !== null) {
        return withChat;
      }
      if (state.matchToasts.includes(action.id)) return withChat;
      return { ...withChat, matchToasts: [...state.matchToasts, action.id] };
    }

    case 'pass':
      return state.passedIds.includes(action.id)
        ? state
        : { ...state, passedIds: [...state.passedIds, action.id] };

    case 'dismissMatch':
      return { ...state, pendingMatchId: null };

    case 'dismissToast':
      return { ...state, matchToasts: state.matchToasts.filter((x) => x !== action.id) };

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

    case 'clip': {
      if (state.sentClipIds.includes(action.id)) return state;
      const sentClipIds = [...state.sentClipIds, action.id];
      const convo = state.conversations[action.id];
      if (!convo) return { ...state, sentClipIds };
      const isOpen = state.openChatId === action.id;
      return {
        ...state,
        sentClipIds,
        matchIds: toFront(state.matchIds, action.id),
        conversations: {
          ...state.conversations,
          [action.id]: {
            ...convo,
            messages: [...convo.messages, action.message],
            unread: isOpen ? 0 : convo.unread + 1,
          },
        },
      };
    }

    case 'resumingDone':
      return { ...state, resumingIds: [] };

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

  // Latest state for async work (reply history, pending likes) without
  // re-creating actions.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // A like updates `hasMatchedBefore` only after React commits, so two likes in
  // the same tick would both see the first-ever value and both match instantly.
  // This ref flips synchronously inside like().
  const hasLikedRef = useRef(state.hasMatchedBefore);

  // Stamp the frame and log the build once for this page.
  useEffect(() => {
    stampBuild();
  }, []);

  // Replies in flight per character: typing stays on until the last one lands.
  const pending = useRef<Record<string, number>>({});
  // Pending-match resolve timers, one per character.
  const matchTimers = useRef<Record<string, number>>({});
  // Clips already scheduled (guards the 1.5s window before the state records them).
  const clipScheduled = useRef<Record<string, boolean>>({});
  const clipTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    save({
      matchIds: state.matchIds,
      passedIds: state.passedIds,
      conversations: state.conversations,
      lastChatId: state.lastChatId,
      pendingMatches: state.pendingMatches,
      hasMatchedBefore: state.hasMatchedBefore,
      sentClipIds: state.sentClipIds,
    });
  }, [
    state.matchIds,
    state.passedIds,
    state.conversations,
    state.lastChatId,
    state.pendingMatches,
    state.hasMatchedBefore,
    state.sentClipIds,
  ]);

  /** She types, then her opener lands; unread bumps when it does (unless open). */
  const deliverOpener = useCallback((id: string) => {
    const c = getCharacter(id);
    if (!c) return;
    const opener: Message = { id: makeId('her'), from: 'her', kind: 'text', text: c.opener, at: Date.now() };
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

  // Resolve once per character: a timer that fires while the reducer is still
  // committing must not deliver a second opener.
  const resolving = useRef<Set<string>>(new Set());

  /** A pending match's timer fired: the chat opens with her typing her opener. */
  const resolveMatch = useCallback(
    (id: string) => {
      if (resolving.current.has(id)) return;
      resolving.current.add(id);
      const already = Boolean(stateRef.current.conversations[id]);
      dispatch({ type: 'resolve', id });
      if (already) return;
      deliverOpener(id);
    },
    [deliverOpener]
  );

  // Matches whose time passed while the app was closed: their chat opened at
  // load, so deliver the opener now (typing first, then the message).
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || state.resumingIds.length === 0) return;
    resumed.current = true;
    const ids = state.resumingIds;
    dispatch({ type: 'resumingDone' });
    for (const id of ids) deliverOpener(id);
  }, [state.resumingIds, deliverOpener]);

  // Schedule every pending match from its own `at`; a reload keeps the time.
  // Ids that left the pending list get their timer cleared.
  useEffect(() => {
    const now = Date.now();
    for (const p of state.pendingMatches) {
      if (matchTimers.current[p.characterId] !== undefined) continue;
      const ms = Math.max(0, p.at - now);
      matchTimers.current[p.characterId] = window.setTimeout(() => {
        delete matchTimers.current[p.characterId];
        resolveMatch(p.characterId);
      }, ms);
    }
    for (const id of Object.keys(matchTimers.current)) {
      if (!state.pendingMatches.some((p) => p.characterId === id)) {
        window.clearTimeout(matchTimers.current[id]);
        delete matchTimers.current[id];
      }
    }
  }, [state.pendingMatches, resolveMatch]);

  // Catch-up: a chat where the user already spoke but her clip never landed
  // (a reload during the 1.5s window, or an older conversation) still gets it,
  // once. The live send() path marks `clipScheduled` first, so this never
  // races her reply text.
  useEffect(() => {
    for (const [id, convo] of Object.entries(state.conversations)) {
      if (state.sentClipIds.includes(id) || clipScheduled.current[id]) continue;
      if (!convo.messages.some((m) => m.from === 'me')) continue;
      const c = getCharacter(id);
      if (!c) continue;
      clipScheduled.current[id] = true;
      clipTimers.current[id] = window.setTimeout(() => {
        delete clipTimers.current[id];
        dispatch({ type: 'clip', id, message: clipMessage(c) });
      }, clipDelayMs);
    }
  }, [state.conversations, state.sentClipIds]);

  useEffect(
    () => () => {
      for (const id of Object.keys(matchTimers.current)) {
        window.clearTimeout(matchTimers.current[id]);
      }
      matchTimers.current = {};
      for (const id of Object.keys(clipTimers.current)) {
        window.clearTimeout(clipTimers.current[id]);
      }
      clipTimers.current = {};
    },
    []
  );

  const send = useCallback((id: string, text: string) => {
    const body = text.trim();
    const character = getCharacter(id);
    if (!body || !character) return;

    const before = stateRef.current.conversations[id]?.messages ?? [];
    const firstMine = !before.some((m) => m.from === 'me');
    const withClip =
      firstMine &&
      Boolean(character.clip) &&
      !stateRef.current.sentClipIds.includes(id) &&
      !clipScheduled.current[id];
    if (withClip) clipScheduled.current[id] = true;

    const message: Message = { id: makeId('me'), from: 'me', kind: 'text', text: body, at: Date.now() };
    const history = [...before, message];
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
        // Her clip, once per character ever: after her reply text has landed.
        if (withClip) {
          void wait(clipDelayMs).then(() => {
            dispatch({ type: 'clip', id, message: clipMessage(character) });
          });
        }
      });
  }, []);

  const like = useCallback((id: string) => {
    const c = getCharacter(id);
    if (!c) return;
    const current = stateRef.current;
    if (current.conversations[id] || current.pendingMatches.some((p) => p.characterId === id)) return;
    const matchedBefore = hasLikedRef.current || current.hasMatchedBefore;
    hasLikedRef.current = true;
    const instant = rollInstant(matchedBefore);
    const opener: Message = { id: makeId('her'), from: 'her', kind: 'text', text: c.opener, at: Date.now() };
    dispatch({
      type: 'like',
      id,
      opener,
      instant,
      at: Date.now() + (instant ? 0 : rollDelay()),
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
      dismissToast: (id) => dispatch({ type: 'dismissToast', id }),
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
 * Not matched, not passed, not waiting on a pending match; in the Explore deck
 * order. The style filter stays in the store for now but the deck ignores it
 * (the filter chips are gone).
 */
export function useDeck(): Character[] {
  const { state } = useApp();
  const { matchIds, passedIds, pendingMatches } = state;
  return useMemo(() => {
    const pendingIds = pendingMatches.map((p) => p.characterId);
    const out = characters.filter(
      (c) => !matchIds.includes(c.id) && !passedIds.includes(c.id) && !pendingIds.includes(c.id)
    );
    const rank = (id: string) => deckRank.get(id) ?? rosterRank.get(id) ?? 0;
    return out.sort((a, b) => rank(a.id) - rank(b.id));
  }, [matchIds, passedIds, pendingMatches]);
}

/** True once the first match has RESOLVED: the Chats tab works. */
export function useChatUnlocked(): boolean {
  const { state } = useApp();
  return state.matchIds.length > 0;
}

export function useCharacter(id: string | null): Character | undefined {
  return useMemo(() => (id ? getCharacter(id) : undefined), [id]);
}
