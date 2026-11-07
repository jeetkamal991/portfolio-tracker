import { describe, expect, it } from "vitest";
import { runWatchSignals } from "@/lib/calc/watchSignals";
import type { StoredDay } from "@/lib/db/types";

const SESSION = "2026-10-16";

function day(date: string, o: Partial<StoredDay> = {}): StoredDay {
  return {
    date, open: null, high: null, low: null, close: 100, volume: null,
    pctChange: null, importedPct: null, ema20: null, ema50: null, ema200: null,
    rsi14: null, rsVsNifty: null, macd: null, macdSignal: null, macdHist: null,
    bbUpper: null, bbMiddle: null, bbLower: null, volAvg20: null,
    high52w: null, low52w: null, patterns: null, rsVsSector: null,
    score: null, scoreComponents: null, scoreLabel: null,
    scoreConfidence: null, scoreSignal: null,
    ...o,
  };
}

const DATES = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", SESSION];
function series(patch: (i: number) => Partial<StoredDay>, n = 6) {
  return DATES.slice(-n).map((d, i) => day(d, patch(i)));
}
const stock = (key: string, days: StoredDay[]) => ({ key, name: key.toUpperCase(), days });
const labels = (r: ReturnType<typeof runWatchSignals>["crosses"]) => r.map((s) => `${s.key}:${s.label}:${s.date}`);

describe("runWatchSignals · crosses", () => {
  it("finds a golden cross inside the window and dates it", () => {
    // rows 0..5; ema50 crosses above ema200 on row 3 (2026-10-14)
    const days = series((i) => ({ ema50: i >= 3 ? 101 : 99, ema200: 100 }));
    const r = runWatchSignals([stock("a", days)], SESSION);
    expect(r.crosses).toEqual([
      { key: "a", name: "A", date: "2026-10-14", label: "Golden cross (EMA 50 / 200)", bias: "bullish" },
    ]);
  });

  it("finds a death cross, including one on the session itself", () => {
    const days = series((i) => ({ ema50: i === 5 ? 99 : 101, ema200: 100 }));
    const r = runWatchSignals([stock("a", days)], SESSION);
    expect(labels(r.crosses)).toEqual(["a:Death cross (EMA 50 / 200):2026-10-16"]);
    expect(r.crosses[0].bias).toBe("bearish");
  });

  it("ignores a cross older than 5 sessions (row 0 is only the baseline)", () => {
    // flips between row 0 and row 1 → day index 1 is inside the window; flip before row 0 is not seen
    const outside = series(() => ({ ema50: 101, ema200: 100 }), 6);
    outside[0] = day(outside[0].date, { ema50: 99, ema200: 100 }); // row0 below, row1 above → cross on row 1
    expect(labels(runWatchSignals([stock("a", outside)], SESSION).crosses)).toEqual([
      "a:Golden cross (EMA 50 / 200):2026-10-12",
    ]);
    // 8 rows: cross between rows 0 and 1 of the full array is outside the last 6
    const old = DATES.map((d, i) => day(d, { ema50: i >= 1 ? 101 : 99, ema200: 100 }));
    expect(runWatchSignals([stock("a", old)], SESSION).crosses).toEqual([]);
  });

  it("detects EMA 20/50 and price/EMA 200 crosses in both directions", () => {
    const up = series((i) => ({
      ema20: i >= 5 ? 51 : 49, ema50: 50,
      close: i >= 5 ? 201 : 199, ema200: 200,
    }));
    const down = series((i) => ({
      ema20: i >= 5 ? 49 : 51, ema50: 50,
      close: i >= 5 ? 199 : 201, ema200: 200,
    }));
    const r = runWatchSignals([stock("up", up), stock("dn", down)], SESSION);
    expect(r.crosses.map((s) => `${s.key}:${s.label}:${s.bias}`)).toEqual([
      "dn:EMA 20 crossed below EMA 50:bearish",
      "dn:Closed below EMA 200:bearish",
      "up:EMA 20 crossed above EMA 50:bullish",
      "up:Closed above EMA 200:bullish",
    ]);
  });

  it("does not count equal values as a cross, and skips nulls", () => {
    const flat = series((i) => ({ ema50: i >= 3 ? 100 : 99, ema200: 100 })); // reaches equality, never above
    const gaps = series((i) => ({ ema50: i === 3 ? null : i > 3 ? 101 : 99, ema200: 100 }));
    const r = runWatchSignals([stock("flat", flat), stock("gaps", gaps)], SESSION);
    expect(labels(r.crosses)).toEqual([]);
  });

  it("skips a stock whose latest row is not the session", () => {
    const stale = DATES.slice(1, 7).map((d, i) => day(d, { ema50: i >= 3 ? 101 : 99, ema200: 100 }));
    expect(runWatchSignals([stock("a", stale)], SESSION).crosses).toEqual([]);
  });

  it("sorts newest first, then key", () => {
    const a = series((i) => ({ ema50: i >= 2 ? 101 : 99, ema200: 100 }));
    const b = series((i) => ({ ema50: i >= 4 ? 101 : 99, ema200: 100 }));
    const c = series((i) => ({ ema50: i >= 4 ? 101 : 99, ema200: 100 }));
    const r = runWatchSignals([stock("c", c), stock("a", a), stock("b", b)], SESSION);
    expect(r.crosses.map((s) => `${s.key}:${s.date}`)).toEqual(["b:2026-10-15", "c:2026-10-15", "a:2026-10-13"]);
  });

  it("returns empty lists for no stocks", () => {
    expect(runWatchSignals([], SESSION)).toEqual({ crosses: [] });
  });
});
