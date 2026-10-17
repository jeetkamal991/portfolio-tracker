import { pctChange } from "./pct";
import { emaSeries } from "./ema";
import { rsiSeries } from "./rsi";
import { previousSession, rsVsNifty, sessionCalendar } from "./returns";
import type { IndicatorRow } from "../db/types";

/**
 * Pure per-date indicators over the full ascending close series; one row per input day.
 * `nifty` (NIFTY50's stored closes) is also the trading calendar: when it is non-empty, a day's
 * pctChange is null unless the previous stored bar is the Nifty session immediately before it,
 * so a missed session never turns a multi-day move into a one-day %. With an empty map (or before
 * Nifty's stored history begins), pctChange uses the previous stored bar.
 */
export function computeIndicators(
  days: { date: string; close: number }[],
  nifty: Map<string, number>,
): IndicatorRow[] {
  const dates = days.map((d) => d.date);
  const closes = days.map((d) => d.close);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  const rsi = rsiSeries(closes, 14);
  const rs = rsVsNifty(dates, closes, nifty, 20);
  const cal = nifty.size > 0 ? sessionCalendar(nifty.keys()) : null;
  const contiguous = (i: number) => {
    if (!cal) return true;
    const prev = previousSession(cal, dates[i]!);
    // Before Nifty's stored history begins there is no calendar to check against.
    return prev === undefined || prev === dates[i - 1];
  };
  return days.map((d, i) => ({
    date: d.date,
    pctChange: i === 0 || !contiguous(i) ? null : pctChange(closes[i - 1]!, d.close),
    ema20: ema20[i] ?? null,
    ema50: ema50[i] ?? null,
    ema200: ema200[i] ?? null,
    rsi14: rsi[i] ?? null,
    rsVsNifty: rs[i] ?? null,
  }));
}
