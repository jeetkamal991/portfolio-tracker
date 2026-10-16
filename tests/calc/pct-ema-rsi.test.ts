import { test, expect } from "vitest";
import { pctChange } from "@/lib/calc/pct";
import { emaSeries } from "@/lib/calc/ema";
import { rsiSeries } from "@/lib/calc/rsi";

test("pctChange is a fraction", () => expect(pctChange(100, 99.12)).toBeCloseTo(-0.0088, 6));
test("EMA seeded with SMA then smoothed", () => {
  const e = emaSeries([1, 2, 3, 4, 5, 6], 3);
  expect(e.slice(0, 2)).toEqual([null, null]);
  expect(e[2]).toBeCloseTo(2, 10);
  expect(e[3]).toBeCloseTo(3, 10);
  expect(e[5]).toBeCloseTo(5, 10);
});
test("EMA shorter than period is all null", () => expect(emaSeries([1, 2], 3)).toEqual([null, null]));
test("RSI all gains is 100, all losses is 0", () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 + i);
  expect(rsiSeries(up)[14]).toBe(100);
  expect(rsiSeries(up.slice().reverse())[14]).toBe(0);
  expect(rsiSeries(up)[13]).toBeNull();
});
test("RSI Wilder reference value", () => {
  const c = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  expect(rsiSeries(c)[14]!).toBeCloseTo(70.46, 2);
});
