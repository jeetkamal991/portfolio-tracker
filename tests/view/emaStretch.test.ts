import { describe, expect, it } from "vitest";
import { emaStretch } from "@/lib/view/chart";

describe("emaStretch", () => {
  it("gives signed % and tone by absolute distance", () => {
    const r = emaStretch(100, { ema20: 100, ema50: 96, ema200: 105 });
    expect(r.map((x) => x.tone)).toEqual(["normal", "amber", "amber"]);
    expect(r[1]!.pct).toBeCloseTo(4.1667, 3);
    expect(r[2]!.pct).toBeLessThan(0);
    const r2 = emaStretch(108, { ema20: 100, ema50: null, ema200: 0 });
    expect(r2).toHaveLength(1);
    expect(r2[0]!.tone).toBe("red");
  });
  it("treats exactly 4 as amber and exactly 6 as amber", () => {
    expect(emaStretch(104, { ema20: 100, ema50: null, ema200: null })[0]!.tone).toBe("amber");
    expect(emaStretch(106, { ema20: 100, ema50: null, ema200: null })[0]!.tone).toBe("amber");
  });
});
