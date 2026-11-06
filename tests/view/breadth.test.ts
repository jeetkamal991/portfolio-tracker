import { describe, it, expect } from "vitest";
import { buildBreadth } from "@/lib/view/breadth";
import type { StoredDay } from "@/lib/db/types";

const day = (o: Partial<StoredDay> = {}): StoredDay => ({
  date: "2026-01-02", open: null, high: null, low: null, close: null, volume: null,
  pctChange: null, importedPct: null, ema20: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null, rsVsSector: null, score: null,
  scoreComponents: null, scoreLabel: null, scoreConfidence: null, scoreSignal: null, ...o,
});

describe("buildBreadth", () => {
  it("counts advances, declines, unchanged with the stage 3 rule", () => {
    const b = buildBreadth([
      day({ pctChange: 0.01 }), day({ importedPct: 0.02 }), day({ pctChange: -0.01 }),
      day({ pctChange: 0 }), day({}),
    ], []);
    expect(b).toMatchObject({ advances: 2, declines: 1, unchanged: 1, total: 4, adRatio: 2 });
  });
  it("adRatio is null with no declines", () => {
    expect(buildBreadth([day({ pctChange: 0.01 })], []).adRatio).toBeNull();
  });
  it("aboveEma200 is 2/3 for [below, above, above, null]", () => {
    const b = buildBreadth([
      day({ close: 90, ema200: 100 }), day({ close: 110, ema200: 100 }),
      day({ close: 120, ema200: 100 }), day({ close: 100, ema200: null }),
    ], []);
    expect(b.aboveEma200).toBeCloseTo(2 / 3);
    expect(b.aboveEma200Count).toBe(2);
    expect(b.ema200Count).toBe(3);
  });
  it("aboveEma200 is null when no ema200", () => {
    expect(buildBreadth([day({ close: 1 })], []).aboveEma200).toBeNull();
  });
  it("VIX spark is the last 21 closes; close and dayPct from the last row", () => {
    const vix = Array.from({ length: 30 }, (_, i) =>
      day({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: 10 + i, pctChange: i === 29 ? 0.05 : 0.01 }));
    const b = buildBreadth([], vix);
    expect(b.vix.spark).toHaveLength(21);
    expect(b.vix.spark[0]).toBe(19);
    expect(b.vix.spark[20]).toBe(39);
    expect(b.vix.close).toBe(39);
    expect(b.vix.dayPct).toBe(0.05);
  });
  it("empty VIX gives nulls", () => {
    expect(buildBreadth([], []).vix).toEqual({ close: null, dayPct: null, spark: [] });
  });
});

import { breadthSeries } from "@/lib/view/breadth";

describe("breadthSeries", () => {
  const r = (date: string, close: number | null, ema200: number | null) => ({ date, close, ema200 });
  it("counts only stocks that have a close and an EMA 200, per day, sorted by date", () => {
    const s = breadthSeries([
      r("2026-01-02", 12, 10), r("2026-01-02", 8, 10), r("2026-01-02", 9, null), r("2026-01-02", null, 5), // 2 counted, 1 above
      r("2026-01-01", 9, null), // nothing counted: day skipped
      r("2026-01-03", 11, 10), r("2026-01-03", 11, 10), r("2026-01-03", 5, 10), r("2026-01-03", 5, 10), // 2 of 4
    ]);
    expect(s).toEqual([
      { time: "2026-01-02", pct: 50, above: 1, counted: 2 },
      { time: "2026-01-03", pct: 50, above: 2, counted: 4 },
    ]);
  });
  it("a close equal to the EMA is not above it", () => {
    expect(breadthSeries([r("d", 10, 10)])[0]!.pct).toBe(0);
  });
  it("returns nothing for no rows", () => expect(breadthSeries([])).toEqual([]));
});
