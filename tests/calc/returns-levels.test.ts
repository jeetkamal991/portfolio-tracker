import { test, expect } from "vitest";
import { periodReturn, rsVsNifty } from "@/lib/calc/returns";
import { trendTag, effectiveLevel, isNearLevel } from "@/lib/calc/levels";

test("periodReturn", () => {
  expect(periodReturn([100, 110], 1)).toBeCloseTo(0.1);
  expect(periodReturn([100], 1)).toBeNull();
});
test("RS uses Nifty on the same dates", () => {
  const dates = Array.from({ length: 21 }, (_, i) => `d${String(i).padStart(2, "0")}`);
  const closes = dates.map((_, i) => (i === 20 ? 110 : 100));
  const nifty = new Map(dates.map((d, i) => [d, i === 20 ? 105 : 100]));
  const rs = rsVsNifty(dates, closes, nifty);
  expect(rs[19]).toBeNull();
  expect(rs[20]).toBeCloseTo(0.05);
});
test("RS null when Nifty missing a date", () => {
  const dates = Array.from({ length: 21 }, (_, i) => `d${String(i).padStart(2, "0")}`);
  expect(rsVsNifty(dates, dates.map(() => 1), new Map())[20]).toBeNull();
});
test("trendTag", () => {
  expect(trendTag(110, 100, 90)).toBe("above_both");
  expect(trendTag(95, 100, 90)).toBe("between");
  expect(trendTag(80, 100, 90)).toBe("below_both");
  expect(trendTag(80, 100, null)).toBeNull();
});
test("effective level and near-level", () => {
  expect(effectiveLevel(100, null)).toBe(100);
  expect(effectiveLevel(100, 95)).toBe(95);
  expect(isNearLevel(100, 99.0)).toBe(true);
  expect(isNearLevel(100, 98.9)).toBe(false);
  expect(isNearLevel(100, null)).toBe(false);
});

import { emaTrend } from "@/lib/calc/levels";

test("emaTrend: above all, mixed, below all, null on any missing EMA", () => {
  expect(emaTrend(100, 99, 98, 97)).toBe("above_all");
  expect(emaTrend(100, 101, 99, 98)).toBe("mixed");
  expect(emaTrend(100, 101, 102, 103)).toBe("below_all");
  expect(emaTrend(100, 100, 100, 100)).toBe("above_all");
  expect(emaTrend(100, null, 98, 97)).toBeNull();
  expect(emaTrend(100, 99, null, 97)).toBeNull();
  expect(emaTrend(100, 99, 98, null)).toBeNull();
});
