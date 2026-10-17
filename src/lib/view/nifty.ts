import type { StoredDay } from "@/lib/db/types";

export type EmaState = { value: number | null; above: boolean | null };
export type NiftyTrend = "above_all" | "mixed" | "below_all" | null;

export interface NiftyCardData {
  cmp: number | null;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  high52: number | null;
  low52: number | null;
  ema20: EmaState;
  ema50: EmaState;
  ema200: EmaState;
  trend: NiftyTrend;
  /** Date of the latest stored row (the session the stored day % belongs to). */
  asOf: string | null;
}

const WEEKS_52 = 252;

/**
 * Without `live`: price from the last priced row, day % from the latest row (provider % or the
 * imported one, as buildTodaySummary). With `live`: price and % from the quote and the previous
 * close derived from them, and the quote's own day high/low (null when it has none; stored rows
 * may belong to an earlier session). Rows with a null
 * close (imported-only) are skipped for prices, 52-week range and EMAs.
 */
export interface LiveNiftyQuote {
  price: number;
  changePct: number;
  dayHigh?: number | null;
  dayLow?: number | null;
}

export function buildNiftyCard(days: StoredDay[], live?: LiveNiftyQuote | null): NiftyCardData {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const priced = sorted.filter((d) => d.close !== null);
  const lastRow = sorted[sorted.length - 1];
  const last = priced[priced.length - 1];
  const prev = priced[priced.length - 2];

  let cmp: number | null;
  let changePct: number | null;
  let prevClose: number | null;
  if (live) {
    cmp = live.price;
    changePct = live.changePct;
    prevClose = live.price / (1 + live.changePct);
  } else {
    cmp = last?.close ?? null;
    changePct = lastRow ? (lastRow.pctChange ?? lastRow.importedPct) : null;
    prevClose = prev?.close ?? null;
  }

  const year = priced.slice(-WEEKS_52);
  const highs = year.map((d) => d.high ?? (d.close as number));
  const lows = year.map((d) => d.low ?? (d.close as number));

  const ema = (value: number | null | undefined): EmaState => {
    const v = value ?? null;
    return { value: v, above: v === null || cmp === null ? null : cmp >= v };
  };
  const ema20 = ema(last?.ema20);
  const ema50 = ema(last?.ema50);
  const ema200 = ema(last?.ema200);
  const states = [ema20.above, ema50.above, ema200.above];
  const trend: NiftyTrend = states.some((s) => s === null)
    ? null
    : states.every((s) => s)
      ? "above_all"
      : states.every((s) => !s)
        ? "below_all"
        : "mixed";

  return {
    cmp,
    change: cmp !== null && prevClose !== null ? cmp - prevClose : null,
    changePct,
    prevClose,
    dayHigh: live ? (live.dayHigh ?? null) : (last?.high ?? null),
    dayLow: live ? (live.dayLow ?? null) : (last?.low ?? null),
    high52: highs.length ? Math.max(...highs) : null,
    low52: lows.length ? Math.min(...lows) : null,
    ema20,
    ema50,
    ema200,
    trend,
    asOf: lastRow?.date ?? null,
  };
}
