import { describe, it, expect, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { loadMarket } from "@/lib/api/market";
import { SCREENERS } from "@/lib/calc/screeners";

const instruments = [
  { id: 1, key: "NIFTY50", name: "Nifty 50", type: "index" as const, yahooTicker: "^NSEI", active: true },
  { id: 2, key: "INDIAVIX", name: "India VIX", type: "index" as const, yahooTicker: "^INDIAVIX", active: true },
  { id: 3, key: "AAA", name: "Aaa", type: "stock" as const, yahooTicker: "AAA.NS", active: true },
  { id: 4, key: "BBB", name: "Bbb", type: "stock" as const, yahooTicker: "BBB.NS", active: true },
];
const dates = ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]; // 01-09 is a Friday
const ind = (date: string, pctChange: number, rsi14: number | null = null) => ({
  date, pctChange, ema20: null, ema50: null, ema200: 100, rsi14, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null,
});

const setup = async (withUniverse = true) => {
  const repo = createMemoryRepo({ instruments });
  for (const id of [1, 2, 3, 4]) {
    await repo.upsertCandles(id, dates.map((date, i) => ({ date, open: 100, high: 100, low: 100, close: 100 + i, volume: 1 })));
  }
  await repo.upsertIndicators(2, dates.map((d) => ind(d, 0.01)));
  await repo.upsertIndicators(3, dates.map((d) => ind(d, 0.01, 75)));
  await repo.upsertIndicators(4, dates.map((d) => ind(d, -0.01, 20)));
  if (withUniverse) await repo.replaceConstituents("NIFTY200", [3, 4]);
  return repo;
};

describe("loadMarket", () => {
  it("no NIFTY50 row gives an empty result", async () => {
    const repo = createMemoryRepo({ instruments });
    await repo.replaceConstituents("NIFTY200", [3]);
    expect(await loadMarket(repo, "2026-01-09")).toEqual({
      session: null, summary: null, screeners: [], breadth: null, hasUniverse: true,
      watchSignals: { crosses: [], formations: [] }, hasWatchStocks: false, stakes: null, alphas: [],
    });
  });
  it("no constituents gives hasUniverse false and no screeners", async () => {
    const m = await loadMarket(await setup(false), "2026-01-09");
    expect(m.hasUniverse).toBe(false);
    expect(m.screeners).toEqual([]);
    expect(m.alphas).toEqual([]);
  });
  it("reads the last 30 priced sessions and returns the combined card plus six alphas", async () => {
    const many = Array.from({ length: 35 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    const repo = createMemoryRepo({ instruments });
    for (const id of [1, 3]) await repo.upsertCandles(id, many.map((date, i) => ({ date, open: 100, high: 100, low: 100, close: 100 + i, volume: 1 })));
    await repo.replaceConstituents("NIFTY200", [3]);
    const wide = vi.spyOn(repo, "getDaysRange");
    const narrow = vi.spyOn(repo, "getOhlcvRange");
    const m = await loadMarket(repo, many[34]);
    expect(wide.mock.calls[0][1]).toBe(many[29]); // screeners keep their 6 sessions, with indicators
    expect(narrow).toHaveBeenCalledTimes(1);
    expect(narrow.mock.calls[0][0]).toEqual([3]); // the Nifty 200 members only
    expect(narrow.mock.calls[0][1]).toBe(many[5]); // 30 sessions ending on many[34]
    expect(m.alphas.map((r) => r.id)).toEqual(["combined", "a001", "a002", "a006", "a012", "a054", "a101"]);
  });
  it("a failing alpha fetch drops the alpha section, not the page", async () => {
    const repo = await setup();
    vi.spyOn(repo, "getOhlcvRange").mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await loadMarket(repo, "2026-01-09");
    expect(m.alphas).toEqual([]);
    expect(m.screeners).toHaveLength(10);
    expect(m.breadth).not.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
  it("short history leaves the alphas that need more bars with no stocks, and the page data still loads", async () => {
    const m = await loadMarket(await setup(), "2026-01-09"); // 7 sessions: a001, a002 and a006 need more
    const count = (id: string) => m.alphas.find((r) => r.id === id)?.count;
    expect([count("a001"), count("a002"), count("a006")]).toEqual([0, 0, 0]);
    expect(count("a054")).toBe(0); // flat bars (high = low) cannot be scored
    expect([count("a012"), count("a101")]).toEqual([2, 2]);
    expect(count("combined")).toBe(0); // only two alphas scored, three are needed
    expect(m.screeners).toHaveLength(10);
  });
  it("returns 10 screeners in SCREENERS order, breadth, and calls getDaysRange once", async () => {
    const repo = await setup();
    const spy = vi.spyOn(repo, "getDaysRange");
    const m = await loadMarket(repo, "2026-01-09");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe("2026-01-02"); // oldest of the last 6 sessions
    expect(spy.mock.calls[0][2]).toBe("2026-01-09");
    expect(m.session).toBe("2026-01-09");
    expect(m.hasUniverse).toBe(true);
    expect(m.screeners.map((s) => s.id)).toEqual(SCREENERS.map((s) => s.id));
    expect(m.screeners.find((s) => s.id === "rsi_high")?.count).toBe(1);
    expect(m.screeners.find((s) => s.id === "rsi_low")?.count).toBe(1);
    expect(m.breadth).toMatchObject({ advances: 1, declines: 1, total: 2, adRatio: 1 });
    expect(m.breadth?.vix.close).toBe(106);
    expect(m.breadth?.vix.spark).toHaveLength(7);
  });
  it("a trailing null-close NIFTY50 row does not shrink the screener window", async () => {
    const repo = await setup();
    await repo.upsertIndicators(1, [ind("2026-01-12", 0.01)]); // newer row, close is null
    const spy = vi.spyOn(repo, "getDaysRange");
    const m = await loadMarket(repo, "2026-01-09");
    expect(m.session).toBe("2026-01-09");
    expect(spy.mock.calls[0][1]).toBe("2026-01-02");
  });
  it("a stale stock contributes nothing to breadth", async () => {
    const repo = await setup();
    const m0 = await loadMarket(repo, "2026-01-09");
    expect(m0.breadth?.total).toBe(2);
    const stale = createMemoryRepo({ instruments });
    for (const id of [1, 2, 3]) await stale.upsertCandles(id, [{ date: "2026-01-09", open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
    await stale.upsertCandles(4, [{ date: "2026-01-08", open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
    await stale.upsertIndicators(3, [ind("2026-01-09", 0.01)]);
    await stale.upsertIndicators(4, [ind("2026-01-08", -0.01)]);
    await stale.replaceConstituents("NIFTY200", [3, 4]);
    expect((await loadMarket(stale, "2026-01-09")).breadth).toMatchObject({ advances: 1, declines: 0, total: 1 });
  });
  it("weekend today still returns Friday's summary", async () => {
    const repo = createMemoryRepo({ instruments });
    await repo.upsertCandles(1, [{ date: "2026-01-09", open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
    (repo as unknown as { _summaries: Map<string, unknown> })._summaries.set("2026-01-09", {
      date: "2026-01-09", summary: "Friday wrap.", marketEvents: [], watchlistNews: [],
    });
    const m = await loadMarket(repo, "2026-01-10");
    expect(m.summary?.summary).toBe("Friday wrap.");
  });

  describe("watch signals", () => {
    const holding = { qty: 1, avgPrice: 100, buyDate: "2026-01-02", stopLoss: null, target1: null, target2: null };
    // close 100..106 against a flat EMA 200 of 103.5 → closes above it on 01-07 (row 4 of the window)
    const above200 = (id: number, repo: Awaited<ReturnType<typeof setup>>) =>
      repo.upsertIndicators(id, dates.map((d, i) => ({ ...ind(d, 0.01), ema200: 103.5, patterns: i === 6 ? [{ name: "doji", bias: "neutral" as const }] : null })));

    it("no watchlist or holdings gives hasWatchStocks false and empty signals", async () => {
      const m = await loadMarket(await setup(), "2026-01-09");
      expect(m.hasWatchStocks).toBe(false);
      expect(m.watchSignals).toEqual({ crosses: [], formations: [] });
    });
    it("covers watchlist + holdings once each, in the same range query", async () => {
      const repo = await setup();
      await above200(3, repo);
      await repo.addToWatchlist(3);
      await repo.upsertHolding(3, holding); // also on the watchlist → counted once
      await repo.upsertHolding(2, holding); // outside the universe → still fetched
      const spy = vi.spyOn(repo, "getDaysRange");
      const m = await loadMarket(repo, "2026-01-09");
      expect(spy).toHaveBeenCalledTimes(1);
      expect([...spy.mock.calls[0][0]].sort()).toEqual([2, 3, 4]);
      expect(m.hasWatchStocks).toBe(true);
      expect(m.watchSignals.crosses).toEqual([
        { key: "AAA", name: "Aaa", date: "2026-01-07", label: "Closed above EMA 200", bias: "bullish" },
      ]);
      expect(m.watchSignals.formations).toEqual([
        { key: "AAA", name: "Aaa", date: "2026-01-09", label: "Doji", bias: "neutral" },
      ]);
    });
    it("works without a Nifty 200 universe", async () => {
      const repo = await setup(false);
      await above200(3, repo);
      await repo.addToWatchlist(3);
      const m = await loadMarket(repo, "2026-01-09");
      expect(m.screeners).toEqual([]);
      expect(m.watchSignals.crosses.map((c) => c.label)).toEqual(["Closed above EMA 200"]);
    });
  });

  it("stakes is null until shareholding exists, then ranks FII and DII increases", async () => {
    const repo = await setup();
    expect((await loadMarket(repo, "2026-01-09")).stakes).toBeNull();
    const row = (instrumentId: number, quarterEnd: string, fiiPct: number, diiPct: number) => ({ instrumentId, quarterEnd, fiiPct, diiPct, promoterPct: 50, sourceUrl: null });
    await repo.upsertShareholding([
      row(3, "2026-06-30", 10, 20), row(3, "2026-09-30", 11, 19),
      row(4, "2026-06-30", 10, 20), row(4, "2026-09-30", 9, 21.5),
    ]);
    const m = await loadMarket(repo, "2026-01-09");
    expect(m.stakes?.fii.hits.map((h) => [h.key, h.change])).toEqual([["AAA", 1]]);
    expect(m.stakes?.dii.hits.map((h) => [h.key, h.change])).toEqual([["BBB", 1.5]]);
    expect(m.stakes?.fii).toMatchObject({ label: "Jul–Sep 2026", reported: 2, total: 2 });
  });
});
