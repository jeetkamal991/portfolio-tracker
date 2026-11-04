import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";

const inst = (id: number, key: string, name: string, type: Instrument["type"] = "stock"): Instrument => ({
  id, key, name, type, yahooTicker: `${key}.NS`, active: true,
});
const candle = (date: string, close: number) => ({ date, open: close - 1, high: close + 1, low: close - 2, close, volume: 100 });
const ind = (date: string, ema50: number) => ({ date, pctChange: 0.01, ema20: null, ema50, ema200: null, rsi14: 55, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null });

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
    expect((await r.searchInstruments("nifty", 10, { includeIndices: true })).map((i) => i.key)).toEqual(["NIFTY"]);
    expect((await r.searchInstruments("t", 10, { includeIndices: true })).map((i) => i.key)).toEqual(["NIFTY", "TCS", "TATA"]);
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

  it("startJobRun writes a running row that finishJobRun completes; lastJobRun includes running rows", async () => {
    const r = createMemoryRepo();
    const id = await r.startJobRun("eod", "2026-01-03T10:00:00Z");
    expect(await r.lastJobRun("eod")).toEqual({
      job: "eod", startedAt: "2026-01-03T10:00:00Z", finishedAt: null, status: "running", message: "",
    });
    await r.finishJobRun(id, { finishedAt: "2026-01-03T10:00:30Z", status: "ok", message: "done" });
    expect(await r.lastJobRun("eod")).toEqual({
      job: "eod", startedAt: "2026-01-03T10:00:00Z", finishedAt: "2026-01-03T10:00:30Z", status: "ok", message: "done",
    });
    expect(r._jobRuns).toHaveLength(1);
  });

  it("lastJobRun picks the latest started_at, not the latest insert", async () => {
    const r = createMemoryRepo();
    await r.startJobRun("eod", "2026-01-05T10:00:00Z");
    const older = await r.startJobRun("eod", "2026-01-04T10:00:00Z");
    await r.finishJobRun(older, { finishedAt: "2026-01-04T10:01:00Z", status: "failed", message: "x" });
    await r.startJobRun("other", "2026-01-09T10:00:00Z");
    expect(await r.lastJobRun("eod")).toMatchObject({ startedAt: "2026-01-05T10:00:00Z", status: "running" });
  });

  it("getPriceBars returns only date/open/high/low/close/volume, newest `limit` ascending", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.upsertCandles(1, [candle("2026-01-03", 3), candle("2026-01-01", 1), candle("2026-01-02", 2)]);
    await r.upsertImportedPct([{ instrumentId: 1, date: "2025-12-31", importedPct: 0.1 }]);
    expect(await r.getPriceBars(1, 2)).toEqual([
      { date: "2026-01-02", open: 1, close: 2, high: 3, low: 0, volume: 100 },
      { date: "2026-01-03", open: 2, close: 3, high: 4, low: 1, volume: 100 },
    ]);
    expect((await r.getPriceBars(1, 100_000)).map((b) => b.date)).toEqual(["2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"]);
    expect((await r.getPriceBars(1, 100_000))[0]).toEqual({ date: "2025-12-31", open: null, close: null, high: null, low: null, volume: null });
  });

  it("last write wins for duplicate dates in one upsertCandles call", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.upsertCandles(1, [candle("2026-01-01", 100), candle("2026-01-01", 110)]);
    const days = await r.getDays(1, 10);
    expect(days).toHaveLength(1);
    expect(days[0].close).toBe(110);
  });

  it("getDailySummary returns the row for a date or null", async () => {
    const r = createMemoryRepo();
    expect(await r.getDailySummary("2026-01-01")).toBeNull();
    r._summaries.set("2026-01-01", { date: "2026-01-01", summary: "hi", marketEvents: [], watchlistNews: [] });
    expect((await r.getDailySummary("2026-01-01"))?.summary).toBe("hi");
    expect(await r.getDailySummary("2026-01-02")).toBeNull();
  });
});

describe("memoryRepo ema20", () => {
  it("stores ema20 from upsertIndicators and keeps it across upsertCandles", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.upsertCandles(1, [candle("2026-01-01", 100)]);
    await r.upsertIndicators(1, [{ ...ind("2026-01-01", 99), ema20: 5 }]);
    expect((await r.getDays(1, 10))[0].ema20).toBe(5);
    await r.upsertCandles(1, [candle("2026-01-01", 101)]);
    expect((await r.getDays(1, 10))[0].ema20).toBe(5);
  });

  const comps = { trend: 1, momentum: 2, volume: 3, pattern: 4, market: 5, risk: 6, partial: false };
  const scoreRow = (date: string) => ({
    date, rsVsSector: 0.02, score: 55, scoreComponents: comps,
    scoreLabel: "Bullish" as const, scoreConfidence: "High" as const, scoreSignal: "sig",
  });

  it("keeps score and indicators independently on the same date", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.upsertCandles(1, [candle("2026-01-01", 100)]);
    await r.upsertScore(1, scoreRow("2026-01-01"));
    await r.upsertIndicators(1, [ind("2026-01-01", 99)]);
    let d = (await r.getDays(1, 10))[0]!;
    expect(d.score).toBe(55);
    expect(d.rsVsSector).toBe(0.02);
    expect(d.scoreLabel).toBe("Bullish");
    expect(d.ema50).toBe(99);
    await r.upsertIndicators(1, [ind("2026-01-01", 98)]);
    d = (await r.getDays(1, 10))[0]!;
    expect(d.score).toBe(55);
    expect(d.ema50).toBe(98);
  });

  it("replaceConstituents replaces the set; listMemberships spans indices", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "A", "A"), inst(2, "B", "B")] });
    await r.replaceConstituents("NIFTY_IT", [1, 2]);
    await r.replaceConstituents("NIFTY200", [2]);
    expect((await r.listConstituents("NIFTY_IT")).map((i) => i.key)).toEqual(["A", "B"]);
    await r.replaceConstituents("NIFTY_IT", [2]);
    expect((await r.listConstituents("NIFTY_IT")).map((i) => i.key)).toEqual(["B"]);
    const m = await r.listMemberships();
    expect(m.filter((x) => x.instrumentId === 2).map((x) => x.indexKey).sort()).toEqual(["NIFTY200", "NIFTY_IT"]);
    expect(m.some((x) => x.instrumentId === 1)).toBe(false);
  });

  it("getLatestDay returns the newest row with a close", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "A", "A")] });
    expect(await r.getLatestDay(1)).toBeNull();
    await r.upsertCandles(1, [candle("2026-01-01", 1), candle("2026-01-02", 2)]);
    await r.upsertImportedPct([{ instrumentId: 1, date: "2026-01-03", importedPct: 0.1 }]);
    expect((await r.getLatestDay(1))!.date).toBe("2026-01-02");
  });
  it("getDaysOn returns only rows on that date for the given ids", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "A", "A"), inst(2, "B", "B"), inst(3, "C", "C")] });
    await r.upsertCandles(1, [candle("2026-01-01", 1), candle("2026-01-02", 2)]);
    await r.upsertCandles(2, [candle("2026-01-01", 3)]);
    await r.upsertCandles(3, [candle("2026-01-02", 4)]);
    const m = await r.getDaysOn([1, 2], "2026-01-02");
    expect([...m.keys()]).toEqual([1]);
    expect(m.get(1)!.close).toBe(2);
  });
});

describe("memoryRepo holdings", () => {
  const h = { qty: 10, avgPrice: 100, buyDate: "2026-10-01", stopLoss: 90, target1: 120, target2: null };

  it("upsert then list joins key, name and ticker; get returns it", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa Ltd")] });
    await r.upsertHolding(1, h);
    expect(await r.listHoldings()).toEqual([{ ...h, instrumentId: 1, key: "AAA", name: "Aaa Ltd", yahooTicker: "AAA.NS" }]);
    expect((await r.getHolding(1))?.qty).toBe(10);
    expect(await r.getHolding(2)).toBeNull();
  });

  it("upserting again replaces; delete removes", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    await r.upsertHolding(1, h);
    await r.upsertHolding(1, { ...h, qty: 25, stopLoss: null });
    const all = await r.listHoldings();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ qty: 25, stopLoss: null });
    await r.deleteHolding(1);
    expect(await r.listHoldings()).toEqual([]);
  });
});

describe("memoryRepo.getDaysRange", () => {
  it("returns ascending rows within the inclusive range per instrument", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa"), inst(2, "BBB", "Bbb")] });
    await r.upsertCandles(1, ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"].map((d) => candle(d, 10)));
    await r.upsertCandles(2, [candle("2026-01-03", 20)]);
    const m = await r.getDaysRange([1, 2, 3], "2026-01-02", "2026-01-03");
    expect(m.get(1)!.map((d) => d.date)).toEqual(["2026-01-02", "2026-01-03"]);
    expect(m.get(2)!.map((d) => d.date)).toEqual(["2026-01-03"]);
    expect(m.has(3)).toBe(false);
  });
});

describe("memoryRepo.getOhlcvRange", () => {
  it("returns only date, OHLCV and day % per instrument, ascending within the inclusive range", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa"), inst(2, "BBB", "Bbb")] });
    await r.upsertCandles(1, ["2026-01-04", "2026-01-02", "2026-01-03", "2026-01-01"].map((d) => candle(d, 10)));
    await r.upsertImportedPct([{ instrumentId: 1, date: "2026-01-03", importedPct: 0.02 }]);
    const m = await r.getOhlcvRange([1, 2], "2026-01-02", "2026-01-03");
    expect(m.get(1)!.map((d) => d.date)).toEqual(["2026-01-02", "2026-01-03"]);
    expect(Object.keys(m.get(1)![0]).sort()).toEqual(["close", "date", "high", "importedPct", "low", "open", "pctChange", "volume"]);
    expect(m.get(1)![1].importedPct).toBe(0.02);
    expect(m.has(2)).toBe(false);
  });
});

describe("memoryRepo alerts", () => {
  const base = { condition: "price_above" as const, value: 100, mode: "once" as const, source: "user" as const, lastState: false, lastLevel: null };
  const setup = () => createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa"), inst(2, "BBB", "Bbb")] });

  it("creates, lists, filters, toggles and deletes rules", async () => {
    const r = setup();
    const a = await r.createAlertRule({ ...base, instrumentId: 1 });
    const b = await r.createAlertRule({ ...base, instrumentId: 2, condition: "cross_ema50", value: null });
    expect(a).toMatchObject({ id: 1, key: "AAA", name: "Aaa", yahooTicker: "AAA.NS", active: true, lastFiredAt: null });
    expect((await r.listAlertRules()).map((x) => x.id)).toEqual([1, 2]);
    expect((await r.listAlertRules({ conditions: ["cross_ema50"] })).map((x) => x.id)).toEqual([b.id]);
    await r.setAlertActive(a.id, false);
    expect((await r.listAlertRules({ activeOnly: true })).map((x) => x.id)).toEqual([b.id]);
    await r.deleteAlertRule(b.id);
    expect((await r.listAlertRules()).map((x) => x.id)).toEqual([a.id]);
  });

  it("rejects a second holding rule for the same stock and condition", async () => {
    const r = setup();
    const h = { ...base, instrumentId: 1, condition: "holding_sl" as const, source: "holding" as const, mode: "repeat" as const };
    await r.createAlertRule(h);
    await expect(r.createAlertRule(h)).rejects.toThrow();
    await r.createAlertRule({ ...base, instrumentId: 1, condition: "holding_sl" }); // user source is not constrained
  });

  it("saves states, values and deactivation in one call", async () => {
    const r = setup();
    const a = await r.createAlertRule({ ...base, instrumentId: 1 });
    const b = await r.createAlertRule({ ...base, instrumentId: 2, condition: "holding_sl", source: "holding", lastState: null, lastLevel: "none" });
    await r.saveAlertStates([
      { id: a.id, lastState: true, lastLevel: null, lastFiredAt: "2026-10-17T10:00:00.000Z", active: false },
      { id: b.id, lastState: null, lastLevel: "near", value: 95 },
    ]);
    const [x, y] = await r.listAlertRules();
    expect(x).toMatchObject({ lastState: true, lastFiredAt: "2026-10-17T10:00:00.000Z", active: false });
    expect(y).toMatchObject({ lastLevel: "near", value: 95, lastFiredAt: null, active: true });
  });

  it("lists events unread first, then newest; counts and marks read", async () => {
    const r = setup();
    const ev = (instrumentId: number, firedAt: string, message: string) =>
      ({ alertId: null, instrumentId, firedAt, price: 1, message, telegramStatus: "sent" });
    await r.insertAlertEvents([ev(1, "2026-10-15T10:00:00Z", "old"), ev(2, "2026-10-17T10:00:00Z", "new"), ev(1, "2026-10-16T10:00:00Z", "mid")]);
    const all = await r.listAlertEvents(10);
    expect(all.map((e) => e.message)).toEqual(["new", "mid", "old"]);
    expect(all[0]).toMatchObject({ key: "BBB", name: "Bbb", read: false });
    await r.markAlertsRead([all[0].id]);
    expect((await r.listAlertEvents(10)).map((e) => e.message)).toEqual(["mid", "old", "new"]);
    expect(await r.unreadAlertCount()).toBe(2);
    await r.markAlertsRead("all");
    expect(await r.unreadAlertCount()).toBe(0);
    expect(await r.listAlertEvents(2)).toHaveLength(2);
  });

  it("stores shareholding per (instrument, quarter) and finds the newest quarter", async () => {
    const r = createMemoryRepo({ instruments: [inst(1, "AAA", "Aaa")] });
    expect(await r.latestShareholdingQuarter()).toBeNull();
    const row = (quarterEnd: string, fiiPct: number) => ({ instrumentId: 1, quarterEnd, fiiPct, diiPct: 10, promoterPct: 50, sourceUrl: null });
    await r.upsertShareholding([row("2026-06-30", 20), row("2026-09-30", 21)]);
    await r.upsertShareholding([row("2026-09-30", 22)]);
    expect(await r.latestShareholdingQuarter()).toBe("2026-09-30");
    expect((await r.listShareholding(["2026-09-30"])).map((x) => x.fiiPct)).toEqual([22]);
    expect(await r.listShareholding(["2026-06-30", "2026-09-30"])).toHaveLength(2);
  });
});
