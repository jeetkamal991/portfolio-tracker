import { describe, it, expect } from "vitest";
import { bollingerSeries } from "@/lib/calc/bollinger";

describe("bollingerSeries", () => {
  it("uses population SD", () => {
    const r = bollingerSeries(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(r.upper[18]).toBeNull();
    expect(r.middle[19]).toBe(10.5);
    expect(r.upper[19]! - r.middle[19]!).toBeCloseTo(2 * Math.sqrt(33.25), 10);
    expect(r.upper[19]! - r.middle[19]!).toBeCloseTo(11.5326, 4);
    expect(r.middle[19]! - r.lower[19]!).toBeCloseTo(11.5326, 4);
  });
  it("collapses for constant closes", () => {
    const r = bollingerSeries(Array(25).fill(50));
    expect(r.upper[24]).toBe(50);
    expect(r.middle[24]).toBe(50);
    expect(r.lower[24]).toBe(50);
  });
});
