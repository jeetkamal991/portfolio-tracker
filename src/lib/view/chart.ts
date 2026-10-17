import type { StoredDay } from "@/lib/db/types";

export type ChartRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";

/** Daily bars per range; 1D/1W show the last 5/10 bars. */
export const RANGE_BARS: Record<ChartRange, number | null> = { "1D": 5, "1W": 10, "1M": 21, "3M": 63, "6M": 126, "1Y": 252, ALL: null };
export const RANGES = Object.keys(RANGE_BARS) as ChartRange[];

export type LinePoint = { time: string; value: number };

export interface ChartData {
  candles: { time: string; open: number; high: number; low: number; close: number }[];
  volume: { time: string; value: number; up: boolean }[];
  volSma20: LinePoint[];
  ema20: LinePoint[];
  ema50: LinePoint[];
  ema200: LinePoint[];
  rsi: LinePoint[];
  bbUpper: LinePoint[];
  bbMiddle: LinePoint[];
  bbLower: LinePoint[];
  macd: LinePoint[];
  macdSignal: LinePoint[];
  macdHist: LinePoint[];
}

const VOL_SMA = 20;

type Priced = StoredDay & { open: number; high: number; low: number; close: number };

/**
 * Rows with a full OHLC, ascending, sliced to the range's last N bars (all when the range is
 * longer than the data). Line series keep only non-null points. `volSma20` is the mean of the 20
 * volumes ending at and including each bar (a display overlay), computed over the full series
 * before slicing so the first visible point is correct; a window with a missing volume is skipped.
 */
export function buildChartData(days: StoredDay[], range: ChartRange): ChartData {
  const priced = days
    .filter((d): d is Priced => d.open !== null && d.high !== null && d.low !== null && d.close !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const sma: (number | null)[] = priced.map((_, i) => {
    if (i < VOL_SMA - 1) return null;
    let sum = 0;
    for (let k = i - VOL_SMA + 1; k <= i; k++) {
      const v = priced[k]!.volume;
      if (v === null) return null;
      sum += v;
    }
    return sum / VOL_SMA;
  });

  const n = RANGE_BARS[range];
  const start = n === null ? 0 : Math.max(0, priced.length - n);
  const rows = priced.slice(start);
  const line = (pick: (d: Priced, i: number) => number | null): LinePoint[] =>
    rows.flatMap((d, i) => {
      const value = pick(d, i);
      return value === null ? [] : [{ time: d.date, value }];
    });

  return {
    candles: rows.map((d) => ({ time: d.date, open: d.open, high: d.high, low: d.low, close: d.close })),
    volume: rows.flatMap((d) => (d.volume === null ? [] : [{ time: d.date, value: d.volume, up: d.close >= d.open }])),
    volSma20: line((_, i) => sma[start + i] ?? null),
    ema20: line((d) => d.ema20),
    ema50: line((d) => d.ema50),
    ema200: line((d) => d.ema200),
    rsi: line((d) => d.rsi14),
    bbUpper: line((d) => d.bbUpper),
    bbMiddle: line((d) => d.bbMiddle),
    bbLower: line((d) => d.bbLower),
    macd: line((d) => d.macd),
    macdSignal: line((d) => d.macdSignal),
    macdHist: line((d) => d.macdHist),
  };
}
