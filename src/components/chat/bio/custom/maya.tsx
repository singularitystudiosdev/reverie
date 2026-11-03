/* Maya: one bespoke scene per charged phrase, built on painted sprites
   (public/fx/maya/*.png) with CSS for glows, flashes and fills.
     city blurring gold  gold bokeh orbs sharpen, swell and melt into blur
     hold that look      a vintage camera raises with a wobble, flashes, a film frame develops
     stay in this light  a warm light leak washes across the word like film
   Any other phrase gets her signature: breathing bokeh, a flash, a leak. The
   word variant is read from the scene's data-word attribute by CSS :has(). */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import './maya.css';

const SPRITE = '/fx/maya/';

function Sprite(props: { name: string; className?: string }): JSX.Element {
  return <img className={props.className} src={`${SPRITE}${props.name}.png`} alt="" draggable={false} decoding="async" />;
}

const CITY_ORBS = [
  { x: '4%', y: '-0.55em', s: 2.2, d: '-0.2s', k: 0 },
  { x: '27%', y: 'calc(100% + 0.5em)', s: 1.8, d: '-1.7s', k: 1 },
  { x: '50%', y: '-0.75em', s: 2.8, d: '-3.4s', k: 2 },
  { x: '73%', y: 'calc(100% + 0.6em)', s: 2.4, d: '-0.9s', k: 3 },
  { x: '96%', y: '-0.45em', s: 2, d: '-2.5s', k: 4 },
] as const;

function City(): JSX.Element {
  return (
    <span className="maya-scene" data-word="city">
      <span className="maya-haze" />
      {CITY_ORBS.map((o) => (
        <span key={o.k} className="fx-p maya-gold" style={v({ '--x': o.x, '--y': o.y, '--s': `${o.s}em`, '--d': o.d, '--i': o.k })}>
          <Sprite name="bokeh" className="maya-gold-img" />
        </span>
      ))}
    </span>
  );
}

function Hold(): JSX.Element {
  return (
    <span className="maya-scene" data-word="hold">
      <span className="maya-flash" />
      <span className="maya-streak" />
      <span className="fx-p maya-cam" style={v({ '--s': '3.6em' })}>
        <Sprite name="camera" className="maya-cam-img" />
        <span className="maya-lens" />
      </span>
      <span className="fx-p maya-frame" style={v({ '--s': '3em' })}>
        <Sprite name="frame" className="maya-frame-img" />
      </span>
    </span>
  );
}

function Light(): JSX.Element {
  return (
    <span className="maya-scene" data-word="light">
      <span className="maya-haze" />
      <span className="fx-p maya-sweep" style={v({ '--s': '4.8em' })}>
        <Sprite name="leak" className="maya-sweep-img" />
      </span>
      <span className="maya-leak" />
      <span className="fx-p maya-gold maya-gold-small" style={v({ '--x': '12%', '--y': 'calc(100% + 0.45em)', '--s': '1.8em', '--d': '-1s', '--i': 1 })}>
        <Sprite name="bokeh" className="maya-gold-img" />
      </span>
      <span className="fx-p maya-gold maya-gold-small" style={v({ '--x': '88%', '--y': '-0.5em', '--s': '2.1em', '--d': '-2.6s', '--i': 3 })}>
        <Sprite name="bokeh" className="maya-gold-img" />
      </span>
    </span>
  );
}

const ORBS = [
  { x: '6%', y: '30%', s: 1.5, d: '-0.4s', t: '4.4s', tone: 'amber', dx: '0.3em', dy: '-0.2em' },
  { x: '31%', y: '78%', s: 1.05, d: '-2.1s', t: '5.2s', tone: 'teal', dx: '-0.25em', dy: '0.15em' },
  { x: '58%', y: '22%', s: 1.25, d: '-1.3s', t: '3.9s', tone: 'cream', dx: '0.2em', dy: '0.2em' },
  { x: '93%', y: '66%', s: 1.6, d: '-3.2s', t: '4.8s', tone: 'amber', dx: '-0.3em', dy: '-0.15em' },
] as const;

function Signature(): JSX.Element {
  return (
    <span className="maya-scene" data-word="signature">
      {ORBS.map((o, i) => (
        <span
          key={i}
          className="fx-p maya-orb"
          data-tone={o.tone}
          style={v({ '--x': o.x, '--y': o.y, '--s': `${o.s}em`, '--d': o.d, '--t': o.t, '--dx': o.dx, '--dy': o.dy })}
        />
      ))}
      <span className="maya-leak" />
      <span className="maya-flash" />
      <span className="maya-streak" />
    </span>
  );
}

export default function MayaFx(props: FxProps): JSX.Element {
  const key = props.text.toLowerCase();
  let scene: JSX.Element;
  if (key.includes('city') || key.includes('blurring')) scene = <City />;
  else if (key.includes('hold') || key.includes('look')) scene = <Hold />;
  else if (key.includes('light')) scene = <Light />;
  else scene = <Signature />;
  return (
    <FxWord kind="maya" text={props.text}>
      {scene}
    </FxWord>
  );
}
