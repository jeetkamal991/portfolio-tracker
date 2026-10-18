import { describe, it, expect } from "vitest";
import { buildMovers, type MoverEntry } from "@/lib/view/movers";

const e = (key: string, pct: number | null): MoverEntry => ({ key, name: key, price: 100, pct });

describe("buildMovers", () => {
  it("takes the top 5 each way and counts breadth", () => {
    const pcts = [0.05, 0.04, 0.03, 0.02, 0.01, 0.005, 0, -0.01, -0.02, -0.03, -0.04, null];
    const m = buildMovers(pcts.map((p, i) => e(`S${String(i).padStart(2, "0")}`, p)));
    expect(m.gainers.map((g) => g.pct)).toEqual([0.05, 0.04, 0.03, 0.02, 0.01]);
    expect(m.losers.map((l) => l.pct)).toEqual([-0.04, -0.03, -0.02, -0.01]);
    expect(m.breadth).toEqual({ advances: 6, declines: 4, unchanged: 1, total: 11 });
  });
  it("orders equal pcts by key ascending", () => {
    const m = buildMovers([e("C", 0.01), e("A", 0.01), e("B", 0.01), e("Z", -0.01), e("Y", -0.01)]);
    expect(m.gainers.map((g) => g.key)).toEqual(["A", "B", "C"]);
    expect(m.losers.map((l) => l.key)).toEqual(["Y", "Z"]);
  });
  it("never lists a key in both lists", () => {
    const m = buildMovers([e("A", 0.02), e("B", 0.01), e("C", -0.01)]);
    const g = new Set(m.gainers.map((x) => x.key));
    expect(m.losers.some((l) => g.has(l.key))).toBe(false);
  });
  it("all-positive set leaves losers empty", () => {
    const m = buildMovers([e("A", 0.02), e("B", 0.01), e("C", 0.03)]);
    expect(m.losers).toEqual([]);
    expect(m.gainers.map((g) => g.key)).toEqual(["C", "A", "B"]);
  });
});
