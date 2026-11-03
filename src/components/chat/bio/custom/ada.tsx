/* Ada: one deliberate gesture per charged word, built on painted sprites
   (public/fx/ada/*.png) with CSS only for heat, glints, seams and fills.
     "problem"          a wrench spins in from the right, lands with weight, wobbles to rest
     "engine room heat" two brass gears turn against each other, steam vents, the word runs hot
     "welding"          a torch draws a white-hot seam under the word and bursts into sparks
     "steady hands"     the word trembles, goggles flip down, and it holds perfectly still
     anything else      the gears and a slow brass polish
   Each word's beat is its own loop with its own length, so they never fire together. */
import type { JSX } from 'react';
import { FxWord, v, type FxProps } from '../FxWord';
import './ada.css';

const SPRITE = (name: string): string => `/fx/ada/${name}.png`;

function Sprite(props: { name: string; className: string }): JSX.Element {
  return <img className={`ada-sp ${props.className}`} src={SPRITE(props.name)} alt="" draggable={false} />;
}

function Wrench(): JSX.Element {
  return (
    <>
      <span className="ada-haze ada-haze-wrench" />
      <span className="ada-fly">
        <span className="ada-tumble">
          <Sprite name="wrench" className="ada-wrench-sp" />
        </span>
      </span>
      <span className="ada-impact">
        <span className="ada-ring" />
        <span className="ada-glint" />
      </span>
    </>
  );
}

/** d: delay inside the shared 6.4s cycle; dx/dy: where the puff ends up; k: its size. */
const PUFFS = [
  { d: '0s', dx: '0.25em', dy: '-1.25em', k: 0.8 },
  { d: '0.35s', dx: '0.7em', dy: '-1.1em', k: 1 },
  { d: '0.75s', dx: '0.05em', dy: '-1.3em', k: 0.9 },
] as const;

function Engine(): JSX.Element {
  return (
    <>
      <span className="ada-haze ada-haze-engine" />
      <span className="ada-gears">
        <Sprite name="gear" className="ada-gear ada-gear-big" />
        <Sprite name="gear" className="ada-gear ada-gear-small" />
      </span>
      <span className="ada-vent">
        {PUFFS.map((p, i) => (
          <span key={i} className="ada-puff" style={v({ '--d': p.d, '--dx': p.dx, '--dy': p.dy, '--k': p.k })}>
            <span className="ada-steam-sp" />
          </span>
        ))}
      </span>
    </>
  );
}

/** Streak angles of the burst, in degrees, and their reach. */
const STREAKS = [
  { a: '-172deg', r: '0.7em', d: '0s' },
  { a: '-146deg', r: '0.95em', d: '0.02s' },
  { a: '-118deg', r: '0.8em', d: '0.01s' },
  { a: '-92deg', r: '1em', d: '0.03s' },
  { a: '-62deg', r: '0.85em', d: '0s' },
  { a: '-34deg', r: '0.95em', d: '0.02s' },
  { a: '-8deg', r: '0.7em', d: '0.01s' },
  { a: '24deg', r: '0.5em', d: '0.03s' },
] as const;

function Weld(): JSX.Element {
  return (
    <>
      <span className="ada-haze ada-haze-weld" />
      <span className="ada-seam">
        <span className="ada-seam-trail" />
        <span className="ada-seam-head" />
      </span>
      <span className="ada-burst">
        <Sprite name="spark" className="ada-spark-sp" />
        {STREAKS.map((s, i) => (
          <span key={i} className="ada-streak" style={v({ '--a': s.a, '--r': s.r, '--sd': s.d })}>
            <span className="ada-streak-bar" />
          </span>
        ))}
      </span>
    </>
  );
}

function Goggles(): JSX.Element {
  return (
    <>
      <span className="ada-haze ada-haze-goggles" />
      <span className="ada-lens">
        <span className="ada-flipdown">
          <Sprite name="goggles" className="ada-goggles-sp" />
          <span className="ada-lens-glint" />
        </span>
      </span>
    </>
  );
}

export default function AdaFx(props: FxProps): JSX.Element {
  const word = props.text.toLowerCase();
  const which = word.includes('problem') ? 'wrench' : word.includes('engine') ? 'engine' : word.includes('weld') ? 'weld' : word.includes('steady') ? 'goggles' : 'engine';
  return (
    <FxWord kind="ada" text={props.text}>
      <span className="ada-stage" data-word={which}>
        {which === 'wrench' ? <Wrench /> : which === 'engine' ? <Engine /> : which === 'weld' ? <Weld /> : <Goggles />}
      </span>
    </FxWord>
  );
}
