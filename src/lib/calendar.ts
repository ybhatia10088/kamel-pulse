export const TERM_START = new Date('2025-09-29T00:00:00Z');
export const TERM_END = new Date('2025-12-21T23:59:59Z');

export const WEEKS = [
  { n: 1, start: '2025-09-29', label: 'Sep 29' },
  { n: 2, start: '2025-10-06', label: 'Oct 6' },
  { n: 3, start: '2025-10-13', label: 'Oct 13' },
  { n: 4, start: '2025-10-20', label: 'Oct 20' },
  { n: 5, start: '2025-10-27', label: 'Oct 27' },
  { n: 6, start: '2025-11-03', label: 'Nov 3' },
  { n: 7, start: '2025-11-10', label: 'Nov 10' },
  { n: 8, start: '2025-11-17', label: 'Nov 17' },
  { n: 9, start: '2025-11-24', label: 'Nov 24' }, // THANKSGIVING
  { n: 10, start: '2025-12-01', label: 'Dec 1' },
  { n: 11, start: '2025-12-08', label: 'Dec 8' },
  { n: 12, start: '2025-12-15', label: 'Dec 15' }, // WINTER BREAK EXODUS
] as const;

export const CALENDAR_EVENTS = [
  { name: 'Fall break', start: '2025-10-11', end: '2025-10-14', demandMultiplier: 3.4 },
  { name: 'Thanksgiving', start: '2025-11-22', end: '2025-11-30', demandMultiplier: 8.1 },
  { name: 'Winter break', start: '2025-12-13', end: '2025-12-21', demandMultiplier: 6.7 },
] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Index (0-11) of the WEEKS bucket a date falls in, clamped to the term. */
export function weekIndexForDate(date: Date): number {
  const idx = Math.floor((date.getTime() - TERM_START.getTime()) / WEEK_MS);
  return Math.min(Math.max(idx, 0), WEEKS.length - 1);
}

export function weekStartForDate(date: Date): (typeof WEEKS)[number] {
  return WEEKS[weekIndexForDate(date)];
}

function inRange(date: Date, start: string, end: string): boolean {
  const t = date.getTime();
  return t >= new Date(`${start}T00:00:00Z`).getTime() && t <= new Date(`${end}T23:59:59Z`).getTime();
}

/**
 * Relative demand multiplier for a specific calendar date. Calendar-event
 * windows (fall break, Thanksgiving, winter break) take priority; week 8
 * gets a pre-break booking ramp; everything else is baseline.
 */
export function demandMultiplierForDate(date: Date): number {
  for (const event of CALENDAR_EVENTS) {
    if (inRange(date, event.start, event.end)) return event.demandMultiplier;
  }
  const week8 = WEEKS[7];
  const week8Start = new Date(`${week8.start}T00:00:00Z`);
  const week8End = new Date(week8Start.getTime() + 6 * DAY_MS);
  if (date >= week8Start && date <= week8End) return 1.9;
  return 1.0;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
