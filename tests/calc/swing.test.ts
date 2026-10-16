import { test, expect } from "vitest";
import { swingLevels } from "@/lib/calc/swing";

const flat = (n: number, v: number) => Array.from({ length: n }, () => ({ high: v + 1, low: v - 1 }));
test("finds nearest swing low below and swing high above", () => {
  const bars = flat(30, 100);
  bars[10] = { high: 101, low: 90 };
  bars[20] = { high: 112, low: 99 };
  expect(swingLevels(bars, 100)).toEqual({ support: 90, resistance: 112 });
});
test("merges levels within 1%", () => {
  const bars = flat(40, 100);
  bars[10] = { high: 101, low: 90 };
  bars[25] = { high: 101, low: 90.5 };
  expect(swingLevels(bars, 100).support).toBeCloseTo(90.25);
});
test("ignores bars in the last 5 (no right neighbours)", () => {
  const bars = flat(30, 100);
  bars[27] = { high: 101, low: 80 };
  expect(swingLevels(bars, 100).support).toBeNull();
});
test("only last 60 bars are used", () => {
  const bars = flat(100, 100);
  bars[10] = { high: 101, low: 85 };
  expect(swingLevels(bars, 100).support).toBeNull();
});
