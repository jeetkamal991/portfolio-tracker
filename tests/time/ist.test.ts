import { test, expect } from "vitest";
import { istDate, isMarketOpen, addDays } from "@/lib/time/ist";

test("UTC 18:30 previous day is next IST date", () => {
  expect(istDate(new Date("2026-10-15T18:30:00Z"))).toBe("2026-10-16");
});
test("NSE candle at 03:45 UTC stays same date", () => {
  expect(istDate(new Date("2026-10-16T03:45:00Z"))).toBe("2026-10-16");
});
test("market hours", () => {
  expect(isMarketOpen(new Date("2026-10-16T03:44:00Z"))).toBe(false); // 09:14 IST Fri
  expect(isMarketOpen(new Date("2026-10-16T03:45:00Z"))).toBe(true); // 09:15
  expect(isMarketOpen(new Date("2026-10-16T10:00:00Z"))).toBe(true); // 15:30
  expect(isMarketOpen(new Date("2026-10-16T10:01:00Z"))).toBe(false);
  expect(isMarketOpen(new Date("2026-10-17T05:00:00Z"))).toBe(false); // Saturday
});
test("addDays crosses month", () => expect(addDays("2026-09-30", 1)).toBe("2026-10-01"));
