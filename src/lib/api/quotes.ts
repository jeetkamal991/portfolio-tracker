import type { Repo } from "@/lib/db/repo";
import { STRIP_KEYS } from "@/lib/instruments";
import type { Quote } from "@/lib/provider/types";
import { isMarketOpen } from "@/lib/time/ist";

export async function handleQuotes(
  repo: Repo,
  cache: { get(tickers: string[]): Promise<Quote[]> },
  now: Date = new Date(),
): Promise<{ quotes: Quote[]; marketOpen: boolean }> {
  const strip = (await Promise.all(STRIP_KEYS.map((k) => repo.getInstrumentByKey(k)))).flatMap((i) => i ?? []);
  const watch = await repo.listWatchlist();
  const tickers = [...new Set([...strip, ...watch].map((i) => i.yahooTicker))];
  return { quotes: await cache.get(tickers), marketOpen: isMarketOpen(now) };
}
