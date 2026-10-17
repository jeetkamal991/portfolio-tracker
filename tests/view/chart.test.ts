import { describe, it, expect } from "vitest";
import { buildChartData } from "@/lib/view/chart";
import type { StoredDay } from "@/lib/db/types";

const date = (i: number) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
// Bar i: open 100+i, close 100+i (+1 on even bars, -1 on odd), volume 1000+i.
const bar = (i: number, o: Partial<StoredDay> = {}): StoredDay => ({
  date: date(i), open: 100 + i, high: 102 + i, low: 98 + i, close: 100 + i + (i % 2 === 0 ? 1 : -1), volume: 1000 + i,
  pctChange: null, importedPct: null,
  ema20: i >= 19 ? 100 + i : null, ema50: i >= 49 ? 100 + i : null, ema200: i >= 199 ? 100 + i : null,
  rsi14: i >= 14 ? 50 : null, rsVsNifty: null, ...o,
});
const series = (n: number) => Array.from({ length: n }, (_, i) => bar(i));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const vols = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => 1000 + from + k);

describe("buildChartData", () => {
  it("slices to the range's bar count", () => {
    const days = series(300);
    expect(buildChartData(days, "6M").candles).toHaveLength(126);
    expect(buildChartData(days, "ALL").candles).toHaveLength(300);
    expect(buildChartData(days, "1D").candles).toHaveLength(5);
    expect(buildChartData(days, "1D").candles[4]!.time).toBe(date(299));
  });

  it("returns all bars when the range is longer than the data", () => {
    expect(buildChartData(series(30), "1Y").candles).toHaveLength(30);
  });

  it("excludes imported-only rows with a null close", () => {
    const days = [...series(10), bar(10, { open: null, high: null, low: null, close: null, volume: null, importedPct: 0.01 })];
    const d = buildChartData(days, "ALL");
    expect(d.candles).toHaveLength(10);
    expect(d.candles.map((c) => c.time)).not.toContain(date(10));
  });

  it("line series omit null values", () => {
    const days = series(300);
    expect(buildChartData(days, "ALL").ema200).toHaveLength(101);
    expect(buildChartData(days, "ALL").ema200[0]!.time).toBe(date(199));
    expect(buildChartData(days, "1Y").ema20).toHaveLength(252);
    expect(buildChartData(series(30), "ALL").ema20).toHaveLength(11);
    expect(buildChartData(days, "ALL").rsi).toHaveLength(286);
  });

  it("volSma20 starts at bar 19 and is computed before slicing", () => {
    const days = series(300);
    const all = buildChartData(days, "ALL").volSma20;
    expect(all[0]!.time).toBe(date(19));
    expect(all[0]!.value).toBeCloseTo(mean(vols(0, 19)), 10);
    const oneDay = buildChartData(days, "1D").volSma20;
    expect(oneDay).toHaveLength(5);
    expect(oneDay[0]!.value).toBeCloseTo(mean(vols(276, 295)), 10);
  });

  it("volume bars are up when close >= open", () => {
    const d = buildChartData(series(4), "ALL");
    expect(d.volume.map((v) => v.up)).toEqual([true, false, true, false]);
    expect(buildChartData([bar(0, { close: 100 })], "ALL").volume[0]!.up).toBe(true);
  });
});
