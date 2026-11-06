import { describe, it, expect } from "vitest";
import { buildChartData } from "@/lib/view/chart";
import type { StoredDay } from "@/lib/db/types";

const date = (i: number) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
// Bar i: open 100+i, close 100+i (+1 on even bars, -1 on odd), volume 1000+i.
const bar = (i: number, o: Partial<StoredDay> = {}): StoredDay => ({
  date: date(i), open: 100 + i, high: 102 + i, low: 98 + i, close: 100 + i + (i % 2 === 0 ? 1 : -1), volume: 1000 + i,
  pctChange: null, importedPct: null,
  ema20: i >= 19 ? 100 + i : null, ema50: i >= 49 ? 100 + i : null, ema200: i >= 199 ? 100 + i : null,
  rsi14: i >= 14 ? 50 : null, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null,
  rsVsSector: null, score: null, scoreComponents: null, scoreLabel: null, scoreConfidence: null, scoreSignal: null,
  ...o,
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

  it("macd series keep only non-null points", () => {
    // MACD from bar 33, histogram only on even bars from 40.
    const days = Array.from({ length: 60 }, (_, i) =>
      bar(i, {
        macd: i >= 33 ? i / 10 : null,
        macdSignal: i >= 33 ? i / 20 : null,
        macdHist: i >= 40 && i % 2 === 0 ? i / 100 - 0.5 : null,
      }),
    );
    const d = buildChartData(days, "ALL");
    expect(d.macd).toHaveLength(27);
    expect(d.macdSignal).toHaveLength(27);
    expect(d.macdHist).toHaveLength(10);
    expect(d.macdHist.map((p) => p.time)).toEqual(Array.from({ length: 10 }, (_, k) => date(40 + 2 * k)));
    expect(d.macdHist[0]!.value).toBeCloseTo(-0.1, 10);
    expect(d.macd[0]).toEqual({ time: date(33), value: 3.3 });
  });

  it("bollinger series length equals the non-null count within the range", () => {
    const days = Array.from({ length: 300 }, (_, i) =>
      bar(i, i >= 19 ? { bbUpper: 110 + i, bbMiddle: 100 + i, bbLower: 90 + i } : {}),
    );
    const all = buildChartData(days, "ALL");
    expect(all.bbUpper).toHaveLength(281);
    expect(all.bbMiddle).toHaveLength(281);
    expect(all.bbLower).toHaveLength(281);
    expect(all.bbUpper[0]).toEqual({ time: date(19), value: 129 });
    const m1 = buildChartData(days.slice(0, 30), "1M");
    expect(m1.candles).toHaveLength(21);
    expect(m1.bbUpper).toHaveLength(11); // bars 9..29 in range, non-null from 19
    expect(m1.bbLower[10]).toEqual({ time: date(29), value: 119 });
  });
});

describe("regime", () => {
  it("keeps bullish/bearish days only; Neutral and unscored days get no tint", () => {
    const labels = ["Strong Bullish", "Bullish", "Neutral", "Bearish", "Strong Bearish", null] as const;
    const d = buildChartData(labels.map((l, i) => bar(i, { scoreLabel: l })), "ALL");
    expect(d.regime).toEqual([
      { time: date(0), bull: true }, { time: date(1), bull: true }, { time: date(3), bull: false }, { time: date(4), bull: false },
    ]);
  });
});

import { hoverInfo } from "@/lib/view/chart";

describe("hoverInfo", () => {
  const d = (date: string, close: number, o: Partial<{ rsi14: number; ema20: number; score: number }> = {}) => ({
    date, close, rsi14: null, ema20: null, score: null, scoreLabel: null as null, ...o,
  });
  it("gives day %, EMA 20 distance and passes breadth through", () => {
    const i = hoverInfo([d("a", 100), d("b", 110, { rsi14: 61, ema20: 100, score: 70 })], "b", 52.8)!;
    expect(i.dayPct).toBeCloseTo(10);
    expect(i.ema20Pct).toBeCloseTo(10);
    expect(i).toMatchObject({ rsi: 61, score: 70, breadth: 52.8, close: 110 });
  });
  it("keeps missing values null and returns null for an unknown date", () => {
    const i = hoverInfo([d("a", 100)], "a", null)!;
    expect(i).toMatchObject({ dayPct: null, rsi: null, score: null, ema20Pct: null, breadth: null });
    expect(hoverInfo([d("a", 100)], "x", null)).toBeNull();
  });
});
