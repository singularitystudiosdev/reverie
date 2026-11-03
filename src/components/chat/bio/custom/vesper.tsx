/* Vesper: one bespoke beat per charged word, each played by painted sprites
   (public/fx/vesper). The word is picked from its text:
   - unbuttoned: a jet velvet button strains on its thread, pops off, tumbles
     and rolls to rest while a scalloped lace edge goes slack;
   - stays: a candle beside it gutters, then its flame steadies and wax runs;
   - whisper your name: crimson mist curls through the line, a rose petal drifts;
   - hungry: blood rises in the letters and a drop swells, hangs and falls;
   - ask: a bat hovers, swoops in, lands on the k, folds, looks around, leaves.
   Anything else gets her signature: a heartbeat bloom and two falling beads.
   Everything sits above, below or behind the letters (the layer is z -1). */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import './vesper.css';

function Sprite(props: { name: string }): JSX.Element {
  return <img className="vs-sprite" src={`/fx/vesper/${props.name}.png`} alt="" draggable={false} />;
}

function PetalShape(): JSX.Element {
  return (
    <svg viewBox="0 0 24 30" width="100%" height="100%" className="vs-petal-svg" focusable="false">
      <defs>
        <radialGradient id="vs-petal-fill" cx="38%" cy="30%" r="80%">
          <stop offset="0%" className="vs-petal-hi" />
          <stop offset="55%" className="vs-petal-mid" />
          <stop offset="100%" className="vs-petal-lo" />
        </radialGradient>
      </defs>
      <path d="M12 1.5 C18 5 23 13 19 21 C17 26 14 28.5 12 29 C10 28.5 7 26 5 21 C1 13 6 5 12 1.5Z" fill="url(#vs-petal-fill)" />
      <path d="M12 4 C12.6 11 12.4 20 12 27" className="vs-petal-vein" fill="none" />
    </svg>
  );
}

function CurlShape(props: { d: string; delay: string }): JSX.Element {
  return (
    <svg viewBox="0 0 120 28" preserveAspectRatio="none" className="vs-curl" style={v({ '--o': props.delay })} focusable="false">
      <path d={props.d} pathLength={1} />
    </svg>
  );
}

function Unbuttoned(): JSX.Element {
  return (
    <span className="vs-scene vs-unbuttoned">
      <span className="vs-back" />
      <span className="vs-lace" />
      <span className="vs-actor vs-button">
        <Sprite name="button" />
        <i className="vs-glint" />
      </span>
    </span>
  );
}

function Stays(): JSX.Element {
  return (
    <span className="vs-scene vs-stays">
      <span className="vs-actor vs-candle">
        <span className="vs-flame-glow" />
        <Sprite name="candle" />
        <span className="vs-flame">
          <Sprite name="candle" />
        </span>
        <i className="vs-wax" />
        <i className="vs-ember vs-ember-a" />
        <i className="vs-ember vs-ember-b" />
      </span>
    </span>
  );
}

function Whisper(): JSX.Element {
  return (
    <span className="vs-scene vs-whisper">
      <span className="vs-mist" style={v({ '--y': '-0.2em', '--o': '0s', '--h': '1.5em' })} />
      <span className="vs-mist" style={v({ '--y': '0.35em', '--o': '-2.3s', '--h': '1.2em' })} />
      <span className="vs-mist" style={v({ '--y': '0em', '--o': '-4.4s', '--h': '1.7em' })} />
      <CurlShape d="M2 17 C18 -3 34 31 54 13 S92 3 118 15" delay="0s" />
      <CurlShape d="M2 11 C22 30 40 -4 62 16 S98 28 118 9" delay="-1.9s" />
      <span className="vs-petal">
        <span className="vs-petal-sway">
          <PetalShape />
        </span>
      </span>
    </span>
  );
}

function Hungry(): JSX.Element {
  return (
    <span className="vs-scene vs-hungry">
      <span className="vs-back" />
      <span className="vs-bead" />
      <span className="vs-actor vs-drop">
        <Sprite name="blood" />
      </span>
    </span>
  );
}

function Ask(): JSX.Element {
  return (
    <span className="vs-scene vs-ask">
      <span className="vs-back" />
      <span className="vs-actor vs-bat-fly">
        <span className="vs-flap">
          <Sprite name="bat" />
        </span>
      </span>
      <span className="vs-actor vs-bat-perch">
        <Sprite name="bat" />
      </span>
    </span>
  );
}

function Signature(): JSX.Element {
  return (
    <span className="vs-scene vs-sig">
      <span className="vs-pulse" />
      <span className="vs-sig-drop" style={v({ '--x': '27%', '--d': '0s', '--t': '5.6s' })} />
      <span className="vs-sig-drop" style={v({ '--x': '68%', '--d': '-2.9s', '--t': '7.2s' })} />
    </span>
  );
}

export default function VesperFx(props: FxProps): JSX.Element {
  const word = props.text.trim().toLowerCase();
  return (
    <FxWord kind="vesper" text={props.text}>
      {word === 'unbuttoned' ? (
        <Unbuttoned />
      ) : word === 'stays' ? (
        <Stays />
      ) : word === 'whisper your name' ? (
        <Whisper />
      ) : word === 'hungry' ? (
        <Hungry />
      ) : word === 'ask' ? (
        <Ask />
      ) : (
        <Signature />
      )}
    </FxWord>
  );
}
