export const PERIODS = { d1: 1, w1: 5, m1: 21, m3: 63 } as const;

/** Fractional return over `bars` trading days; null if not enough history. */
export function periodReturn(closes: number[], bars: number): number | null {
  if (closes.length < bars + 1) return null;
  return closes[closes.length - 1]! / closes[closes.length - 1 - bars]! - 1;
}

/** Stock's trailing `bars`-day return minus Nifty's over the same dates, per index. */
export function rsVsNifty(
  dates: string[],
  closes: number[],
  nifty: Map<string, number>,
  bars = 20,
): (number | null)[] {
  return closes.map((c, i) => {
    if (i < bars) return null;
    const n1 = nifty.get(dates[i]!);
    const n0 = nifty.get(dates[i - bars]!);
    if (n1 === undefined || n0 === undefined) return null;
    return c / closes[i - bars]! - 1 - (n1 / n0 - 1);
  });
}
