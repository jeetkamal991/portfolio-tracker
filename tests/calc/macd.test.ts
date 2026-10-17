import { describe, it, expect } from "vitest";
import { macdSeries } from "@/lib/calc/macd";
import { emaSeries } from "@/lib/calc/ema";

describe("macdSeries", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const r = macdSeries(closes);

  it("matches EMA12 - EMA26 and keeps input length", () => {
    expect(r.macd).toHaveLength(60);
    const e12 = emaSeries(closes, 12);
    const e26 = emaSeries(closes, 26);
    expect(r.macd[24]).toBeNull();
    expect(r.macd[25]).toBeCloseTo(e12[25]! - e26[25]!, 10);
  });

  it("seeds signal with the SMA of the first 9 macd values", () => {
    expect(r.signal[32]).toBeNull();
    const seed = r.macd.slice(25, 34).reduce((a, b) => a! + b!, 0)! / 9;
    expect(r.signal[33]).toBeCloseTo(seed, 10);
    expect(r.hist[32]).toBeNull();
    expect(r.hist[33]).toBeCloseTo(r.macd[33]! - r.signal[33]!, 10);
  });

  it("is zero for constant closes", () => {
    const c = macdSeries(Array(60).fill(100));
    expect(c.macd.slice(25).every((v) => v === 0)).toBe(true);
    expect(c.signal.slice(33).every((v) => v === 0)).toBe(true);
    expect(c.hist.slice(33).every((v) => v === 0)).toBe(true);
  });
});
