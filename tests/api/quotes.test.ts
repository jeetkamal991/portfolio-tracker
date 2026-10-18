import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";
import { handleQuotes } from "@/lib/api/quotes";

describe("handleQuotes", () => {
  it("includes watchlist and holding tickers once each", async () => {
    const stock = (id: number, key: string): Instrument => ({ id, key, name: key, type: "stock", yahooTicker: `${key}.NS`, active: true });
    const repo = createMemoryRepo({ instruments: [stock(1, "WATCH"), stock(2, "HELD")] });
    await repo.addToWatchlist(1);
    await repo.upsertHolding(1, { qty: 1, avgPrice: 10, buyDate: "2026-10-01", stopLoss: null, target1: null, target2: null });
    await repo.upsertHolding(2, { qty: 1, avgPrice: 10, buyDate: "2026-10-01", stopLoss: null, target1: null, target2: null });
    let asked: string[] = [];
    const cache = { async get(t: string[]) { asked = t; return []; } };
    await handleQuotes(repo, cache, new Date("2026-10-16T05:00:00Z"));
    expect(asked.filter((t) => t === "WATCH.NS")).toHaveLength(1);
    expect(asked).toContain("HELD.NS");
  });
});
