import { describe, it, expect } from "vitest";
import { range52Series } from "@/lib/calc/range52";

describe("range52Series", () => {
  const bars = Array.from({ length: 300 }, (_, i) => ({ high: i + 1, low: i, close: i }));
  const r = range52Series(bars);
  it("uses a 252-bar window including today", () => {
    expect(r.high[299]).toBe(300);
    expect(r.low[299]).toBe(48);
    expect(r.high[10]).toBe(11);
    expect(r.low[10]).toBe(0);
  });
  it("falls back to close for null high/low", () => {
    const x = range52Series([
      { high: 10, low: 5, close: 7 },
      { high: null, low: null, close: 20 },
      { high: null, low: null, close: 1 },
    ]);
    expect(x.high[2]).toBe(20);
    expect(x.low[2]).toBe(1);
  });
});
