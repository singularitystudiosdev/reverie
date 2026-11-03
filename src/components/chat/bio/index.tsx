/* One effect component per kind, picked by the parsed tag. */
import type { JSX } from 'react';
import { isFxKind } from './kinds';
import type { FxProps } from './FxWord';
import { Bats } from './Bats';
import { Bokeh } from './Bokeh';
import { Bubbles } from './Bubbles';
import { Butterflies } from './Butterflies';
import { Embers } from './Embers';
import { Feathers } from './Feathers';
import { Fireflies } from './Fireflies';
import { Foxfire } from './Foxfire';
import { Frost } from './Frost';
import { Glow } from './Glow';
import { Gradient } from './Gradient';
import { Neon } from './Neon';
import { Petals } from './Petals';
import { Sand } from './Sand';
import { Shimmer } from './Shimmer';
import { Smoke } from './Smoke';
import { Sparks } from './Sparks';
import { Stars } from './Stars';

const EFFECTS: Record<string, (props: FxProps) => JSX.Element> = {
  bats: Bats,
  petals: Petals,
  fireflies: Fireflies,
  bubbles: Bubbles,
  embers: Embers,
  frost: Frost,
  neon: Neon,
  stars: Stars,
  foxfire: Foxfire,
  smoke: Smoke,
  feathers: Feathers,
  sand: Sand,
  sparks: Sparks,
  butterflies: Butterflies,
  bokeh: Bokeh,
  glow: Glow,
  gradient: Gradient,
  shimmer: Shimmer,
};

/**
 * Per-character signature effects, found by file name: custom/<id>.tsx
 * default-exports the component for `{<id>:words}` tags. Each may import its
 * own custom/<id>.css.
 */
const CUSTOM = import.meta.glob('./custom/*.tsx', { eager: true }) as Record<
  string,
  { default: (props: FxProps) => JSX.Element }
>;

const CUSTOM_BY_ID = new Map<string, (props: FxProps) => JSX.Element>(
  Object.entries(CUSTOM).map(([path, mod]) => [path.replace(/^.*\/(.+)\.tsx$/, '$1'), mod.default])
);

export function BioFx(props: { kind: string; text: string }): JSX.Element {
  const Effect = CUSTOM_BY_ID.get(props.kind) ?? (isFxKind(props.kind) ? EFFECTS[props.kind] : undefined) ?? Glow;
  return <Effect text={props.text} />;
}
