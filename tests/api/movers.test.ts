import { describe, it, expect, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { handleMovers } from "@/lib/api/movers";
import type { Quote } from "@/lib/provider/types";

// 2026-01-05 is a Monday. 10:00 IST = 04:30Z (open); 20:00 IST = 14:30Z (closed).
const OPEN = new Date("2026-01-05T04:30:00Z");
const CLOSED = new Date("2026-01-05T14:30:00Z");
const DATE = "2026-01-02";

const q = (ticker: string, price: number, changePct: number): Quote =>
  ({ ticker, price, changePct, prevClose: price, dayHigh: null, dayLow: null, asOf: "2026-01-05T04:30:00Z" });

const setup = async (opts: { constituents?: boolean; rows?: boolean } = {}) => {
  const repo = createMemoryRepo({
    instruments: [
      { id: 1, key: "NIFTY50", name: "Nifty 50", type: "index", yahooTicker: "^NSEI", active: true },
      { id: 2, key: "AAA", name: "Aaa", type: "stock", yahooTicker: "AAA.NS", active: true },
      { id: 3, key: "BBB", name: "Bbb", type: "stock", yahooTicker: "BBB.NS", active: true },
      { id: 4, key: "CCC", name: "Ccc", type: "stock", yahooTicker: "CCC.NS", active: true },
    ],
  });
  await repo.upsertCandles(1, [{ date: DATE, open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
  if (opts.constituents !== false) await repo.replaceConstituents("NIFTY200", [2, 3, 4]);
  if (opts.rows !== false) {
    for (const [id, close] of [[2, 100], [3, 200], [4, 300]] as const) {
      await repo.upsertCandles(id, [{ date: DATE, open: close, high: close, low: close, close, volume: 1 }]);
    }
    await repo.upsertIndicators(2, [ind(DATE, 0.01)]);
    await repo.upsertIndicators(3, [ind(DATE, -0.02)]);
    await repo.upsertImportedPct([{ instrumentId: 4, date: DATE, importedPct: 0.03 }]);
  }
  return repo;
};
const ind = (date: string, pctChange: number) => ({
  date, pctChange, ema20: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null,
});

describe("handleMovers", () => {
  it("no constituents → no_universe", async () => {
    const cache = { get: vi.fn() };
    expect(await handleMovers(await setup({ constituents: false }), cache, CLOSED)).toEqual({ state: "no_universe" });
  });
  it("constituents but no rows on the date → no_data with the date", async () => {
    const cache = { get: vi.fn() };
    expect(await handleMovers(await setup({ rows: false }), cache, CLOSED)).toEqual({ state: "no_data", date: DATE });
  });
  it("closed market → stored values, live false, cache never called", async () => {
    const cache = { get: vi.fn() };
    const r = await handleMovers(await setup(), cache, CLOSED);
    expect(cache.get).not.toHaveBeenCalled();
    if (r.state !== "ok") throw new Error(r.state);
    expect(r.date).toBe(DATE);
    expect(r.live).toBe(false);
    expect(r.movers.gainers.map((g) => [g.key, g.pct])).toEqual([["CCC", 0.03], ["AAA", 0.01]]);
    expect(r.movers.losers.map((l) => [l.key, l.price])).toEqual([["BBB", 200]]);
  });
  it("open market → one cache call; quoted tickers live, missing ones stored", async () => {
    const cache = { get: vi.fn(async (tickers: string[]) => tickers.length ? [q("AAA.NS", 110, -0.05), q("BBB.NS", 210, 0.04)] : []) };
    const r = await handleMovers(await setup(), cache, OPEN);
    expect(cache.get).toHaveBeenCalledTimes(1);
    expect(cache.get.mock.calls[0][0]).toEqual(expect.arrayContaining(["AAA.NS", "BBB.NS", "CCC.NS"]));
    if (r.state !== "ok") throw new Error(r.state);
    expect(r.live).toBe(true);
    expect(r.movers.gainers.map((g) => [g.key, g.pct, g.price])).toEqual([["BBB", 0.04, 210], ["CCC", 0.03, 300]]);
    expect(r.movers.losers.map((l) => [l.key, l.pct, l.price])).toEqual([["AAA", -0.05, 110]]);
  });
  it("cache throwing → stored movers, live false", async () => {
    const cache = { get: vi.fn(async () => { throw new Error("yahoo down"); }) };
    const r = await handleMovers(await setup(), cache, OPEN);
    if (r.state !== "ok") throw new Error(r.state);
    expect(r.live).toBe(false);
    expect(r.movers.breadth).toEqual({ advances: 2, declines: 1, unchanged: 0, total: 3 });
  });
});
