import type { OhlcvDay } from "@/lib/db/types";

export interface StockSeries<D extends OhlcvDay = OhlcvDay> {
  key: string;
  name: string;
  days: D[];
}

export interface Strategy<D extends OhlcvDay = OhlcvDay> {
  id: string;
  label: string;
  params: Record<string, string | number>;
  /** Rows of history `pick` can read per stock; the engine never shows it more. */
  lookback: number;
  /**
   * Stocks to buy after the close of `date`, highest priority first, at most `limit`.
   * `window` holds each stock that has a row on `date`, with only its last `lookback` rows ending on `date`.
   */
  pick(window: StockSeries<D>[], date: string, limit: number): string[];
}
