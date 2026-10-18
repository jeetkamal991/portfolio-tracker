import { describe, it, expect } from "vitest";
import type { StoredDay } from "@/lib/db/types";
import { buildDailyLog, logCellColor, LOG_COLUMNS } from "@/lib/view/dailyLog";

const sd = (date: string, o: Partial<StoredDay> = {}): StoredDay => ({
  date, open: null, high: null, low: null, close: null, volume: null,
  pctChange: null, importedPct: null, ema20: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null,
  rsVsSector: null, score: null, scoreComponents: null, scoreLabel: null, scoreConfidence: null, scoreSignal: null,
  ...o,
});
const NOW = new Date("2026-10-18T06:00:00Z");

describe("buildDailyLog months", () => {
  it("current IST month and 5 before, newest first, no year within one year", () => {
    const m = buildDailyLog({}, [], NOW);
    expect(m.map((x) => x.id)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(m.map((x) => x.label)).toEqual(["OCT", "SEP", "AUG", "JUL", "JUN", "MAY"]);
    expect(m[0].rows).toEqual([]);
  });
  it("adds the year when the months span two years", () => {
    const m = buildDailyLog({}, [], new Date("2026-02-10T06:00:00Z"));
    expect(m.map((x) => x.label)).toEqual(["FEB 2026", "JAN 2026", "DEC 2025", "NOV 2025", "OCT 2025", "SEP 2025"]);
  });
});

describe("buildDailyLog rows", () => {
  const dates = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"];
  const series = {
    NIFTY50: [sd("2026-10-01", { pctChange: 0.01 }), sd("2026-10-02", { pctChange: -0.02 }), sd("2026-10-05", { pctChange: 0.005 })],
    NIFTY_IT: [sd("2026-10-01", { pctChange: null, importedPct: 0.0123 }), sd("2026-10-05", { pctChange: 0.02 })],
  };
  const m = buildDailyLog(series, dates, NOW)[0];
  it("follows session dates in the month, ascending", () => {
    expect(m.rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-05"]);
  });
  it("null for a missing row, importedPct fallback", () => {
    expect(m.rows[0].values.NIFTY_IT).toBe(0.0123);
    expect(m.rows[1].values.NIFTY_IT).toBeNull();
    expect(m.rows[0].values.NIFTY_BANK).toBeNull();
  });
  it("sum and compound over non-null values", () => {
    expect(m.totals.NIFTY50.sum).toBeCloseTo(-0.005, 10);
    expect(m.totals.NIFTY50.compound).toBeCloseTo(1.01 * 0.98 * 1.005 - 1, 10);
    expect(m.totals.NIFTY_BANK).toEqual({ sum: null, compound: null });
  });
  it("matches the owner's October total", () => {
    const v = [-0.0088, 0.006, 0.0098, -0.0076, -0.0164, 0.013, -0.007, 0.016, -0.0044, 0.0166, 0.0065];
    const ds = v.map((_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const out = buildDailyLog({ NIFTY50: v.map((p, i) => sd(ds[i], { pctChange: p })) }, ds, NOW)[0];
    expect(out.totals.NIFTY50.sum).toBeCloseTo(0.0237, 10);
  });
  it("has the 12 columns", () => {
    expect(LOG_COLUMNS).toHaveLength(12);
    expect(Object.keys(m.totals)).toEqual(LOG_COLUMNS.map((c) => c.key));
  });
});

describe("logCellColor", () => {
  it("saturates, transparent for null, red for negatives", () => {
    expect(logCellColor(0.03, "day")).toBe(logCellColor(0.05, "day"));
    expect(logCellColor(null, "day")).toBe("transparent");
    expect(logCellColor(-0.01, "day")).toContain("251,113,133");
    expect(logCellColor(0, "day")).toContain("52,211,153");
    expect(logCellColor(0.1, "total")).toBe(logCellColor(0.2, "total"));
  });
});
