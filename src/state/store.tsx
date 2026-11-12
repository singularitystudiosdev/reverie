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
import { characters, getCharacter, registerRemoteCharacter } from '../data/characters';
import { getReply } from '../data/replies';
import { deckOrder } from '../data/seed';
import type { Character, Conversation, Message, StyleFilter } from '../data/types';
import { makeId } from '../lib/id';
import { apiEnabled, fetchFeed, messageText, remoteReply, startSession, track } from '../lib/api';
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
  blockedIds: string[];       // reported or blocked: the match ended and she never returns, not even after a deck reset
  conversations: Record<string, Conversation>;
  typing: Record<string, boolean>;
  drawerOpen: boolean;
  profileId: string | null;  // profile sheet open for this character
  pendingMatches: PendingMatch[]; // likes waiting out their 5..30s
  hasMatchedBefore: boolean;  // the first LIKE ever has happened (not the first resolved match)
  sentClipIds: string[];      // characters who have sent their video message (once, ever)
  matchNotices: string[];     // the match-notification queue (instant and delayed matches alike), head shown, one at a time
  resumingIds: string[];      // matches resolved at load whose opener is still to be typed
  filter: StyleFilter;
  feedOrder: string[] | null; // the backend feed's ranked ids for this user (null: local deck order)
  feedRequestId: string | null;
  shownTopId: string | null;  // the card on top of the deck the user has already seen (stays on top when the feed lands)
}

export interface AppActions {
  setTab(tab: AppState['tab']): void;   // 'explore' leaves any chat; 'chats' opens lastChatId (else the most recent match) and does nothing while locked
  openChat(id: string): void;            // marks read, closes drawer, sets tab 'chats' and lastChatId
  closeChat(): void;                     // back to Explore
  setDrawer(open: boolean): void;
  openProfile(id: string | null): void;
  like(id: string): void;     // records a LIKE: instant (opener now + a notice), or a pending match that resolves after 5..30s (then a notice)
  pass(id: string): void;
  dismissNotice(id: string): void; // her match notification was tapped, swiped away or timed out
  resetDeck(): void;          // clears passedIds so passed characters return
  send(id: string, text: string): void; // append 'me' message, typing on, await getReply, append, typing off, unread++ if not open, move to top
  setFilter(f: StyleFilter): void;
  shown(id: string): void;              // the card on top of the deck was seen (telemetry impression + keeps it on top)
  endMatch(id: string, reason: 'report' | 'block'): void; // report or block: telemetry event, the chat ends, she is hidden for good
}

/* ---------------------------------------------------------------- persistence */

const STORAGE_KEY = 'reverie:v3';

type Saved = Pick<
  AppState,
  'matchIds' | 'passedIds' | 'blockedIds' | 'conversations' | 'lastChatId' | 'pendingMatches' | 'hasMatchedBefore' | 'sentClipIds'
>;

/** A new user: nobody matched, no likes, nothing said, chat locked. */
function fresh(): Saved {
  return {
    matchIds: [],
    passedIds: [],
    blockedIds: [],
    conversations: {},
    lastChatId: null,
    pendingMatches: [],
    hasMatchedBefore: false,
    sentClipIds: [],
  };
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
  notices: string[];
  /** Of those, the ones whose opener still has to be typed in after the load. */
  resuming: string[];
}

const emptyLoad = (): Loaded => ({ ...fresh(), notices: [], resuming: [] });

/** Every reload starts as a new user (the user's call): nothing is read
 *  back, and any data an earlier build saved is cleared. */
function load(): Loaded {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): nothing to clear.
  }
  return emptyLoad();
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
  const { notices, resuming, ...saved } = load();
  const typing: Record<string, boolean> = {};
  for (const id of resuming) typing[id] = true;
  return {
    tab: 'explore',
    openChatId: null,
    ...saved,
    typing,
    drawerOpen: false,
    profileId: null,
    matchNotices: notices,
    resumingIds: resuming,
    filter: 'All',
    feedOrder: null,
    feedRequestId: null,
    shownTopId: null,
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
  | { type: 'dismissNotice'; id: string }
  | { type: 'resetDeck' }
  | { type: 'sent'; id: string; message: Message }
  | { type: 'received'; id: string; messages: Message[]; stillTyping: boolean }
  | { type: 'clip'; id: string; message: Message }
  | { type: 'resumingDone' }
  | { type: 'setFilter'; filter: StyleFilter }
  | { type: 'feed'; order: string[]; requestId: string }
  | { type: 'shown'; id: string }
  | { type: 'endMatch'; id: string };

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
    matchNotices: state.matchNotices.filter((x) => x !== id),
    conversations: convo ? { ...state.conversations, [id]: { ...convo, unread: 0 } } : state.conversations,
  };
}

/** Her place in the notification queue: not when she is already queued or the user is in her chat. */
function enqueueNotice(state: AppState, id: string): string[] {
  if (state.openChatId === id || state.matchNotices.includes(id)) return state.matchNotices;
  return [...state.matchNotices, id];
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
        // Her opener is already in the chat; her notification joins the queue.
        return {
          ...base,
          matchIds: toFront(state.matchIds, action.id),
          lastChatId: action.id,
          conversations: {
            ...state.conversations,
            [action.id]: { characterId: action.id, messages: [action.opener], unread: 1 },
          },
          matchNotices: enqueueNotice(state, action.id),
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
      // The same notification as an instant match, on any screen; the queue
      // keeps them one at a time. Skipped only when she is already on screen.
      return { ...withChat, matchNotices: enqueueNotice(state, action.id) };
    }

    case 'pass':
      return state.passedIds.includes(action.id)
        ? state
        : { ...state, passedIds: [...state.passedIds, action.id] };

    case 'dismissNotice':
      return { ...state, matchNotices: state.matchNotices.filter((x) => x !== action.id) };

    case 'resetDeck':
      // The card that was on top has been passed with the rest: it no longer holds the top.
      return { ...state, passedIds: [], shownTopId: null };

    case 'endMatch': {
      const id = action.id;
      const matchIds = state.matchIds.filter((x) => x !== id);
      const { [id]: _ended, ...conversations } = state.conversations;
      const { [id]: _typing, ...typing } = state.typing;
      const inChat = state.openChatId === id;
      return {
        ...state,
        matchIds,
        conversations,
        typing,
        blockedIds: state.blockedIds.includes(id) ? state.blockedIds : [...state.blockedIds, id],
        pendingMatches: state.pendingMatches.filter((p) => p.characterId !== id),
        matchNotices: state.matchNotices.filter((x) => x !== id),
        resumingIds: state.resumingIds.filter((x) => x !== id),
        lastChatId: state.lastChatId === id ? matchIds[0] ?? null : state.lastChatId,
        openChatId: inChat ? null : state.openChatId,
        tab: inChat ? 'explore' : state.tab,
        drawerOpen: inChat ? false : state.drawerOpen,
        profileId: null,
      };
    }

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

    case 'shown':
      return state.shownTopId === action.id ? state : { ...state, shownTopId: action.id };

    case 'feed': {
      // New ranked ids go first; ids from the previous page the user has not reached keep their place after them.
      const rest = (state.feedOrder ?? []).filter((id) => !action.order.includes(id));
      return { ...state, feedOrder: [...action.order, ...rest], feedRequestId: action.requestId };
    }
  }
}

/* ------------------------------------------------------------------- provider */

interface AppContextValue {
  state: AppState;
  actions: AppActions;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Re-rank the deck after this many swipes (the feed learns from each one; a page of 10 would wait 7). */
const REFRESH_AFTER = 3;

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

  // Backend (optional): the session, and the ranked deck from the feed.
  const feedLoading = useRef(false);
  // Swipes since the deck was last ranked: the feed re-ranks after a few, so what the user just
  // told it reaches the next cards instead of waiting for the page to run out.
  const decidedSinceFetch = useRef(0);
  const refreshFeed = useCallback((includePassed = false) => {
    if (!apiEnabled || feedLoading.current) return;
    feedLoading.current = true;
    decidedSinceFetch.current = 0;
    const s = stateRef.current;
    const exclude = [
      ...s.matchIds,
      ...s.pendingMatches.map((p) => p.characterId),
      ...s.blockedIds,
      ...(includePassed ? [] : s.passedIds),
    ];
    void fetchFeed({ limit: 10, includePassed, exclude })
      .then((r) => {
        if (!r) return;
        const order = r.cards.filter((c) => registerRemoteCharacter(c)).map((c) => c.id);
        if (order.length) dispatch({ type: 'feed', order, requestId: r.requestId });
      })
      .finally(() => {
        feedLoading.current = false;
      });
  }, []);
  useEffect(() => {
    startSession();
    refreshFeed();
  }, [refreshFeed]);
  // Top up the ranked deck before it runs out, and re-rank every REFRESH_AFTER swipes.
  useEffect(() => {
    if (!apiEnabled || !state.feedOrder) return;
    const gone = new Set([...state.matchIds, ...state.passedIds, ...state.pendingMatches.map((p) => p.characterId)]);
    if (state.feedOrder.filter((id) => !gone.has(id)).length < 3 || decidedSinceFetch.current >= REFRESH_AFTER) refreshFeed();
  }, [state.feedOrder, state.matchIds, state.passedIds, state.pendingMatches, refreshFeed]);

  // Chat open time, for chat_close durations.
  const chatOpenedAt = useRef<{ id: string; at: number } | null>(null);
  const noteChatOpen = useCallback((id: string | null) => {
    const prev = chatOpenedAt.current;
    if (prev && prev.id !== id) track('chat_close', prev.id, { duration_ms: Date.now() - prev.at });
    if (id && prev?.id !== id) track('chat_open', id);
    chatOpenedAt.current = id ? (prev?.id === id ? prev : { id, at: Date.now() }) : null;
  }, []);
  useEffect(() => {
    noteChatOpen(state.openChatId);
  }, [state.openChatId, noteChatOpen]);

  // Replies in flight per character: typing stays on until the last one lands.
  const pending = useRef<Record<string, number>>({});
  // Pending-match resolve timers, one per character.
  const matchTimers = useRef<Record<string, number>>({});
  // Clips already scheduled (guards the 1.5s window before the state records them).
  const clipScheduled = useRef<Record<string, boolean>>({});
  const clipTimers = useRef<Record<string, number>>({});


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
      track('message', id, { from: 'persona', text: c.opener, opener: true });
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
      track('match', id, { delayed: true });
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

  // Schedule every pending match from its own `at`.
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
  // (a chat that changed during the 1.5s window) still gets it,
  // once. The live send() path marks `clipScheduled` first, so this never
  // races her reply text.
  useEffect(() => {
    for (const [id, convo] of Object.entries(state.conversations)) {
      if (state.sentClipIds.includes(id) || clipScheduled.current[id]) continue;
      if (!convo.messages.some((m) => m.from === 'me')) continue;
      const c = getCharacter(id);
      if (!c || !c.clip) continue;
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
    // The backend records the user's message itself when it answers; otherwise report it here.
    const answer = (async (): Promise<Message[]> => {
      const remote = apiEnabled ? await remoteReply(id, body) : null;
      if (remote?.messages.length) return remote.messages;
      if (apiEnabled && !remote?.recorded) track('message', id, { from: 'user', text: body, local: true });
      const local = await getReply(character, body, history);
      for (const m of local) track('message', id, { from: 'persona', text: messageText(m), local: true });
      return local;
    })();
    void Promise.all([answer, wait(delay)])
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
    decidedSinceFetch.current++;
    track('swipe', id, { dir: 'like', request_id: current.feedRequestId });
    if (instant) {
      track('match', id, { delayed: false });
      track('message', id, { from: 'persona', text: c.opener, opener: true });
    }
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
      closeChat: () => {
        const open = stateRef.current.openChatId;
        if (open) track('deck_return', open);
        dispatch({ type: 'closeChat' });
      },
      setDrawer: (open) => dispatch({ type: 'setDrawer', open }),
      openProfile: (id) => {
        if (id) track('profile_open', id);
        dispatch({ type: 'openProfile', id });
      },
      like,
      pass: (id) => {
        decidedSinceFetch.current++;
        track('swipe', id, { dir: 'pass', request_id: stateRef.current.feedRequestId });
        dispatch({ type: 'pass', id });
      },
      dismissNotice: (id) => dispatch({ type: 'dismissNotice', id }),
      endMatch: (id, reason) => {
        track(reason, id);
        dispatch({ type: 'endMatch', id });
      },
      resetDeck: () => {
        track('deck_reset');
        dispatch({ type: 'resetDeck' });
        refreshFeed(true);
      },
      send,
      setFilter: (filter) => dispatch({ type: 'setFilter', filter }),
      shown: (id) => {
        track('impression', id, { request_id: stateRef.current.feedRequestId });
        dispatch({ type: 'shown', id });
      },
    }),
    [send, like, refreshFeed]
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
  const { matchIds, passedIds, blockedIds, pendingMatches, feedOrder, shownTopId } = state;
  return useMemo(() => {
    const pendingIds = pendingMatches.map((p) => p.characterId);
    const out = characters.filter(
      (c) => !matchIds.includes(c.id) && !passedIds.includes(c.id) && !blockedIds.includes(c.id) && !pendingIds.includes(c.id)
    );
    // The backend's ranked order first (when it answered), then the local order for anyone it did not rank.
    const feedRank = new Map((feedOrder ?? []).map((id, i) => [id, i]));
    const offset = feedOrder ? feedOrder.length : 0;
    // The card already on screen keeps the top when the ranked feed lands (only then).
    const pinned = feedOrder ? shownTopId : null;
    const rank = (id: string) =>
      id === pinned ? -1 : feedRank.get(id) ?? offset + (deckRank.get(id) ?? rosterRank.get(id) ?? 0);
    return out.sort((a, b) => rank(a.id) - rank(b.id));
  }, [matchIds, passedIds, blockedIds, pendingMatches, feedOrder, shownTopId]);
}

/** True once the first match has RESOLVED: the Chats tab works. */
export function useChatUnlocked(): boolean {
  const { state } = useApp();
  return state.matchIds.length > 0;
}

export function useCharacter(id: string | null): Character | undefined {
  return useMemo(() => (id ? getCharacter(id) : undefined), [id]);
}
