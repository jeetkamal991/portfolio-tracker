import type { Quote } from "@/lib/provider/types";

/**
 * Per-ticker TTL cache in front of a quote fetcher. Fetches only missing/expired tickers.
 * Quotes with a non-finite price are dropped. On fetch error, stale cached quotes are returned
 * where available; the error is rethrown only if nothing at all can be served.
 */
export function createQuoteCache(
  fetcher: (tickers: string[]) => Promise<Quote[]>,
  ttlMs = 60_000,
  clock: () => number = Date.now,
): { get(tickers: string[]): Promise<Quote[]> } {
  const store = new Map<string, { quote: Quote; at: number }>();

  return {
    async get(tickers) {
      const now = clock();
      const missing = tickers.filter((t) => {
        const e = store.get(t);
        return !e || now - e.at >= ttlMs;
      });

      if (missing.length > 0) {
        try {
          const fetched = await fetcher(missing);
          for (const quote of fetched) {
            if (Number.isFinite(quote.price)) store.set(quote.ticker, { quote, at: now });
          }
        } catch (err) {
          const stale = tickers.flatMap((t) => store.get(t)?.quote ?? []);
          if (stale.length === 0) throw err;
          return stale;
        }
      }

      return tickers.flatMap((t) => store.get(t)?.quote ?? []);
    },
  };
}
