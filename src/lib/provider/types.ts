export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  ticker: string;
  price: number;
  /** fraction, e.g. -0.0088 for -0.88% */
  changePct: number;
  prevClose: number;
  /** ISO timestamp */
  asOf: string;
}

export interface MarketDataProvider {
  /** Inclusive IST YYYY-MM-DD bounds; result ascending by IST date. */
  getDailyHistory(ticker: string, fromDate: string, toDate: string): Promise<Candle[]>;
  getQuotes(tickers: string[]): Promise<Quote[]>;
}
