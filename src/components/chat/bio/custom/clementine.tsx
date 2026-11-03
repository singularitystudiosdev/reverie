/* Clementine: one bespoke scene per charged phrase, built on painted sprites
   (public/fx/clementine/*.png) with CSS for glows, strands and fills.
     turn up         a butterfly flutters in, lands with a bounce, settles its wings, lifts off
     what you crave  a honey dipper tips, a strand stretches, a bead lets go and splashes, honey floods the word
     last slice      a pie slice on a little plate slides in, overshoots, settles, steams
     fuss over you   a sunflower turns toward the word while a bee loops a figure-eight
   Any other phrase gets her signature: honey fill, slow drips, a bee. The word
   variant is read from the scene's data-word attribute by CSS :has(). */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import './clementine.css';

const SPRITE = '/fx/clementine/';

function Sprite(props: { name: string; className?: string }): JSX.Element {
  return <img className={props.className} src={`${SPRITE}${props.name}.png`} alt="" draggable={false} decoding="async" />;
}

/** The drawn bee: the sunflower sprite has a bee baked into it, so no separate sprite exists. */
function BeeShape(): JSX.Element {
  return (
    <svg viewBox="0 0 24 16" width="0.95em" height="0.63em" className="clem-bee-svg" focusable="false">
      <ellipse className="clem-wing clem-wing-back" cx="10.5" cy="5" rx="4.6" ry="3" />
      <ellipse className="clem-wing clem-wing-front" cx="13.5" cy="5" rx="5" ry="3.2" />
      <ellipse className="clem-body" cx="12" cy="10" rx="8" ry="5" />
      <path className="clem-stripe" d="M9 5.4 Q8 10 9 14.6 L11.2 14.9 Q10.2 10 11.2 5.1Z" />
      <path className="clem-stripe" d="M14.2 5.1 Q13.2 10 14.2 14.9 L16.4 14.4 Q15.4 10 16.4 5.6Z" />
      <circle className="clem-head" cx="20.4" cy="10" r="2.9" />
      <path className="clem-sting" d="M3.9 10 L1.4 10.4 L3.9 11Z" />
    </svg>
  );
}

function BeeLoop(): JSX.Element {
  return (
    <span className="clem-path">
      <span className="clem-x">
        <span className="clem-y">
          <span className="clem-face">
            <BeeShape />
          </span>
        </span>
      </span>
    </span>
  );
}

const DRIPS = [
  { x: '16%', t: '6.6s', d: '-1.2s', s: 1 },
  { x: '47%', t: '7.8s', d: '-4.6s', s: 0.82 },
  { x: '81%', t: '5.9s', d: '-2.7s', s: 0.94 },
] as const;

function Drips(props: { only?: number }): JSX.Element {
  return (
    <>
      {DRIPS.map((dr, i) =>
        props.only !== undefined && props.only !== i ? null : (
          <span key={i} className="clem-drip" style={v({ '--x': dr.x, '--t': dr.t, '--d': dr.d, '--k': dr.s })}>
            <span className="clem-strand" />
            <span className="clem-bead" />
          </span>
        )
      )}
    </>
  );
}

function TurnUp(): JSX.Element {
  return (
    <span className="clem-scene" data-word="turn-up">
      <span className="clem-halo" />
      <span className="fx-p clem-bfly" style={v({ '--s': '2.8em' })}>
        <Sprite name="butterfly" className="clem-bfly-img" />
      </span>
      <span className="clem-pop clem-pop-a" />
      <span className="clem-pop clem-pop-b" />
    </span>
  );
}

function Crave(): JSX.Element {
  return (
    <span className="clem-scene" data-word="crave">
      <span className="clem-halo" />
      <span className="fx-p clem-dipper" style={v({ '--s': '3em' })}>
        <Sprite name="honey" className="clem-dipper-img" />
      </span>
      <span className="clem-pour">
        <span className="clem-pour-strand" />
        <span className="clem-pour-bead" />
      </span>
      <span className="clem-splat" />
      <Drips only={2} />
    </span>
  );
}

function LastSlice(): JSX.Element {
  return (
    <span className="clem-scene" data-word="slice">
      <span className="clem-halo" />
      <span className="fx-p clem-pie" style={v({ '--s': '2.8em' })}>
        <Sprite name="pie" className="clem-pie-img" />
        <span className="clem-steam clem-steam-a" />
        <span className="clem-steam clem-steam-b" />
        <span className="clem-glint" />
      </span>
    </span>
  );
}

function Fuss(): JSX.Element {
  return (
    <span className="clem-scene" data-word="fuss">
      <span className="clem-halo" />
      <span className="fx-p clem-sun" style={v({ '--s': '3em' })}>
        <Sprite name="sunflower" className="clem-sun-img" />
      </span>
      <BeeLoop />
    </span>
  );
}

function Signature(): JSX.Element {
  return (
    <span className="clem-scene" data-word="signature">
      <Drips />
      <BeeLoop />
    </span>
  );
}

export default function ClementineFx(props: FxProps): JSX.Element {
  const key = props.text.toLowerCase();
  let scene: JSX.Element;
  if (key.includes('turn up')) scene = <TurnUp />;
  else if (key.includes('crave')) scene = <Crave />;
  else if (key.includes('slice')) scene = <LastSlice />;
  else if (key.includes('fuss')) scene = <Fuss />;
  else scene = <Signature />;
  return (
    <FxWord kind="clementine" text={props.text}>
      {scene}
    </FxWord>
  );
}
