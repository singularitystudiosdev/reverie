/*
  Composition: AppProvider > PhoneFrame > ThemeProvider > LayoutGroup.
  Routing is store state, not URLs:
    openChatId set -> ChatView; else tab 'chats' -> ChatList; else Explore.
  Transitions (AnimatePresence, both screens mounted together):
    - tab switch: 300ms cross-fade
    - chat push (list -> chat): 500ms slide in from the right, the list eases
      back and fades (screens are transparent over the shared atmosphere)
    - chat pop (chat -> list): 300ms, the reverse
    - reduced motion: an instant swap, no slide and no fade
*/
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
  type Transition,
  type Variants,
} from 'motion/react';
import { useState, type JSX } from 'react';
import { PhoneFrame } from './components/PhoneFrame';
import { ProfileSheet } from './components/ProfileSheet';
import { StatusBar } from './components/StatusBar';
import { TabBar } from './components/TabBar';
import { MatchOverlay } from './components/explore/MatchOverlay';
import { dur, ease, instant, pushBackX } from './lib/motion';
import { ChatList } from './screens/ChatList';
import { ChatView } from './screens/ChatView';
import { Explore } from './screens/Explore';
import { AppProvider, useApp } from './state/store';
import { ThemeProvider } from './theme/ThemeProvider';

type RouteKey = 'chats' | 'explore' | `chat:${string}`;
type Kind = 'push' | 'pop' | 'fade' | 'none';

const isChat = (route: RouteKey) => route.startsWith('chat:');

function kindOf(prev: RouteKey, next: RouteKey, reduce: boolean): Kind {
  if (reduce) return 'none';
  if (!isChat(prev) && isChat(next)) return 'push';
  if (isChat(prev) && next === 'chats') return 'pop';
  return 'fade';
}

const pushT: Transition = { duration: dur.deliberate /* deliberate */, ease: ease.enter };
const popT: Transition = { duration: dur.slow, ease: ease.continuous };
const fadeT: Transition = { duration: dur.slow, ease: ease.continuous };
// Screens are transparent over the shared atmosphere, so the screen that
// eases back also fades: the list must not show through the incoming chat.
const pushBackT: Transition = { x: pushT, opacity: { duration: dur.base, ease: ease.exit } };
const popInT: Transition = { x: popT, opacity: { duration: dur.slow, ease: ease.enter } };
const popOutT: Transition = { x: popT, opacity: { duration: dur.base, ease: ease.exit } };

const screenVariants: Variants = {
  enter: (k: Kind) =>
    k === 'push'
      ? { x: '100%', opacity: 1 }
      : k === 'pop'
        ? { x: pushBackX, opacity: 0 }
        : k === 'fade'
          ? { x: 0, opacity: 0 }
          : { x: 0, opacity: 1 },
  center: (k: Kind) => ({
    x: 0,
    opacity: 1,
    transition: k === 'push' ? pushT : k === 'pop' ? popInT : k === 'fade' ? fadeT : instant,
  }),
  exit: (k: Kind) =>
    k === 'push'
      ? { x: pushBackX, opacity: 0, transition: pushBackT }
      : k === 'pop'
        ? { x: '100%', opacity: 0, transition: popOutT }
        : k === 'fade'
          ? { opacity: 0, transition: fadeT }
          : { opacity: 0, transition: instant },
};

function Routes(): JSX.Element {
  const { state } = useApp();
  const reduce = useReducedMotion() ?? false;
  const route: RouteKey = state.openChatId ? `chat:${state.openChatId}` : state.tab;

  // The transition kind belongs to the route CHANGE, so it is fixed when the
  // route changes and never recomputed mid-transition by unrelated renders.
  const [nav, setNav] = useState<{ route: RouteKey; kind: Kind }>({ route, kind: 'none' });
  let kind = nav.kind;
  if (nav.route !== route) {
    kind = kindOf(nav.route, route, reduce);
    setNav({ route, kind });
  }

  const screen = state.openChatId ? (
    <ChatView characterId={state.openChatId} />
  ) : state.tab === 'chats' ? (
    <ChatList />
  ) : (
    <Explore />
  );

  return (
    <main className="absolute inset-0 overflow-hidden">
      <AnimatePresence initial={false} custom={kind}>
        <motion.div
          key={route}
          custom={kind}
          variants={screenVariants}
          initial="enter"
          animate="center"
          exit="exit"
          className="absolute inset-0"
          style={{ zIndex: isChat(route) ? 1 : 0 }}
        >
          {screen}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

export default function App(): JSX.Element {
  return (
    <MotionConfig reducedMotion="user">
      <AppProvider>
        <PhoneFrame>
          <ThemeProvider>
            <LayoutGroup>
              <Routes />
              <TabBar />
              <ProfileSheet />
              <MatchOverlay />
            </LayoutGroup>
            <StatusBar />
          </ThemeProvider>
        </PhoneFrame>
      </AppProvider>
    </MotionConfig>
  );
}
