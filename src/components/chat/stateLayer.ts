/*
  The M3 state layer as a ::before in the content color, under the content
  (isolate + -z-10) and following the control's own radius: hover +8%,
  focus +10%, press +10% (tokens.css --state-layer-*). Opacity only, so it
  needs no reduced-motion guard and survives one as the press feedback.
  The caller positions the control (`relative`, or `absolute` for a floating
  button): the layer fills its box.
*/
export const stateLayer = [
  'isolate',
  'before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit]',
  'before:bg-current before:opacity-0',
  'before:transition-opacity before:duration-[var(--duration-150)] before:ease-standard',
  'hover:before:opacity-[var(--state-layer-hover)]',
  'focus-visible:before:opacity-[var(--state-layer-focus)]',
  'active:before:opacity-[var(--state-layer-press)]',
].join(' ');

/** A selected item keeps the focus-strength layer at rest (the current chat). */
export const stateLayerSelected = 'before:opacity-[var(--state-layer-focus)]';
