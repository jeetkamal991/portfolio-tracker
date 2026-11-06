import { describe, expect, it } from "vitest";
import { keyLevels } from "@/lib/calc/chartLevels";

const bar = (i: number, high: number, low: number, close = (high + low) / 2) => ({ date: `2026-01-${String(i).padStart(2, "0")}`, high, low, close });

describe("keyLevels", () => {
  it("is empty without bars", () => {
    expect(keyLevels([])).toEqual({ pdh: null, pdl: null, high52: null, support: null, resistance: null });
  });
  it("takes the previous session's high/low and the highest high", () => {
    const l = keyLevels([bar(3, 120, 100), bar(1, 110, 90), bar(2, 130, 95), bar(4, 125, 105)]); // unsorted on purpose
    expect(l.pdh).toBe(120);
    expect(l.pdl).toBe(100);
    expect(l.high52).toBe(130);
  });
  it("finds the nearest swing support below and resistance above the close", () => {
    // V-shaped low at 90 (day 6) then a peak at 130 (day 14) and a close at 110
    const lows = [100, 99, 98, 97, 96, 90, 96, 97, 98, 99, 100, 101, 102, 103, 102, 101, 100, 99, 98, 97, 96, 95];
    const bars = lows.map((lo, i) => bar(i + 1, i === 13 ? 130 : lo + 8, lo, i === lows.length - 1 ? 110 : lo + 4));
    const l = keyLevels(bars);
    expect(l.support).toBe(90);
    expect(l.resistance).toBe(130);
  });
});
