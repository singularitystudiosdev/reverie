/*
  PhoneFrame: the device the app lives in.
  - Phone (< 600px): fills 100dvw x 100dvh, no bezel; screens clear the
    notch and home indicator with --statusbar-h / --tabbar-h (env() safe areas).
  - Desktop (>= 600px, the `frame:` variant): a centered 9:16 phone,
    min(100dvh - 48px, 932px) tall, with a bezel (--radius-48, the stated
    device-mockup exception) on the --t-stage page.
  The fake status bar is <StatusBar/>, rendered inside the themed frame by App.
*/
import type { JSX, ReactNode } from 'react';

export function PhoneFrame(props: { children: ReactNode }): JSX.Element {
  return (
    <div data-slot="stage" className="grid h-dvh w-dvw place-items-center overflow-hidden">
      <div
        data-slot="device"
        className="relative h-[var(--frame-h)] w-[var(--frame-w)] overflow-hidden frame:rounded-48 frame:shadow-[var(--shadow-device)]"
      >
        {props.children}
      </div>
    </div>
  );
}
