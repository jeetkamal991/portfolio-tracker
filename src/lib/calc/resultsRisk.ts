/** A results date this many days away or closer (and not past) is shown as a warning. */
export const RESULTS_WARN_DAYS = 7;

/** Calendar days from `today` to `date` (both YYYY-MM-DD) when it falls within the warning window, else null (none, past or far off). */
export function daysToResults(date: string | null | undefined, today: string): number | null {
  if (!date) return null;
  const n = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  return n >= 0 && n <= RESULTS_WARN_DAYS ? n : null;
}

export const resultsLabel = (n: number) => (n === 0 ? "Results today" : n === 1 ? "Results tomorrow" : `Results in ${n} days`);
