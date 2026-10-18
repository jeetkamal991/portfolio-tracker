import { describe, it, expect, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { loadSectorAnalysis } from "@/lib/api/sectors";

const D1 = "2026-10-15";
const D2 = "2026-10-16";
const candle = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 1 });
const ind = (date: string, pctChange: number) => ({
  date, pctChange, ema20: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null,
});

const setup = async (opts: { memberships?: boolean } = {}) => {
  const repo = createMemoryRepo({
    instruments: [
      { id: 1, key: "NIFTY50", name: "Nifty 50", type: "index", yahooTicker: "^NSEI", active: true },
      // Inserted IT first to prove the output follows SECTOR_KEYS order (BANK before IT).
      { id: 2, key: "NIFTY_IT", name: "Nifty IT", type: "sector", yahooTicker: "^CNXIT", active: true },
      { id: 3, key: "NIFTY_BANK", name: "Nifty Bank", type: "sector", yahooTicker: "^NSEBANK", active: true },
      { id: 4, key: "TCS", name: "TCS", type: "stock", yahooTicker: "TCS.NS", active: true },
      { id: 5, key: "INFY", name: "Infosys", type: "stock", yahooTicker: "INFY.NS", active: true },
      { id: 6, key: "HDFCBANK", name: "HDFC Bank", type: "stock", yahooTicker: "HDFCBANK.NS", active: true },
      { id: 7, key: "SBIN", name: "SBI", type: "stock", yahooTicker: "SBIN.NS", active: true },
    ],
  });
  for (const id of [1, 2, 3, 4, 5, 6]) await repo.upsertCandles(id, [candle(D1, 100), candle(D2, 101)]);
  await repo.upsertIndicators(4, [ind(D2, 0.02)]);
  await repo.upsertIndicators(5, [ind(D2, -0.01)]);
  await repo.upsertIndicators(6, [ind(D2, 0.005)]);
  // SBIN (7) has no row on the session date.
  if (opts.memberships !== false) {
    await repo.replaceConstituents("NIFTY_IT", [4, 5]);
    await repo.replaceConstituents("NIFTY_BANK", [6, 7]);
    await repo.replaceConstituents("NIFTY200", [4, 5, 6, 7]);
  }
  return repo;
};

describe("loadSectorAnalysis", () => {
  it("builds tiles in SECTOR_KEYS order, constituents by sector, rotation", async () => {
    const repo = await setup();
    const spy = vi.spyOn(repo, "getDaysOn");
    const a = await loadSectorAnalysis(repo);
    expect(a.sessionDate).toBe(D2);
    expect(a.tiles.map((t) => t.key)).toEqual(["NIFTY_BANK", "NIFTY_IT"]);
    expect(a.hasConstituents).toBe(true);
    expect(a.constituents.NIFTY_IT.map((c) => c.key)).toEqual(["TCS", "INFY"]);
    expect(a.constituents.NIFTY_BANK.map((c) => [c.key, c.dayPct])).toEqual([["HDFCBANK", 0.005], ["SBIN", null]]);
    expect(a.tiles[1]).toMatchObject({ constituentCount: 2, topGainers: [{ key: "TCS" }], topLosers: [{ key: "INFY" }] });
    expect(a.rotation.map((r) => r.key).sort()).toEqual(["NIFTY_BANK", "NIFTY_IT"]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(D2);
  });
  it("builds the daily log from Nifty session dates and sector pct changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T06:00:00Z"));
    try {
      const repo = await setup();
      await repo.upsertIndicators(1, [ind(D2, 0.004)]);
      await repo.upsertIndicators(2, [ind(D2, -0.01)]);
      const [oct] = (await loadSectorAnalysis(repo)).dailyLog;
      expect(oct.id).toBe("2026-10");
      expect(oct.rows.map((r) => r.date)).toEqual([D1, D2]);
      expect(oct.rows[1].values).toMatchObject({ NIFTY50: 0.004, NIFTY_IT: -0.01, NIFTY_BANK: null });
      expect(oct.totals.NIFTY50.sum).toBeCloseTo(0.004, 10);
    } finally {
      vi.useRealTimers();
    }
  });
  it("no memberships → hasConstituents false and empty lists", async () => {
    const a = await loadSectorAnalysis(await setup({ memberships: false }));
    expect(a.hasConstituents).toBe(false);
    expect(a.tiles).toHaveLength(2);
    expect(a.constituents).toEqual({ NIFTY_BANK: [], NIFTY_IT: [] });
  });
  it("empty database → no session, no tiles", async () => {
    const a = await loadSectorAnalysis(createMemoryRepo());
    expect(a).toMatchObject({ sessionDate: null, tiles: [], constituents: {}, rotation: [], hasConstituents: false });
    expect(a.dailyLog).toHaveLength(6);
    expect(a.dailyLog.every((m) => m.rows.length === 0)).toBe(true);
  });
});
