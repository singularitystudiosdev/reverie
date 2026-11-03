/* Maya's opening cinematic. When her profile opens: a vintage camera pops in
   with a wobble, fires, and a flash whites out the frame; the bio text is
   hidden in the white, then DEVELOPS like a print (blurred, sepia and bright,
   easing to sharp, true colour) while warm light leaks sweep across, gold
   bokeh drifts up and a film frame develops in the corner. Plays once (about
   2.8 s), then removes itself and returns the bio to normal. */
import { useLayoutEffect, useState, type JSX } from 'react';
import { v } from '../FxWord';
import { asset } from '../../../../lib/asset';
import './maya.intro.css';

type IntroProps = { bio: HTMLElement; frame: HTMLElement };

const TOTAL_MS = 2900;

const ORBS = [
  { x: 14, y: 78, s: 120, delay: 0.5, dur: 2.2, dx: 24 },
  { x: 38, y: 90, s: 170, delay: 0.7, dur: 2.4, dx: -30 },
  { x: 66, y: 84, s: 110, delay: 0.6, dur: 2.1, dx: 18 },
  { x: 88, y: 94, s: 150, delay: 0.9, dur: 2.3, dx: -22 },
  { x: 52, y: 70, s: 90, delay: 1.0, dur: 1.9, dx: 12 },
] as const;

export default function MayaIntro({ bio }: IntroProps): JSX.Element | null {
  const [alive, setAlive] = useState(true);

  useLayoutEffect(() => {
    // the text is lost in the white, then develops like a photo print
    const develop = bio.animate(
      [
        { opacity: 0, filter: 'blur(12px) sepia(1) brightness(2.6) contrast(0.5)', offset: 0 },
        { opacity: 0, filter: 'blur(12px) sepia(1) brightness(2.6) contrast(0.5)', offset: 0.14 },
        { opacity: 0.85, filter: 'blur(9px) sepia(1) brightness(2) contrast(0.55) saturate(0.7)', offset: 0.26 },
        { opacity: 0.95, filter: 'blur(5px) sepia(0.85) brightness(1.4) contrast(0.8)', offset: 0.5 },
        { opacity: 1, filter: 'blur(1.6px) sepia(0.4) brightness(1.12) contrast(0.95)', offset: 0.78 },
        { opacity: 1, filter: 'blur(0px) sepia(0) brightness(1) contrast(1)', offset: 1 },
      ],
      { duration: 2300, easing: 'ease-out', fill: 'both' }
    );
    const timer = window.setTimeout(() => setAlive(false), TOTAL_MS);
    return () => {
      window.clearTimeout(timer);
      develop.cancel();
    };
  }, [bio]);

  if (!alive) return null;

  return (
    <div className="maya-intro" aria-hidden="true">
      {ORBS.map((o, i) => (
        <span key={i} className="maya-intro-orb" style={v({ '--x': `${o.x}%`, '--y': `${o.y}%`, '--s': `${o.s}px`, '--delay': `${o.delay}s`, '--dur': `${o.dur}s`, '--dx': `${o.dx}px` })}>
          <img src={asset("/fx/maya/bokeh.png")} alt="" draggable={false} />
        </span>
      ))}
      <span className="maya-intro-leak maya-intro-leak-a">
        <img src={asset("/fx/maya/leak.png")} alt="" draggable={false} />
      </span>
      <span className="maya-intro-leak maya-intro-leak-b">
        <img src={asset("/fx/maya/leak.png")} alt="" draggable={false} />
      </span>
      <span className="maya-intro-print">
        <img src={asset("/fx/maya/frame.png")} alt="" draggable={false} />
      </span>
      <span className="maya-intro-cam">
        <img src={asset("/fx/maya/camera.png")} alt="" draggable={false} />
        <span className="maya-intro-lens" />
      </span>
      <div className="maya-intro-white" />
    </div>
  );
}
