/*
  PhoneFrame: the stage the app lives on.
  - Portrait phone (under 600px wide): the app fills 100dvw x 100dvh edge to
    edge. Screens clear the notch and home indicator with --statusbar-h /
    --bottom-room (env() safe areas).
  - Every other viewport (the `frame:` variant: desktop, tablet, a phone on its
    side, a short or zoomed window): an EXACT 9:16 rounded rectangle centered
    on the --t-stage page, as tall as the window allows with a 24px gutter, in
    any window shape (tokens.css --frame-h / --frame-w). Corner --radius-32,
    --shadow-64. No bezel and no status bar: --statusbar-h is 0 inside it.
*/
import type { JSX, ReactNode } from 'react';

export function PhoneFrame(props: { children: ReactNode }): JSX.Element {
  return (
    <div data-slot="stage" className="grid h-dvh w-dvw place-items-center overflow-hidden">
      <div
        data-slot="device"
        className="relative h-[var(--frame-h)] w-[var(--frame-w)] overflow-hidden frame:rounded-32 frame:shadow-64"
      >
        {props.children}
      </div>
    </div>
  );
}
