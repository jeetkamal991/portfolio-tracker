import { test, expect } from "vitest";
import { computeIndicators } from "@/lib/calc/indicators";

const days = Array.from({ length: 250 }, (_, i) => ({
  date: `d${String(i).padStart(3, "0")}`,
  close: 100 + i,
}));
const nifty = new Map(days.map((d) => [d.date, d.close]));

test("computeIndicators composes pct, EMA, RSI and RS", () => {
  const rows = computeIndicators(days, nifty);
  expect(rows).toHaveLength(250);
  expect(rows[0]!.date).toBe("d000");
  expect(rows[0]!.pctChange).toBeNull();
  expect(rows[1]!.pctChange).toBeCloseTo(1 / 100, 10);
  expect(rows[48]!.ema50).toBeNull();
  expect(rows[49]!.ema50).not.toBeNull();
  expect(rows[198]!.ema200).toBeNull();
  expect(rows[199]!.ema200).not.toBeNull();
  expect(rows[14]!.rsi14).toBe(100);
  expect(rows[100]!.rsVsNifty).toBeCloseTo(0, 12);
  expect(rows[19]!.rsVsNifty).toBeNull();
});
