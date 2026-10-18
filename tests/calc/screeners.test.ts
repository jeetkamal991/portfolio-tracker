import { describe, expect, it } from "vitest";
import { runScreeners, SCREENERS } from "@/lib/calc/screeners";
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

// ascending dates; the last one is SESSION
const DATES = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", SESSION];
// the last n rows; patch(i) gets the index within those n rows
function series(patch: (i: number) => Partial<StoredDay>, n = 6) {
  return DATES.slice(-n).map((d, i) => day(d, patch(i)));
}
const stock = (key: string, days: StoredDay[]) => ({ key, name: key.toUpperCase(), days });
// 6 rows, only the session row patched
const last = (o: Partial<StoredDay>) => series((i) => (i === 5 ? o : {}));
type Res = ReturnType<typeof runScreeners>;
const get = (res: Res, id: string) => res.find((r) => r.id === id)!;
const keys = (res: Res, id: string) => get(res, id).hits.map((h) => h.key);

describe("SCREENERS", () => {
  it("lists the ten screeners in table order", () => {
    expect(SCREENERS.map((s) => s.id)).toEqual([
      "vol_up", "vol_down", "breakout", "breakdown", "golden", "death",
      "rsi_high", "rsi_low", "score_top", "score_bottom",
    ]);
  });
});

describe("volume shockers", () => {
  it("2.0x up qualifies with metric 2; 1.99x does not", () => {
    const res = runScreeners([
      stock("a", last({ volume: 200, volAvg20: 100, pctChange: 0.01 })),
      stock("b", last({ volume: 199, volAvg20: 100, pctChange: 0.01 })),
    ], SESSION);
    expect(keys(res, "vol_up")).toEqual(["a"]);
    const hit = get(res, "vol_up").hits[0];
    expect(hit.metric).toBe(2);
    expect(hit.dayPct).toBe(0.01);
    expect(hit.close).toBe(100);
    expect(hit.name).toBe("A");
  });
  it("2.5x down goes to vol_down only, falling back to importedPct", () => {
    const res = runScreeners([stock("a", last({ volume: 250, volAvg20: 100, importedPct: -0.02 }))], SESSION);
    expect(keys(res, "vol_down")).toEqual(["a"]);
    expect(keys(res, "vol_up")).toEqual([]);
  });
  it("null volAvg20 or null day pct is in neither", () => {
    const res = runScreeners([
      stock("a", last({ volume: 500, volAvg20: null, pctChange: 0.02 })),
      stock("b", last({ volume: 500, volAvg20: 100 })),
    ], SESSION);
    expect(keys(res, "vol_up")).toEqual([]);
    expect(keys(res, "vol_down")).toEqual([]);
  });
  it("sorts by ratio desc, ties by key", () => {
    const res = runScreeners([
      stock("c", last({ volume: 300, volAvg20: 100, pctChange: 0.01 })),
      stock("b", last({ volume: 400, volAvg20: 100, pctChange: 0.01 })),
      stock("a", last({ volume: 300, volAvg20: 100, pctChange: 0.01 })),
    ], SESSION);
    expect(keys(res, "vol_up")).toEqual(["b", "a", "c"]);
  });
});

describe("52-week zones", () => {
  it("breakout: close 97 vs high 100 in with metric -0.03; 96.9 out", () => {
    const res = runScreeners([
      stock("a", last({ close: 97, high52w: 100 })),
      stock("b", last({ close: 96.9, high52w: 100 })),
    ], SESSION);
    expect(keys(res, "breakout")).toEqual(["a"]);
    expect(get(res, "breakout").hits[0].metric).toBeCloseTo(-0.03, 10);
    expect(get(res, "breakout").hits[0].flag).toBeNull();
  });
  it("new high flags NEW_HIGH and sorts before non-new rows", () => {
    const nh = series((i) => (i === 4 ? { high52w: 100 } : i === 5 ? { close: 101, high52w: 105 } : {}));
    const res = runScreeners([
      stock("a", last({ close: 99.9, high52w: 100 })),
      stock("z", nh),
    ], SESSION);
    expect(keys(res, "breakout")).toEqual(["z", "a"]);
    expect(get(res, "breakout").hits[0].flag).toBe("NEW_HIGH");
  });
  it("breakdown mirror: 103 vs low 100 in, 103.1 out, NEW_LOW first", () => {
    const nl = series((i) => (i === 4 ? { low52w: 100 } : i === 5 ? { close: 99, low52w: 95 } : {}));
    const res = runScreeners([
      stock("a", last({ close: 103, low52w: 100 })),
      stock("b", last({ close: 103.1, low52w: 100 })),
      stock("z", nl),
    ], SESSION);
    expect(keys(res, "breakdown")).toEqual(["z", "a"]);
    expect(get(res, "breakdown").hits[0].flag).toBe("NEW_LOW");
    expect(get(res, "breakdown").hits[1].metric).toBeCloseTo(0.03, 10);
  });
  it("null high52w/low52w skips the stock", () => {
    const res = runScreeners([stock("a", last({ close: 100 }))], SESSION);
    expect(get(res, "breakout").count).toBe(0);
    expect(get(res, "breakdown").count).toBe(0);
  });
});

describe("crosses", () => {
  // rows from crossIdx onward are on the new side of the cross (ema50 vs ema200 = 10)
  const crossAt = (crossIdx: number, up: boolean, n = 6) =>
    series((i) => {
      const bull = up ? i >= crossIdx : i < crossIdx;
      return { ema50: bull ? 11 : 9, ema200: 10 };
    }, n);

  it("golden: ema50 <= ema200 at session-5 and > at session-4 is in, dated session-4", () => {
    const res = runScreeners([stock("a", crossAt(1, true))], SESSION);
    expect(keys(res, "golden")).toEqual(["a"]);
    const h = get(res, "golden").hits[0];
    expect(h.date).toBe("2026-10-12");
    expect(h.metric).toBeNull();
  });
  it("golden: cross on the session itself is in", () => {
    const res = runScreeners([stock("a", crossAt(5, true))], SESSION);
    expect(get(res, "golden").hits[0].date).toBe(SESSION);
  });
  it("golden: a cross between session-6 and session-5 is out, even with longer history", () => {
    // 8 rows, the cross day is index 2 = session-5, outside the last 5 sessions
    const res = runScreeners([stock("a", crossAt(2, true, 8))], SESSION);
    expect(keys(res, "golden")).toEqual([]);
  });
  it("golden: ignores rows beyond the last six", () => {
    // 8 rows; a cross at index 0 / 1 must not matter either
    const res = runScreeners([stock("a", crossAt(1, true, 8))], SESSION);
    expect(keys(res, "golden")).toEqual([]);
  });
  it("death mirror and most-recent-first ordering", () => {
    const res = runScreeners([
      stock("a", crossAt(2, false)),
      stock("b", crossAt(4, false)),
    ], SESSION);
    expect(keys(res, "death")).toEqual(["b", "a"]);
    expect(keys(res, "golden")).toEqual([]);
  });
  it("null emas skip the stock", () => {
    const res = runScreeners([stock("a", series(() => ({})))], SESSION);
    expect(get(res, "golden").count).toBe(0);
    expect(get(res, "death").count).toBe(0);
  });
});

describe("RSI", () => {
  it("overbought is strictly above 70, descending", () => {
    const res = runScreeners([
      stock("a", last({ rsi14: 70 })),
      stock("b", last({ rsi14: 70.01 })),
      stock("c", last({ rsi14: 80 })),
    ], SESSION);
    expect(keys(res, "rsi_high")).toEqual(["c", "b"]);
    expect(get(res, "rsi_high").hits[0].metric).toBe(80);
  });
  it("oversold is strictly below 30, ascending", () => {
    const res = runScreeners([
      stock("a", last({ rsi14: 30 })),
      stock("b", last({ rsi14: 29.99 })),
      stock("c", last({ rsi14: 20 })),
    ], SESSION);
    expect(keys(res, "rsi_low")).toEqual(["c", "b"]);
  });
});

describe("score lists", () => {
  const twelve = Array.from({ length: 12 }, (_, i) =>
    stock(`s${String(i).padStart(2, "0")}`, last({ score: 50 + (i % 6) * 5, scoreLabel: "Bullish" })));
  it("caps hits at 10 but counts all 12, ties by key", () => {
    const res = runScreeners(twelve, SESSION);
    const top = get(res, "score_top");
    expect(top.count).toBe(12);
    expect(top.hits).toHaveLength(10);
    expect(top.hits.map((h) => h.key).slice(0, 4)).toEqual(["s05", "s11", "s04", "s10"]);
    expect(top.hits[0].metric).toBe(75);
    expect(top.hits[0].scoreLabel).toBe("Bullish");
    const bottom = get(res, "score_bottom");
    expect(bottom.count).toBe(12);
    expect(bottom.hits.map((h) => h.key).slice(0, 3)).toEqual(["s00", "s06", "s01"]);
  });
  it("null score is skipped", () => {
    const res = runScreeners([stock("a", last({}))], SESSION);
    expect(get(res, "score_top").count).toBe(0);
  });
});

describe("session eligibility", () => {
  it("excludes a stock whose last row is not on the session from every screener", () => {
    const stale = DATES.slice(0, 6).map((d, i) => day(d, i === 5
      ? { volume: 500, volAvg20: 100, pctChange: 0.02, close: 99, high52w: 100, rsi14: 80, score: 90 }
      : {}));
    const res = runScreeners([stock("a", stale)], SESSION);
    for (const r of res) expect(r.count).toBe(0);
  });
  it("returns all ten results even when empty", () => {
    expect(runScreeners([], SESSION)).toHaveLength(10);
  });
});
