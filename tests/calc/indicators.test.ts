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

// Nifty sessions s000..s059; the instrument is missing s030 (a THIN-sector style gap).
const cal = Array.from({ length: 60 }, (_, i) => `s${String(i).padStart(3, "0")}`);
const niftyCal = new Map(cal.map((d, i) => [d, 1000 + i]));
const gapped = cal.filter((d) => d !== "s030").map((date, i) => ({ date, close: 100 + i }));

test("pctChange is null on the day after a missed Nifty session", () => {
  const rows = computeIndicators(gapped, niftyCal);
  const at = (d: string) => rows.find((r) => r.date === d)!;
  expect(at("s031").pctChange).toBeNull();
  expect(at("s029").pctChange).toBeCloseTo(1 / 128, 12);
  expect(at("s032").pctChange).toBeCloseTo(1 / 130, 12);
});

test("RS looks 20 Nifty sessions back and is null when the instrument lacks that session", () => {
  const rows = computeIndicators(gapped, niftyCal);
  const at = (d: string) => rows.find((r) => r.date === d)!;
  // s050 - 20 sessions = s030, which the instrument does not have.
  expect(at("s050").rsVsNifty).toBeNull();
  // s051 - 20 sessions = s031 (instrument close 130); own-bar offset would wrongly use s030's neighbour.
  const c51 = 100 + 50; // s051 is the 51st kept row (index 50)
  expect(at("s051").rsVsNifty).toBeCloseTo(c51 / 130 - 1 - (1051 / 1031 - 1), 12);
  // s049 - 20 = s029: both present.
  expect(at("s049").rsVsNifty).toBeCloseTo(148 / 129 - 1 - (1049 / 1029 - 1), 12);
});

test("NIFTY50 itself (its own calendar) is unaffected", () => {
  const self = cal.map((date, i) => ({ date, close: 1000 + i }));
  const rows = computeIndicators(self, niftyCal);
  expect(rows[0]!.pctChange).toBeNull();
  expect(rows.slice(1).every((r) => r.pctChange !== null)).toBe(true);
  expect(rows[20]!.rsVsNifty).toBeCloseTo(0, 12);
});

test("today's pctChange still computes when the instrument has a session Nifty has not stored yet", () => {
  const rows = computeIndicators([...cal.map((date, i) => ({ date, close: 100 + i })), { date: "s060", close: 200 }], niftyCal);
  expect(rows[rows.length - 1]!.pctChange).toBeCloseTo(200 / 159 - 1, 12);
});

test("with an empty Nifty map, pctChange uses the previous stored bar (unchanged behaviour)", () => {
  const rows = computeIndicators(gapped, new Map());
  expect(rows.find((r) => r.date === "s031")!.pctChange).toBeCloseTo(1 / 129, 12);
  expect(rows.every((r) => r.rsVsNifty === null)).toBe(true);
});
