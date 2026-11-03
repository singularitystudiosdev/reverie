/*
  Composition: AppProvider > PhoneFrame > ThemeProvider > LayoutGroup.
  Routing is store state, not URLs, and there is no chats list:
    openChatId set -> ChatView; otherwise Explore.
  The Chats tab opens the last chat (the store's setTab) and the chats drawer
  in the chat header is the only list of chats.
  Transitions (AnimatePresence, both screens mounted together):
    - any route change (Explore <-> chat, chat <-> chat): a 300ms cross-fade
      (screens are transparent over the shared atmosphere)
    - reduced motion: an instant swap, no fade
*/
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  type Transition,
  type Variants,
} from 'motion/react';
import type { JSX } from 'react';
import { LiquidGlassDefs } from './components/LiquidGlassDefs';
import { MatchNotice } from './components/MatchNotice';
import { PhoneFrame } from './components/PhoneFrame';
import { ProfileSheet } from './components/ProfileSheet';
import { TabBar } from './components/TabBar';
import { dur, ease, instant, useReducedMotion } from './lib/motion';
import { ChatView } from './screens/ChatView';
import { Explore } from './screens/Explore';
import { AppProvider, useApp } from './state/store';
import { ThemeProvider } from './theme/ThemeProvider';

type RouteKey = 'explore' | `chat:${string}`;

const fadeT: Transition = { duration: dur.slow, ease: ease.continuous };

const screenVariants: Variants = {
  enter: (reduce: boolean) => ({ opacity: reduce ? 1 : 0 }),
  center: (reduce: boolean) => ({ opacity: 1, transition: reduce ? instant : fadeT }),
  exit: (reduce: boolean) => ({ opacity: 0, transition: reduce ? instant : fadeT }),
};

function Routes(): JSX.Element {
  const { state } = useApp();
  const reduce = useReducedMotion();
  const route: RouteKey = state.openChatId ? `chat:${state.openChatId}` : 'explore';
  const screen = state.openChatId ? <ChatView characterId={state.openChatId} /> : <Explore />;

  return (
    <main className="absolute inset-0 overflow-hidden">
      <AnimatePresence initial={false} custom={reduce}>
        <motion.div
          key={route}
          custom={reduce}
          variants={screenVariants}
          initial="enter"
          animate="center"
          exit="exit"
          className="absolute inset-0"
          style={{ zIndex: state.openChatId ? 1 : 0 }}
        >
          {screen}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

export default function App(): JSX.Element {
  return (
    <MotionConfig reducedMotion="never">
      <AppProvider>
        <LiquidGlassDefs />
        <PhoneFrame>
          <ThemeProvider>
            <LayoutGroup>
              <Routes />
              <TabBar />
              <ProfileSheet />
              <MatchNotice />
            </LayoutGroup>
          </ThemeProvider>
        </PhoneFrame>
      </AppProvider>
    </MotionConfig>
  );
}
