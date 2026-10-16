import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";

const inst = (id: number, key: string, name: string, type: Instrument["type"] = "stock"): Instrument => ({
  id, key, name, type, yahooTicker: `${key}.NS`, active: true,
});
const candle = (date: string, close: number) => ({ date, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 });
const ind = (date: string, ema50: number) => ({ date, pctChange: 0.01, ema50, ema200: null, rsi14: 55, rsVsNifty: null });

describe("memoryRepo", () => {
  it("keeps OHLC and indicators when both are upserted on the same date", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.upsertCandles(1, [candle("2026-01-01", 100)]);
    await r.upsertIndicators(1, [ind("2026-01-01", 99)]);
    const [d] = await r.getDays(1, 10);
    expect(d.close).toBe(100);
    expect(d.high).toBe(101);
    expect(d.ema50).toBe(99);
    expect(d.pctChange).toBe(0.01);
    await r.upsertCandles(1, [candle("2026-01-01", 105)]);
    const [d2] = await r.getDays(1, 10);
    expect(d2.close).toBe(105);
    expect(d2.ema50).toBe(99);
  });

  it("upsertImportedPct does not erase close and creates absent rows", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.upsertCandles(1, [candle("2026-01-01", 100)]);
    await r.upsertImportedPct([
      { instrumentId: 1, date: "2026-01-01", importedPct: 0.02 },
      { instrumentId: 1, date: "2025-12-31", importedPct: -0.01 },
    ]);
    const days = await r.getDays(1, 10);
    expect(days.map((d) => d.date)).toEqual(["2025-12-31", "2026-01-01"]);
    expect(days[1].close).toBe(100);
    expect(days[1].importedPct).toBe(0.02);
    expect(days[0].close).toBeNull();
    expect(days[0].importedPct).toBe(-0.01);
  });

  it("getDays(id, 2) returns the newest two ascending", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.upsertCandles(1, [candle("2026-01-03", 3), candle("2026-01-01", 1), candle("2026-01-02", 2)]);
    expect((await r.getDays(1, 2)).map((d) => d.date)).toEqual(["2026-01-02", "2026-01-03"]);
  });

  it("getDays with a limit larger than stored count returns everything ascending", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    const dates: string[] = [];
    for (let i = 0; i < 1500; i++) {
      dates.push(new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10));
    }
    await r.upsertCandles(1, [...dates].reverse().map((d, i) => candle(d, i)));
    const days = await r.getDays(1, 100_000);
    expect(days.map((d) => d.date)).toEqual(dates);
  });

  it("setAutoLevels leaves manual values unchanged and vice versa", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.setManualLevels(1, 10, 20);
    await r.setAutoLevels(1, 11, 21);
    expect(await r.getLevels(1)).toEqual({ autoSupport: 11, autoResistance: 21, manualSupport: 10, manualResistance: 20 });
    await r.setManualLevels(1, null, null);
    expect(await r.getLevels(1)).toEqual({ autoSupport: 11, autoResistance: 21, manualSupport: null, manualResistance: null });
  });

  it("getLevels on unknown id returns all nulls", async () => {
    const r = createMemoryRepo();
    expect(await r.getLevels(999)).toEqual({ autoSupport: null, autoResistance: null, manualSupport: null, manualResistance: null });
  });

  it("upserts instruments by key, filters, searches stocks only", async () => {
    const r = createMemoryRepo();
    await r.upsertInstruments([
      { key: "NIFTY", name: "Nifty 50", type: "index", yahooTicker: "^NSEI", active: true },
      { key: "TCS", name: "Tata Consultancy", type: "stock", yahooTicker: "TCS.NS", active: true },
      { key: "TATA", name: "Tata Motors", type: "stock", yahooTicker: "TATAMOTORS.NS", active: false },
    ]);
    await r.upsertInstruments([{ key: "TCS", name: "TCS Ltd", type: "stock", yahooTicker: "TCS.NS", active: true }]);
    expect((await r.listInstruments()).length).toBe(3);
    expect((await r.listInstruments({ types: ["stock"], activeOnly: true })).map((i) => i.key)).toEqual(["TCS"]);
    expect((await r.getInstrumentByKey("TCS"))?.name).toBe("TCS Ltd");
    expect(await r.getInstrumentByKey("NOPE")).toBeNull();
    expect((await r.searchInstruments("tata", 10)).map((i) => i.key)).toEqual(["TATA"]);
    expect(await r.searchInstruments("nifty", 10)).toEqual([]);
  });

  it("manages watchlist and job runs", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa"), inst(2, "BBB", "Bbb")] });
    await r.addToWatchlist(2);
    await r.addToWatchlist(2);
    await r.addToWatchlist(1);
    expect((await r.listWatchlist()).map((i) => i.id).sort()).toEqual([1, 2]);
    await r.removeFromWatchlist(2);
    expect((await r.listWatchlist()).map((i) => i.id)).toEqual([1]);

    expect(await r.lastJobRun("eod")).toBeNull();
    await r.logJobRun({ job: "eod", startedAt: "2026-01-01T10:00:00Z", finishedAt: "2026-01-01T10:01:00Z", status: "ok", message: "a" });
    await r.logJobRun({ job: "eod", startedAt: "2026-01-02T10:00:00Z", finishedAt: "2026-01-02T10:01:00Z", status: "failed", message: "b" });
    expect((await r.lastJobRun("eod"))?.message).toBe("b");
  });

  it("last write wins for duplicate dates in one upsertCandles call", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.upsertCandles(1, [candle("2026-01-01", 100), candle("2026-01-01", 110)]);
    const days = await r.getDays(1, 10);
    expect(days).toHaveLength(1);
    expect(days[0].close).toBe(110);
  });
});
