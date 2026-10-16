import { describe, it, expect, vi } from "vitest";
import { createQuoteCache } from "@/lib/live/quoteCache";
import type { Quote } from "@/lib/provider/types";

const q = (ticker: string, price = 100): Quote => ({ ticker, price, changePct: 0.01, prevClose: 99, asOf: "2026-10-16T05:00:00Z" });

describe("createQuoteCache", () => {
  it("serves a second call within ttl without calling the fetcher", async () => {
    let now = 0;
    const fetcher = vi.fn(async (t: string[]) => t.map((x) => q(x)));
    const cache = createQuoteCache(fetcher, 60_000, () => now);
    await cache.get(["A", "B"]);
    now = 30_000;
    const r = await cache.get(["A", "B"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r.map((x) => x.ticker).sort()).toEqual(["A", "B"]);
  });

  it("refetches after ttl", async () => {
    let now = 0;
    const fetcher = vi.fn(async (t: string[]) => t.map((x) => q(x)));
    const cache = createQuoteCache(fetcher, 60_000, () => now);
    await cache.get(["A"]);
    now = 61_000;
    await cache.get(["A"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fetches only missing tickers", async () => {
    const fetcher = vi.fn(async (t: string[]) => t.map((x) => q(x)));
    const cache = createQuoteCache(fetcher, 60_000, () => 0);
    await cache.get(["A"]);
    await cache.get(["A", "B"]);
    expect(fetcher).toHaveBeenLastCalledWith(["B"]);
  });

  it("returns stale quotes when the fetch fails", async () => {
    let now = 0;
    let fail = false;
    const fetcher = vi.fn(async (t: string[]) => {
      if (fail) throw new Error("boom");
      return t.map((x) => q(x));
    });
    const cache = createQuoteCache(fetcher, 60_000, () => now);
    await cache.get(["A"]);
    now = 120_000;
    fail = true;
    const r = await cache.get(["A", "B"]);
    expect(r.map((x) => x.ticker)).toEqual(["A"]);
  });

  it("rethrows when the fetch fails and nothing is cached", async () => {
    const cache = createQuoteCache(async () => { throw new Error("boom"); }, 60_000, () => 0);
    await expect(cache.get(["A"])).rejects.toThrow("boom");
  });

  it("drops quotes whose price is not finite", async () => {
    const cache = createQuoteCache(async () => [q("A", NaN), q("B", 5), q("C", Infinity)], 60_000, () => 0);
    const r = await cache.get(["A", "B", "C"]);
    expect(r.map((x) => x.ticker)).toEqual(["B"]);
  });
});
