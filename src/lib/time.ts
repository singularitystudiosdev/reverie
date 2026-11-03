/*
  Relative timestamps for chat rows and message meta: 'now', '5m', '2h',
  'Tue', 'Oct 3'. Render them with `tabular-nums` so the column lines up.
*/
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const monthDayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** Short relative stamp: 'now', '5m', '2h', 'Tue', 'Oct 3' (and 'Oct 3, 2025' past a year). */
export function relativeTime(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return weekday.format(at);
  const then = new Date(at);
  if (then.getFullYear() === new Date(now).getFullYear()) return monthDay.format(at);
  return monthDayYear.format(at);
}

/** Wall-clock time for a message, e.g. '9:41 PM'. */
export function clockTime(at: number): string {
  return clock.format(at);
}

/** A full, unambiguous stamp for a <time dateTime> attribute. */
export function isoTime(at: number): string {
  return new Date(at).toISOString();
}

export const time = { MINUTE, HOUR, DAY, WEEK } as const;
