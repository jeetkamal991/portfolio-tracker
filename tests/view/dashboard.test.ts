import { describe, it, expect } from "vitest";
import { buildAsOf, buildSectorRows, buildTodaySummary, heatColor } from "@/lib/view/dashboard";
import { SECTOR_KEYS } from "@/lib/instruments";
import type { JobRun, StoredDay } from "@/lib/db/types";

const day = (i: number, o: Partial<StoredDay> = {}): StoredDay => ({
  date: `2026-01-${String(i + 1).padStart(2, "0")}`,
  open: null, high: null, low: null, close: 100 + i, volume: null,
  pctChange: 0.01, importedPct: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null, ...o,
});
const series = (n: number) => Array.from({ length: n }, (_, i) => day(i));
const datesOf = (days: StoredDay[]) => days.map((d) => d.date);
const run = (status: JobRun["status"]): JobRun => ({ job: "eod", startedAt: "", finishedAt: "", status, message: "" });

describe("buildSectorRows", () => {
  it("returns rows in SECTOR_KEYS order with correct returns", () => {
    const days = series(70);
    const input = [...SECTOR_KEYS].reverse().map((key) => ({ key, name: key, days }));
    const rows = buildSectorRows(input, datesOf(days));
    expect(rows.map((r) => r.key)).toEqual(SECTOR_KEYS);
    const c = days.map((d) => d.close!);
    expect(rows[0].w1).toBeCloseTo(c[69] / c[64] - 1, 12);
    expect(rows[0].m1).toBeCloseTo(c[69] / c[48] - 1, 12);
    expect(rows[0].m3).not.toBeNull();
  });
  it("m3 is null with 30 days", () => {
    expect(buildSectorRows([{ key: SECTOR_KEYS[0], name: "A", days: series(30) }], datesOf(series(30)))[0].m3).toBeNull();
  });
  it("last row with null close uses imported pct for d1, w1 from priced rows", () => {
    const days = [...series(10), day(10, { close: null, pctChange: null, importedPct: 0.0065 })];
    const r = buildSectorRows([{ key: SECTOR_KEYS[0], name: "A", days }], datesOf(days))[0];
    expect(r.d1).toBe(0.0065);
    expect(r.w1).toBeCloseTo(109 / 104 - 1, 12);
  });
  it("trend uses the latest priced row", () => {
    const days = [day(0, { ema50: 90, ema200: 80 })];
    expect(buildSectorRows([{ key: SECTOR_KEYS[0], name: "A", days }], datesOf(days))[0].trend).toBe("above_both");
  });
  it("missing or empty series gives all-null row", () => {
    const r = buildSectorRows([], [])[0];
    expect([r.d1, r.w1, r.m1, r.m3, r.trend]).toEqual([null, null, null, null, null]);
  });
  it("period returns use the Nifty calendar: a gap at the 5-back session gives null w1", () => {
    const cal = series(30); // Nifty sessions 2026-01-01..30
    const gapped = cal.filter((_, i) => i !== 24); // missing the session 5 back from the last (index 29)
    const r = buildSectorRows([{ key: SECTOR_KEYS[0], name: "A", days: gapped }], datesOf(cal))[0];
    expect(r.w1).toBeNull();
    expect(r.m1).toBeCloseTo(129 / 108 - 1, 12); // 21 sessions back (index 8) is present
  });
  it("a gap elsewhere does not shift the 5-back session", () => {
    const cal = series(30);
    const gapped = cal.filter((_, i) => i !== 26);
    const r = buildSectorRows([{ key: SECTOR_KEYS[0], name: "A", days: gapped }], datesOf(cal))[0];
    expect(r.w1).toBeCloseTo(129 / 124 - 1, 12); // own-bar offset would give 129/123 - 1
  });
  it("null when the latest priced row is not a Nifty session", () => {
    const cal = series(30);
    const r = buildSectorRows([{ key: SECTOR_KEYS[0], name: "A", days: cal }], datesOf(cal).slice(0, 29))[0];
    expect(r.w1).toBeNull();
  });
});

describe("buildTodaySummary", () => {
  it("coalesces pctChange then importedPct on latest row", () => {
    expect(buildTodaySummary([day(0), day(1, { pctChange: null, importedPct: 0.02 })])).toBe(0.02);
    expect(buildTodaySummary([day(0), day(1, { pctChange: 0.005, importedPct: 0.02 })])).toBe(0.005);
    expect(buildTodaySummary([])).toBeNull();
  });
});

describe("heatColor", () => {
  it("saturates", () => {
    expect(heatColor(0.03, "d1")).toBe(heatColor(0.05, "d1"));
    expect(heatColor(0.03, "d1")).not.toBe(heatColor(0.01, "d1"));
    expect(heatColor(-0.2, "m3")).toBe(heatColor(-0.15, "m3"));
  });
  it("null is neutral grey, distinct from signed", () => {
    expect(heatColor(null, "d1")).not.toBe(heatColor(0.01, "d1"));
    expect(heatColor(null, "d1")).not.toMatch(/NaN|undefined/);
    expect(heatColor(0, "d1")).toBe(heatColor(null, "d1"));
  });
});

describe("buildAsOf", () => {
  // IST = UTC+05:30. 2026-10-16 is a Friday.
  const FRI_1800 = new Date("2026-10-16T12:30:00Z");
  const FRI_1700 = new Date("2026-10-16T11:30:00Z");
  const SAT_1200 = new Date("2026-10-17T06:30:00Z");
  const MON_1000 = new Date("2026-10-19T04:30:00Z");
  const TUE_1800 = new Date("2026-10-20T12:30:00Z");

  it("stale for partial and failed, not for no_session / ok / none", () => {
    expect(buildAsOf("2026-10-16", run("partial"), FRI_1800)).toEqual({ date: "2026-10-16", stale: true });
    expect(buildAsOf("2026-10-16", run("failed"), FRI_1800).stale).toBe(true);
    expect(buildAsOf("2026-10-16", run("no_session"), FRI_1800).stale).toBe(false);
    expect(buildAsOf("2026-10-16", run("ok"), FRI_1800).stale).toBe(false);
    expect(buildAsOf(null, null, FRI_1800)).toEqual({ date: null, stale: false });
  });

  it("stale when the latest date is older than the last weekday whose 17:30 IST has passed", () => {
    expect(buildAsOf("2026-10-15", run("ok"), FRI_1800).stale).toBe(true);
    expect(buildAsOf("2026-10-15", run("ok"), FRI_1700).stale).toBe(false);
    expect(buildAsOf("2026-10-16", run("ok"), MON_1000).stale).toBe(false);
    expect(buildAsOf("2026-10-16", run("ok"), SAT_1200).stale).toBe(false);
    expect(buildAsOf("2026-10-16", run("ok"), TUE_1800).stale).toBe(true);
  });

  it("date staleness applies even with no job run or a no_session run (cron never fired / null close)", () => {
    expect(buildAsOf("2026-10-15", null, FRI_1800).stale).toBe(true);
    expect(buildAsOf("2026-10-15", run("no_session"), FRI_1800).stale).toBe(true);
  });

  it("stale when the last run is still `running` after 15 minutes", () => {
    const running = (startedAt: string): JobRun => ({ ...run("running"), startedAt, finishedAt: null });
    expect(buildAsOf("2026-10-16", running("2026-10-16T12:10:00Z"), FRI_1800).stale).toBe(true); // 20 min
    expect(buildAsOf("2026-10-16", running("2026-10-16T12:20:00Z"), FRI_1800).stale).toBe(false); // 10 min
  });
});

import { buildWatchlistRow, parseLevelInput } from "@/lib/view/dashboard";
import type { Levels } from "@/lib/db/types";

const lv = (o: Partial<Levels> = {}): Levels => ({
  autoSupport: null, autoResistance: null, manualSupport: null, manualResistance: null, ...o,
});
const input = (d: Partial<StoredDay> = {}, l: Partial<Levels> = {}) => ({
  key: "TCS", name: "TCS", lastDay: day(0, { close: 100, ema50: 90, ema200: 80, ...d }), levels: lv(l),
});

describe("buildWatchlistRow", () => {
  it("manual support overrides auto and flags manual", () => {
    const r = buildWatchlistRow(input({}, { autoSupport: 95, manualSupport: 92 }), 100);
    expect(r.support).toBe(92);
    expect(r.supportIsManual).toBe(true);
    expect(r.resistanceIsManual).toBe(false);
  });
  it("near level within 1%", () => {
    expect(buildWatchlistRow(input({}, { autoSupport: 99.2 }), 100).nearLevel).toBe(true);
    expect(buildWatchlistRow(input({}, { autoSupport: 90 }), 100).nearLevel).toBe(false);
  });
  it("computes distances from EMAs and levels", () => {
    const r = buildWatchlistRow(input({}, { autoSupport: 95, autoResistance: 110 }), 100);
    expect(r.fromEma50).toBeCloseTo((100 - 90) / 90, 12);
    expect(r.fromEma200).toBeCloseTo((100 - 80) / 80, 12);
    expect(r.toResistance).toBeCloseTo(0.1, 12);
    expect(r.toSupport).toBeCloseTo(0.05, 12);
    expect(r.trend).toBe("above_both");
  });
  it("null ema200 means not enough history and no trend", () => {
    const r = buildWatchlistRow(input({ ema200: null }), 100);
    expect(r.notEnoughHistory).toBe(true);
    expect(r.trend).toBeNull();
    expect(r.fromEma200).toBeNull();
  });
  it("dayPct falls back to imported pct", () => {
    expect(buildWatchlistRow(input({ pctChange: null, importedPct: 0.02 }), 100).dayPct).toBe(0.02);
    expect(buildWatchlistRow(input({ pctChange: 0.01 }), 100, 0.03).dayPct).toBe(0.03);
  });
});

describe("parseLevelInput", () => {
  it("parses empty, valid and invalid", () => {
    expect(parseLevelInput("")).toEqual({ ok: true, value: null });
    expect(parseLevelInput("  ")).toEqual({ ok: true, value: null });
    expect(parseLevelInput("95")).toEqual({ ok: true, value: 95 });
    expect(parseLevelInput("95.5")).toEqual({ ok: true, value: 95.5 });
    expect(parseLevelInput("-3").ok).toBe(false);
    expect(parseLevelInput("0").ok).toBe(false);
    expect(parseLevelInput("abc").ok).toBe(false);
  });
});

import { pctTone } from "@/lib/view/dashboard";

describe("pctTone", () => {
  it("uses the dark palette tokens with no dark: variants", () => {
    expect(pctTone(0.01)).toContain("var(--up)");
    expect(pctTone(-0.01)).toContain("var(--down)");
    expect(pctTone(0)).toContain("var(--muted)");
    expect(pctTone(null)).toContain("var(--muted)");
    for (const v of [0.01, -0.01, 0, null]) expect(pctTone(v)).not.toContain("dark:");
  });
});
