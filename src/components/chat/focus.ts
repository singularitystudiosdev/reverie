/*
  Focus helpers for the modal overlays (chats drawer, profile sheet): Tab and
  Shift+Tab cycle inside the overlay while it is open.
*/
import type { KeyboardEvent } from 'react';

const focusable = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** onKeyDown for a modal container: keeps Tab inside it. */
export function trapTab(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return;
  const root = e.currentTarget;
  const items = [...root.querySelectorAll<HTMLElement>(focusable)].filter(
    (el) => el.getClientRects().length > 0
  );
  const first = items.at(0);
  const last = items.at(-1);
  if (!first || !last) {
    e.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || active === root)) {
    e.preventDefault();
    first.focus();
  }
}
