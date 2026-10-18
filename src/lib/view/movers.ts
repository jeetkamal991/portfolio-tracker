export interface MoverEntry { key: string; name: string; price: number | null; pct: number | null }
export interface Movers {
  gainers: MoverEntry[];
  losers: MoverEntry[];
  breadth: { advances: number; declines: number; unchanged: number; total: number };
}

const byKey = (a: MoverEntry, b: MoverEntry) => a.key.localeCompare(b.key);

/** Gainers are pct > 0 only, losers pct < 0 only, so no stock is ever in both lists. */
export function buildMovers(entries: MoverEntry[], n = 5): Movers {
  const priced = entries.filter((e): e is MoverEntry & { pct: number } => e.pct !== null);
  const gainers = priced.filter((e) => e.pct > 0).sort((a, b) => b.pct - a.pct || byKey(a, b)).slice(0, n);
  const losers = priced.filter((e) => e.pct < 0).sort((a, b) => a.pct - b.pct || byKey(a, b)).slice(0, n);
  return {
    gainers,
    losers,
    breadth: {
      advances: priced.filter((e) => e.pct > 0).length,
      declines: priced.filter((e) => e.pct < 0).length,
      unchanged: priced.filter((e) => e.pct === 0).length,
      total: priced.length,
    },
  };
}
