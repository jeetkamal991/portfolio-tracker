import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { handleSearch } from "@/lib/api/search";

const repo = () =>
  createMemoryRepo({
    instruments: [
      { id: 1, key: "RELIANCE", name: "Reliance Industries", type: "stock", yahooTicker: "RELIANCE.NS", active: true },
      { id: 2, key: "NIFTY_ENERGY", name: "Nifty Energy", type: "sector", yahooTicker: "^CNXENERGY", active: true },
      { id: 3, key: "NIFTY50", name: "Nifty 50", type: "index", yahooTicker: "^NSEI", active: true },
    ],
  });

describe("handleSearch", () => {
  it("is stocks only by default", async () => {
    expect(await handleSearch(repo(), "reli")).toEqual([{ key: "RELIANCE", name: "Reliance Industries", type: "stock" }]);
    expect(await handleSearch(repo(), "nifty")).toEqual([]);
  });
  it("scope=all includes indices and sectors", async () => {
    expect((await handleSearch(repo(), "nifty", "all")).map((h) => [h.key, h.type])).toEqual([
      ["NIFTY_ENERGY", "sector"],
      ["NIFTY50", "index"],
    ]);
  });
  it("ignores terms shorter than two characters", async () => {
    expect(await handleSearch(repo(), " n ", "all")).toEqual([]);
  });
});
