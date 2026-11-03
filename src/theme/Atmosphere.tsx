/*
  Atmosphere: the full-frame background behind the UI. Scaffold version: a
  two-stop gradient of the theme's canvas colors (they tween through the
  registered --t-* properties) plus her scene plate, cross-fading on theme
  change. The theme unit replaces this with overlays and the particle canvas.
*/
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState, type JSX } from 'react';
import { artSize } from '../data/characters';
import type { ThemeSpec } from '../data/types';
import { dur, ease, reducedFade } from '../lib/motion';

export function Atmosphere(props: { spec: ThemeSpec; sceneSrc: string | null }): JSX.Element {
  const { spec, sceneSrc } = props;
  const reduce = useReducedMotion();
  const fade = { duration: reduce ? reducedFade : dur.theme, ease: ease.continuous };

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-linear-to-b from-canvas-2 to-canvas" />
      <AnimatePresence initial={false}>
        {sceneSrc && spec.sceneOpacity > 0 ? (
          <ScenePlate key={sceneSrc} src={sceneSrc} opacity={spec.sceneOpacity} transition={fade} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ScenePlate(props: {
  src: string;
  opacity: number;
  transition: { duration: number; ease: readonly [number, number, number, number] };
}): JSX.Element | null {
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  if (state === 'missing') return null;
  return (
    <motion.img
      src={props.src}
      alt=""
      width={artSize.full.width}
      height={artSize.full.height}
      decoding="async"
      loading="lazy"
      onLoad={() => setState('ready')}
      onError={() => setState('missing')}
      initial={{ opacity: 0 }}
      animate={{ opacity: state === 'ready' ? props.opacity : 0 }}
      exit={{ opacity: 0 }}
      transition={props.transition}
      className="absolute inset-0 size-full object-cover"
    />
  );
}
