import { describe, it, expect } from "vitest";
import { addDays } from "@/lib/time/ist";
import type { StoredDay } from "@/lib/db/types";
import { buildRotation, weekEnds } from "@/lib/calc/rotation";

const sd = (date: string, rsVsNifty: number | null): StoredDay => ({
  date, open: null, high: null, low: null, close: 1, volume: null,
  pctChange: null, importedPct: null, ema20: null, ema50: null, ema200: null, rsi14: null, rsVsNifty,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null,
  rsVsSector: null, score: null, scoreComponents: null, scoreLabel: null, scoreConfidence: null, scoreSignal: null,
});
/** Weekday dates from `from` to `to` inclusive, minus `skip`. */
const weekdays = (from: string, to: string, skip: string[] = []): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5 && !skip.includes(d)) out.push(d);
  }
  return out;
};

describe("weekEnds", () => {
  it("takes each week's last session; a Friday holiday falls back to Thursday", () => {
    expect(weekEnds(weekdays("2026-09-28", "2026-10-16", ["2026-10-02"]), 3)).toEqual(["2026-10-01", "2026-10-09", "2026-10-16"]);
  });
  it("mid-week: the current week ends at the latest session", () => {
    expect(weekEnds(weekdays("2026-09-28", "2026-10-14"), 3).at(-1)).toBe("2026-10-14");
  });
  it("returns fewer when history is short; ignores order of input", () => {
    expect(weekEnds(["2026-10-16", "2026-10-15"], 8)).toEqual(["2026-10-16"]);
  });
});

describe("buildRotation", () => {
  const sessions = weekdays("2026-08-03", "2026-10-16");
  const sector = (key: string, rsByDate: Record<string, number | null>) => ({
    key, name: `Nifty ${key}`, days: sessions.map((d) => sd(d, d in rsByDate ? rsByDate[d] : null)),
  });
  it("ranks by RS desc with week-on-week change", () => {
    const rows = buildRotation([
      sector("AUTO", { "2026-10-09": -0.01, "2026-10-16": -0.02 }),
      sector("BANK", { "2026-10-09": 0.02, "2026-10-16": 0.01 }),
      sector("IT", { "2026-10-09": 0.0, "2026-10-16": 0.03 }),
    ], sessions);
    expect(rows.map((r) => [r.key, r.rank, r.change, r.rs])).toEqual([
      ["IT", 1, 1, 0.03], ["BANK", 2, -1, 0.01], ["AUTO", 3, 0, -0.02],
    ]);
    expect(rows[0].name).toBe("Nifty IT");
  });
  it("ties on RS → lower key ranks better", () => {
    const rows = buildRotation([sector("B", { "2026-10-16": 0.01 }), sector("A", { "2026-10-16": 0.01 })], sessions);
    expect(rows.map((r) => [r.key, r.rank])).toEqual([["A", 1], ["B", 2]]);
  });
  it("a thin sector with no RS is unranked and listed last", () => {
    const rows = buildRotation([
      { key: "THIN", name: "Thin", days: [sd("2026-10-16", null)] },
      sector("IT", { "2026-10-09": 0.01, "2026-10-16": 0.02 }),
    ], sessions);
    expect(rows.map((r) => r.key)).toEqual(["IT", "THIN"]);
    expect(rows[1]).toMatchObject({ rank: null, change: null, rs: null });
    expect(rows[1].history.every((h) => h === null)).toBe(true);
    expect(rows[0].change).toBe(0);
  });
  it("change is null when last week had no rank", () => {
    const [r] = buildRotation([sector("IT", { "2026-10-16": 0.02 })], sessions);
    expect(r).toMatchObject({ rank: 1, change: null });
  });
  it("history has 8 entries (oldest → newest) when 9+ week ends exist, fewer otherwise", () => {
    const [r] = buildRotation([sector("IT", Object.fromEntries(sessions.map((d) => [d, 0.01])))], sessions);
    expect(sessions.length).toBeGreaterThan(45);
    expect(r.history).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    const short = weekdays("2026-10-05", "2026-10-16");
    const [s] = buildRotation([{ key: "IT", name: "IT", days: short.map((d) => sd(d, 0.01)) }], short);
    expect(s.history).toEqual([1, 1]);
  });
});
