import { describe, it, expect } from "vitest";
import { buildWatchRow, buildWatchSignals, signalChip, sortWatchRows, tabRows, type WatchInput, type WatchRow, type WatchSignals } from "@/lib/view/watchlist";
import type { Levels, StoredDay } from "@/lib/db/types";

const date = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const day = (i: number, o: Partial<StoredDay> = {}): StoredDay => ({
  date: date(i), open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000,
  pctChange: 0.01, importedPct: null, ema20: 90, ema50: 85, ema200: 80, rsi14: 55, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null, rsVsSector: null,
  score: null, scoreComponents: null, scoreLabel: null, scoreConfidence: null, scoreSignal: null, ...o,
});
const noLevels: Levels = { autoSupport: null, autoResistance: null, manualSupport: null, manualResistance: null };
const input = (days: StoredDay[], levels: Levels = noLevels, key = "AAA"): WatchInput => ({ key, name: `${key} Ltd`, ticker: `${key}.NS`, days, levels });
const series = (n: number) => Array.from({ length: n }, (_, i) => day(i));

describe("buildWatchRow", () => {
  it("sparkline is the last 21 priced closes", () => {
    const r = buildWatchRow(input(series(25)))!;
    expect(r.spark).toHaveLength(21);
    expect(r.spark).toEqual(series(25).slice(4).map((d) => d.close));
    expect(r.cmp).toBe(124);
  });

  it("live quote sets cmp, day % and the last sparkline point", () => {
    const r = buildWatchRow(input(series(25)), { price: 210, changePct: 0.02 })!;
    expect(r.cmp).toBe(210);
    expect(r.dayPct).toBe(0.02);
    expect(r.spark).toHaveLength(21);
    expect(r.spark[20]).toBe(210);
    expect(r.spark[19]).toBe(123);
  });

  it("falls back to importedPct when pctChange is null", () => {
    const days = [...series(3).slice(0, 2), day(2, { pctChange: null, importedPct: 0.015 })];
    expect(buildWatchRow(input(days))!.dayPct).toBe(0.015);
  });

  it("one priced day → one sparkline point; none → null", () => {
    expect(buildWatchRow(input([day(0)]))!.spark).toEqual([100]);
    expect(buildWatchRow(input([day(0, { close: null })]))).toBeNull();
    expect(buildWatchRow(input([]))).toBeNull();
  });

  it("indicators come from the latest priced day, skipping an imported-only last row", () => {
    const days = [day(0, { ema20: 50 }), day(1, { close: null, ema20: null, importedPct: 0.01 })];
    const r = buildWatchRow(input(days))!;
    expect(r.cmp).toBe(100);
    expect(r.ema20).toBe(50);
  });

  it("manual support overrides auto; near-level within 1%", () => {
    const r = buildWatchRow(input([day(0)], { ...noLevels, autoSupport: 90, manualSupport: 95 }))!;
    expect(r.support).toBe(95);
    expect(r.supportIsManual).toBe(true);
    expect(r.toSupport).toBeCloseTo(0.05, 12);
    const near = buildWatchRow(input([day(0)], { ...noLevels, autoSupport: 99.2 }))!;
    expect(near.nearLevel).toBe(true);
    expect(near.supportIsManual).toBe(false);
  });

  it("EMA cells, trend and not-enough-history", () => {
    const r = buildWatchRow(input([day(0, { close: 100, ema20: 101, ema50: 99, ema200: 98 })]))!;
    expect([r.above20, r.above50, r.above200]).toEqual([false, true, true]);
    expect(r.trend).toBe("mixed");
    expect(r.notEnoughHistory).toBe(false);
    const short = buildWatchRow(input([day(0, { ema200: null })]))!;
    expect(short.notEnoughHistory).toBe(true);
    expect(short.trend).toBeNull();
    expect(short.above200).toBeNull();
  });

  it("copies score fields from the latest day", () => {
    const comps = { trend: 20, momentum: 15, volume: 9, pattern: 7.5, market: 13.5, risk: 7, flows: 10, partial: true };
    const r = buildWatchRow(input([day(0, { score: 72, scoreLabel: "Bullish", scoreComponents: comps })]))!;
    expect(r.score).toBe(72);
    expect(r.scoreLabel).toBe("Bullish");
    expect(r.scorePartial).toBe(true);
    expect(r.rsi).toBe(55);
    const none = buildWatchRow(input([day(0)]))!;
    expect(none.score).toBeNull();
    expect(none.scorePartial).toBe(false);
  });
});

describe("sortWatchRows", () => {
  const row = (key: string, score: number | null): WatchRow => ({ ...buildWatchRow(input([day(0)], noLevels, key))!, score });
  const rows = [row("B", 50), row("A", null), row("C", 80), row("A2", 50)];
  const keys = (rs: WatchRow[]) => rs.map((r) => r.key);

  it("score desc: nulls last, ties by key", () => expect(keys(sortWatchRows(rows, "score", "desc"))).toEqual(["C", "A2", "B", "A"]));
  it("score asc: nulls still last", () => expect(keys(sortWatchRows(rows, "score", "asc"))).toEqual(["A2", "B", "C", "A"]));
  it("name asc sorts by key", () => expect(keys(sortWatchRows(rows, "name", "asc"))).toEqual(["A", "A2", "B", "C"]));
  it("does not mutate its input", () => {
    sortWatchRows(rows, "score", "desc");
    expect(keys(rows)).toEqual(["B", "A", "C", "A2"]);
  });
});

describe("volume ratio and distance from the 52-week high", () => {
  it("computes both when the inputs exist, null otherwise", () => {
    const r = buildWatchRow(input([day(0), day(1, { close: 90, volume: 3000, volAvg20: 1000, high52w: 120 })]))!;
    expect(r.volRatio).toBe(3);
    expect(r.fromHigh).toBeCloseTo(-0.25, 5);
    const none = buildWatchRow(input([day(0)]))!;
    expect(none.volRatio).toBeNull();
    expect(none.fromHigh).toBeNull();
  });
});

describe("buildWatchSignals · stage 2", () => {
  const stage = (n: 1 | 2 | 3 | 4, freshBreakout = false) => ({ stage: n, freshBreakout, ma30: 100, slope: 0.02, weeksInStage: 2 });
  it("keeps only stage-2 stocks, fresh breakouts first then by key, and ignores stocks with no stage", () => {
    const stocks = ["C", "A", "B", "D", "E"].map((key) => ({ key, name: key, days: [] }));
    const s = buildWatchSignals(stocks, { A: stage(2), B: stage(2, true), C: stage(3), D: stage(2, true) });
    expect(s.stage2).toEqual(["B", "D", "A"]);
    expect(buildWatchSignals(stocks).stage2).toEqual([]);
  });
});

describe("tabRows and signalChip", () => {
  const row = (key: string, score: number | null) => ({ key, name: key, score }) as unknown as WatchRow;
  const rows = ["A", "B", "C", "D", "E", "F", "G"].map((k, i) => row(k, i === 6 ? null : (i + 1) * 10));
  const sig: WatchSignals = { golden: ["B"], death: ["C"], breakout: [], stage2: ["F", "A"], rsi: ["D", "E"], volume: ["C", "F"] };
  it("all keeps everything in order", () => expect(tabRows(rows, "all", sig).map((r) => r.key)).toEqual(["A", "B", "C", "D", "E", "F", "G"]));
  it("top and weak take 5 by score and skip unscored stocks", () => {
    expect(tabRows(rows, "top", sig).map((r) => r.key)).toEqual(["B", "C", "D", "E", "F"]);
    expect(tabRows(rows, "weak", sig).map((r) => r.key)).toEqual(["A", "B", "C", "D", "E"]);
  });
  it("signal tabs keep only the matching stocks, and an unmatched tab is empty", () => {
    expect(tabRows(rows, "death", sig).map((r) => r.key)).toEqual(["C"]);
    expect(tabRows(rows, "rsi", sig).map((r) => r.key)).toEqual(["D", "E"]);
    expect(tabRows(rows, "breakout", sig)).toEqual([]);
  });
  it("the Stage 2 tab lists its stocks in the signal's order (fresh breakouts first), not the table order", () => {
    expect(tabRows(rows, "stage2", sig).map((r) => r.key)).toEqual(["F", "A"]);
  });
  it("the chip is the most important signal", () => {
    expect(signalChip("C", sig)).toEqual({ label: "death cross", tone: "down" });
    expect(signalChip("B", sig)).toEqual({ label: "golden cross", tone: "up" });
    expect(signalChip("F", sig)).toEqual({ label: "volume shock", tone: "warn" });
    expect(signalChip("A", sig)).toBeNull();
  });
});
