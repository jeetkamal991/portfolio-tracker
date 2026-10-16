import YahooFinance from "yahoo-finance2";
import { istDate } from "@/lib/time/ist";
import { withRetry } from "./retry";
import type { Candle, MarketDataProvider, Quote } from "./types";

export interface ChartBar {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}
export interface ChartResultLike { quotes: ChartBar[] }
export interface QuoteLike {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketPreviousClose?: number;
  regularMarketTime?: Date;
}

/** Minimal surface of yahoo-finance2 used here; tests inject a fake. */
export interface YahooLike {
  chart(ticker: string, opts: { period1: Date; period2: Date; interval: "1d" }): Promise<ChartResultLike>;
  quote(tickers: string[]): Promise<QuoteLike[]>;
}

/** Map chart bars to IST-dated candles: drop null closes, one per date (last bar wins), ascending. */
export function mapChart(result: ChartResultLike): Candle[] {
  const byDate = new Map<string, Candle>();
  const bars = [...result.quotes].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const b of bars) {
    if (b.close == null) continue;
    const date = istDate(b.date);
    byDate.set(date, {
      date,
      open: b.open ?? b.close,
      high: b.high ?? b.close,
      low: b.low ?? b.close,
      close: b.close,
      volume: b.volume ?? 0,
    });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function mapQuote(q: QuoteLike): Quote {
  return {
    ticker: q.symbol,
    price: q.regularMarketPrice ?? NaN,
    changePct: (q.regularMarketChangePercent ?? 0) / 100,
    prevClose: q.regularMarketPreviousClose ?? NaN,
    asOf: (q.regularMarketTime ?? new Date()).toISOString(),
  };
}

function defaultClient(): YahooLike {
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
  return {
    chart: async (ticker, opts) => (await yf.chart(ticker, opts)) as unknown as ChartResultLike,
    quote: async (tickers) => (await yf.quote(tickers)) as unknown as QuoteLike[],
  };
}

const DAY_MS = 86_400_000;

export function createYahooProvider(
  client?: YahooLike,
  sleep?: (ms: number) => Promise<void>,
): MarketDataProvider {
  let c = client;
  const get = () => (c ??= defaultClient());
  return {
    async getDailyHistory(ticker, fromDate, toDate) {
      // Start one day early and end two days after toDate (UTC midnight) so every
      // IST session in [fromDate, toDate] is covered; exact bounds applied below.
      const period1 = new Date(Date.parse(`${fromDate}T00:00:00Z`) - DAY_MS);
      const period2 = new Date(Date.parse(`${toDate}T00:00:00Z`) + 2 * DAY_MS);
      const res = await withRetry(() => get().chart(ticker, { period1, period2, interval: "1d" }), 3, 1000, sleep);
      return mapChart(res).filter((x) => x.date >= fromDate && x.date <= toDate);
    },
    async getQuotes(tickers) {
      if (tickers.length === 0) return [];
      const res = await withRetry(() => get().quote(tickers), 3, 1000, sleep);
      return res.map(mapQuote);
    },
  };
}
