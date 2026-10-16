import { pctChange } from "./pct";
import { emaSeries } from "./ema";
import { rsiSeries } from "./rsi";
import { rsVsNifty } from "./returns";
import type { IndicatorRow } from "../db/types";

/** Pure per-date indicators over the full ascending close series; one row per input day. */
export function computeIndicators(
  days: { date: string; close: number }[],
  nifty: Map<string, number>,
): IndicatorRow[] {
  const dates = days.map((d) => d.date);
  const closes = days.map((d) => d.close);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  const rsi = rsiSeries(closes, 14);
  const rs = rsVsNifty(dates, closes, nifty, 20);
  return days.map((d, i) => ({
    date: d.date,
    pctChange: i === 0 ? null : pctChange(closes[i - 1]!, d.close),
    ema50: ema50[i] ?? null,
    ema200: ema200[i] ?? null,
    rsi14: rsi[i] ?? null,
    rsVsNifty: rs[i] ?? null,
  }));
}
