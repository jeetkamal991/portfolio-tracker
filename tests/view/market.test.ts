import { describe, it, expect } from "vitest";
import { fmtAlphaScore, fmtShortDate, metricText } from "@/lib/view/market";

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

describe("fmtAlphaScore", () => {
  it("shows the combined score as a whole-number mean rank", () => {
    expect(fmtAlphaScore("combined", 0.874)).toBe("87");
    expect(fmtAlphaScore("combined", 1)).toBe("100");
  });
  it("shows an alpha value to 3 significant digits with a true minus sign", () => {
    expect(fmtAlphaScore("a012", -0.0123456)).toBe("−0.0123");
    expect(fmtAlphaScore("a101", 0.5)).toBe("0.500");
    expect(fmtAlphaScore("a054", 0)).toBe("0.00");
  });
  it("shows values of 1000 or more as whole numbers, never in exponent form", () => {
    expect(fmtAlphaScore("a012", -1550.3)).toBe("−1550");
    expect(fmtAlphaScore("a012", 12345.6)).toBe("12346");
    expect(fmtAlphaScore("a012", 999.6)).toBe("1000"); // rounds up to 1000 at 3 significant digits
  });
});
