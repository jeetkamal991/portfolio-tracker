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
    });
  });
  it("no constituents gives hasUniverse false and no screeners", async () => {
    const m = await loadMarket(await setup(false), "2026-01-09");
    expect(m.hasUniverse).toBe(false);
    expect(m.screeners).toEqual([]);
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
});
