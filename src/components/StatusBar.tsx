/*
  The fake iOS status bar on the desktop phone mockup (hidden on real phones,
  which draw their own). Decorative: hidden from assistive tech.
*/
import { BatteryFull, Signal, Wifi } from 'lucide-react';
import type { JSX } from 'react';

export function StatusBar(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      data-slot="status-bar"
      className="pointer-events-none absolute inset-x-0 top-0 z-50 hidden h-[var(--statusbar-h)] items-center justify-between px-32 text-ink frame:flex"
    >
      <span className="text-label tabular-nums">9:41</span>
      <span className="flex items-center gap-6">
        <Signal className="size-16" />
        <Wifi className="size-16" />
        <BatteryFull className="size-20" />
      </span>
    </div>
  );
}
