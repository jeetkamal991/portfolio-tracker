import type { Repo } from "@/lib/db/repo";
import type { Instrument } from "@/lib/db/types";
import { SECTOR_KEYS } from "@/lib/instruments";

/**
 * The stock universe the jobs price and score: Nifty 200 constituents, every sector index's
 * constituents (some, e.g. most of Nifty Media, are outside the Nifty 200) and watchlist stocks.
 * Active stocks only, each once.
 */
export async function listUniverseStocks(repo: Repo): Promise<Instrument[]> {
  const lists = await Promise.all([
    repo.listConstituents("NIFTY200"),
    ...SECTOR_KEYS.map((k) => repo.listConstituents(k)),
    repo.listWatchlist(),
  ]);
  const seen = new Set<number>();
  return lists.flat().filter((i) => i.type === "stock" && i.active && !seen.has(i.id) && !!seen.add(i.id));
}
