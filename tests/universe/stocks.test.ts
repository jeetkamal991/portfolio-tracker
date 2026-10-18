import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";
import { listUniverseStocks } from "@/lib/universe/stocks";

const stock = (id: number, key: string, active = true): Instrument => ({ id, key, name: key, type: "stock", yahooTicker: `${key}.NS`, active });

describe("listUniverseStocks", () => {
  it("is Nifty 200 ∪ every sector's constituents ∪ watchlist, active stocks only, each once", async () => {
    const repo = createMemoryRepo({
      instruments: [
        stock(1, "N200"), stock(2, "BOTH"), stock(3, "SECTORONLY"), stock(4, "WATCH"), stock(5, "DEAD", false),
        { id: 6, key: "NIFTY_IT", name: "Nifty IT", type: "sector", yahooTicker: "^CNXIT", active: true },
        stock(7, "OTHERINDEX"),
      ],
    });
    await repo.replaceConstituents("NIFTY200", [1, 2]);
    await repo.replaceConstituents("NIFTY_IT", [2, 3, 5]);
    await repo.replaceConstituents("NIFTY_MEDIA", [3]);
    await repo.replaceConstituents("SOMETHING_ELSE", [7]); // not a sector key: excluded
    await repo.addToWatchlist(4);
    await repo.addToWatchlist(6); // a sector on the watchlist is not a stock
    const keys = (await listUniverseStocks(repo)).map((i) => i.key).sort();
    expect(keys).toEqual(["BOTH", "N200", "SECTORONLY", "WATCH"]);
  });
});
