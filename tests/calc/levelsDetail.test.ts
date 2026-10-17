import { describe, expect, it } from "vitest";
import { levelStrength } from "@/lib/calc/levelsDetail";

const flat = (n: number) => Array.from({ length: n }, () => ({ high: 106, low: 104 }));

describe("levelStrength", () => {
  it("three touches of a support below price is Strong", () => {
    const bars = flat(60);
    bars[10].low = 100.5;
    bars[30].low = 99.8;
    bars[50].low = 100.9;
    expect(levelStrength(bars, 100)).toEqual({ touches: 3, strength: "Strong" });
  });

  it("two touches is Weak", () => {
    const bars = flat(60);
    bars[10].low = 100.5;
    bars[30].low = 99.8;
    expect(levelStrength(bars, 100)).toEqual({ touches: 2, strength: "Weak" });
  });

  it("counts highs for a resistance above price and ignores bars outside the lookback", () => {
    const bars = flat(70);
    bars[0].high = 110; // outside lookback of 60
    bars[65].high = 110.5;
    expect(levelStrength(bars, 110)).toEqual({ touches: 1, strength: "Weak" });
  });

  it("null level", () => {
    expect(levelStrength(flat(60), null)).toEqual({ touches: 0, strength: null });
  });
});
