export const PERIODS = { d1: 1, w1: 5, m1: 21, m3: 63 } as const;

/** Fractional return over `bars` trading days; null if not enough history. */
export function periodReturn(closes: number[], bars: number): number | null {
  if (closes.length < bars + 1) return null;
  return closes[closes.length - 1]! / closes[closes.length - 1 - bars]! - 1;
}

/**
 * The trading calendar: NIFTY50's stored session dates, ascending, with each date's position.
 * Every instrument's multi-day lookback is measured in these sessions, so a day an instrument
 * is missing (e.g. a THIN sector) never stretches a "1-day" or "20-day" window.
 */
export interface SessionCalendar {
  dates: string[];
  index: Map<string, number>;
}

export function sessionCalendar(dates: Iterable<string>): SessionCalendar {
  const sorted = [...new Set(dates)].sort();
  return { dates: sorted, index: new Map(sorted.map((d, i) => [d, i])) };
}

/** The session `n` sessions before `date` on the calendar; undefined if `date` is not a session or too early. */
export function sessionsBack(cal: SessionCalendar, date: string, n: number): string | undefined {
  const k = cal.index.get(date);
  return k === undefined || k < n ? undefined : cal.dates[k - n];
}

/** The latest session strictly before `date` (works for a `date` the calendar has not stored yet). */
export function previousSession(cal: SessionCalendar, date: string): string | undefined {
  const k = cal.index.get(date);
  if (k !== undefined) return k > 0 ? cal.dates[k - 1] : undefined;
  let lo = 0;
  let hi = cal.dates.length; // first index with dates[i] >= date
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cal.dates[mid]! < date) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? cal.dates[lo - 1] : undefined;
}

/**
 * Close-to-close return from `bars` Nifty sessions before `date` to `date`; null if the
 * instrument has no close on either session.
 */
export function calendarReturn(
  closeOn: Map<string, number>,
  cal: SessionCalendar,
  date: string,
  bars: number,
): number | null {
  const c1 = closeOn.get(date);
  const from = sessionsBack(cal, date, bars);
  const c0 = from === undefined ? undefined : closeOn.get(from);
  return c1 === undefined || c0 === undefined ? null : c1 / c0 - 1;
}

/**
 * Instrument's trailing `bars`-session return minus Nifty's over the same sessions, per index.
 * "`bars` back" is counted on Nifty's calendar (the map's dates); null if the instrument has no
 * close on that session or Nifty has none on the row's date.
 */
export function rsVsNifty(
  dates: string[],
  closes: number[],
  nifty: Map<string, number>,
  bars = 20,
): (number | null)[] {
  const cal = sessionCalendar(nifty.keys());
  const closeOn = new Map(dates.map((d, i) => [d, closes[i]!]));
  return dates.map((d) => {
    const own = calendarReturn(closeOn, cal, d, bars);
    const idx = calendarReturn(nifty, cal, d, bars);
    return own === null || idx === null ? null : own - idx;
  });
}
