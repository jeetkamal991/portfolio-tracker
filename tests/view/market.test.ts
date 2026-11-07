import { describe, it, expect } from "vitest";
import { fmtShortDate, metricText } from "@/lib/view/market";

describe("metricText", () => {
  it("formats volume ratios", () => {
    expect(metricText("vol_up", { metric: 2.4, date: null })).toBe("2.4×");
    expect(metricText("vol_down", { metric: 3, date: null })).toBe("3.0×");
  });
  it("formats 52-week distances with a true minus", () => {
    expect(metricText("breakout", { metric: -0.018, date: null })).toBe("−1.8% from high");
    expect(metricText("breakdown", { metric: 0.02, date: null })).toBe("+2.0% from low");
    expect(metricText("breakout", { metric: 0, date: null })).toBe("0.0% from high");
  });
  it("formats RSI and cross dates", () => {
    expect(metricText("rsi_high", { metric: 74.23, date: null })).toBe("RSI 74.2");
    expect(metricText("golden", { metric: null, date: "2026-10-14" })).toBe("Crossed 14 Oct");
    expect(metricText("death", { metric: null, date: null })).toBeNull();
  });
  it("returns null for score lists and missing metrics", () => {
    expect(metricText("score_top", { metric: 80, date: null })).toBeNull();
    expect(metricText("vol_up", { metric: null, date: null })).toBeNull();
    expect(metricText("vol_up", { metric: NaN, date: null })).toBeNull();
  });
});

describe("fmtShortDate", () => {
  it("shortens ISO dates and passes through junk", () => {
    expect(fmtShortDate("2026-10-04")).toBe("4 Oct");
    expect(fmtShortDate("nope")).toBe("nope");
  });
});
