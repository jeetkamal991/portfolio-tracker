import type { Repo } from "@/lib/db/repo";
import type { Quote } from "@/lib/provider/types";
import { isMarketOpen, istDate } from "@/lib/time/ist";
import { buildMovers, type MoverEntry, type Movers } from "@/lib/view/movers";

export type MoversResponse =
  | { state: "no_universe" }
  | { state: "no_data"; date: string | null }
  | { state: "ok"; date: string; live: boolean; movers: Movers };

export async function handleMovers(
  repo: Repo,
  cache: { get(tickers: string[]): Promise<Quote[]> },
  now: Date,
): Promise<MoversResponse> {
  // Session date comes from NIFTY50 so weekends and holidays show the newest stored session.
  // Looked up alongside the universe: each database round trip is ~300 ms.
  const [universe, date] = await Promise.all([
    repo.listConstituents("NIFTY200"),
    repo.getInstrumentByKey("NIFTY50").then(async (n) => (n ? (await repo.getLatestDay(n.id))?.date ?? null : null)),
  ]);
  if (universe.length === 0) return { state: "no_universe" };
  if (!date) return { state: "no_data", date: null };

  const stored = await repo.getDaysOn(universe.map((i) => i.id), date);
  const entries = new Map<string, MoverEntry>();
  for (const i of universe) {
    const d = stored.get(i.id);
    if (d) entries.set(i.yahooTicker, { key: i.key, name: i.name, price: d.close, pct: d.pctChange ?? d.importedPct });
  }

  let live = false;
  if (isMarketOpen(now)) {
    try {
      const quotes = await cache.get(universe.map((i) => i.yahooTicker));
      const byTicker = new Map(universe.map((i) => [i.yahooTicker, i]));
      for (const q of quotes) {
        const i = byTicker.get(q.ticker);
        if (i) entries.set(q.ticker, { key: i.key, name: i.name, price: q.price, pct: q.changePct });
      }
      // isMarketOpen ignores NSE holidays; on one Yahoo returns the last session's quotes.
      const today = istDate(now);
      live = quotes.some((q) => istDate(new Date(q.asOf)) === today);
    } catch {
      live = false;
    }
  }

  if (entries.size === 0) return { state: "no_data", date };
  return { state: "ok", date, live, movers: buildMovers([...entries.values()]) };
}
