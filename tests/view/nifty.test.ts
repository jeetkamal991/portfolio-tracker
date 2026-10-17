import { describe, it, expect } from "vitest";
import { buildNiftyCard } from "@/lib/view/nifty";
import type { StoredDay } from "@/lib/db/types";

const date = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
const day = (i: number, o: Partial<StoredDay> = {}): StoredDay => ({
  date: date(i), open: null, high: null, low: null, close: 100, volume: null,
  pctChange: null, importedPct: null, ema20: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null, ...o,
});

describe("buildNiftyCard", () => {
  it("uses the last two stored closes without a live quote", () => {
    const c = buildNiftyCard([day(0, { close: 100 }), day(1, { close: 101, pctChange: 0.01, high: 102, low: 99 })]);
    expect(c.cmp).toBe(101);
    expect(c.prevClose).toBe(100);
    expect(c.change).toBeCloseTo(1, 12);
    expect(c.changePct).toBe(0.01);
    expect(c.dayHigh).toBe(102);
    expect(c.dayLow).toBe(99);
    expect(c.asOf).toBe(date(1));
  });

  it("falls back to the last priced close and the imported % when the last row is imported-only", () => {
    const c = buildNiftyCard([day(0, { close: 100 }), day(1, { close: null, importedPct: 0.02 })]);
    expect(c.cmp).toBe(100);
    expect(c.changePct).toBe(0.02);
  });

  it("overlays a live quote", () => {
    const c = buildNiftyCard([day(0, { close: 95 }), day(1, { close: 100, high: 101, low: 99 })], { price: 110, changePct: 0.1 });
    expect(c.cmp).toBe(110);
    expect(c.changePct).toBe(0.1);
    expect(c.prevClose).toBeCloseTo(100, 10);
    expect(c.change).toBeCloseTo(10, 10);
    expect(c.dayHigh).toBeNull();
    expect(c.dayLow).toBeNull();
  });

  it("52-week high/low use only the last 252 priced rows", () => {
    const days = Array.from({ length: 300 }, (_, i) => day(i, { close: i + 0.75, high: i + 1, low: i + 0.5 }));
    const c = buildNiftyCard(days);
    expect(c.high52).toBe(300);
    expect(c.low52).toBe(48.5);
  });

  it("52-week high/low fall back to close where high/low are null and skip null closes", () => {
    const c = buildNiftyCard([day(0, { close: 90 }), day(1, { close: null, importedPct: 0.01 }), day(2, { close: 110 })]);
    expect(c.high52).toBe(110);
    expect(c.low52).toBe(90);
  });

  it("EMA states and trend", () => {
    const mixed = buildNiftyCard([day(0, { close: 100, ema20: 105, ema50: 95, ema200: 90 })]);
    expect([mixed.ema20.above, mixed.ema50.above, mixed.ema200.above]).toEqual([false, true, true]);
    expect(mixed.ema20.value).toBe(105);
    expect(mixed.trend).toBe("mixed");
    expect(buildNiftyCard([day(0, { close: 100, ema20: 101, ema50: 102, ema200: 103 })]).trend).toBe("below_all");
    expect(buildNiftyCard([day(0, { close: 100, ema20: 90, ema50: 90, ema200: 90 })]).trend).toBe("above_all");
    const partial = buildNiftyCard([day(0, { close: 100, ema20: 90, ema50: 90, ema200: null })]);
    expect(partial.ema200.above).toBeNull();
    expect(partial.trend).toBeNull();
  });

  it("EMAs come from the last priced row, not a trailing imported-only row", () => {
    const c = buildNiftyCard([day(0, { close: 100, ema20: 90, ema50: 90, ema200: 90 }), day(1, { close: null, importedPct: 0.01 })]);
    expect(c.ema20.value).toBe(90);
    expect(c.trend).toBe("above_all");
  });

  it("empty input gives all nulls", () => {
    const c = buildNiftyCard([]);
    for (const k of ["cmp", "change", "changePct", "prevClose", "dayHigh", "dayLow", "high52", "low52", "asOf"] as const) {
      expect(c[k]).toBeNull();
    }
    expect(c.ema20).toEqual({ value: null, above: null });
    expect(c.trend).toBeNull();
  });
});

describe("buildNiftyCard live day range", () => {
  it("uses the quote's day high/low when it has them", () => {
    const c = buildNiftyCard([day(0, { close: 100, high: 101, low: 99 })], { price: 110, changePct: 0.1, dayHigh: 112, dayLow: 105 });
    expect(c.dayHigh).toBe(112);
    expect(c.dayLow).toBe(105);
  });
});
