import { afterEach, describe, expect, it, vi } from "vitest";
import { ALPHAS } from "@/lib/calc/alpha/alphas";
import { ALPHA_WINDOW, runAlphas } from "@/lib/calc/alpha/run";
import type { StoredDay } from "@/lib/db/types";

const dateOf = (t: number) => new Date(Date.UTC(2026, 8, 1 + t)).toISOString().slice(0, 10);

function day(date: string, o: Partial<StoredDay> = {}): StoredDay {
  return {
    date, open: 100, high: 100, low: 100, close: 100, volume: 100,
    pctChange: null, importedPct: null, ema20: null, ema50: null, ema200: null,
    rsi14: null, rsVsNifty: null, macd: null, macdSignal: null, macdHist: null,
    bbUpper: null, bbMiddle: null, bbLower: null, volAvg20: null,
    high52w: null, low52w: null, patterns: null, rsVsSector: null,
    score: null, scoreComponents: null, scoreLabel: null,
    scoreConfidence: null, scoreSignal: null,
    ...o,
  };
}
// n rows ending on the session; patch gets the row index (0 = oldest)
const rows = (n: number, patch: (i: number) => Partial<StoredDay>) => Array.from({ length: n }, (_, i) => day(dateOf(i), patch(i)));
const SESSION30 = dateOf(29);
const stock = (key: string, days: StoredDay[]) => ({ key, name: key.toUpperCase(), days });
// a distinct, steady series per stock so every alpha can score it
const steady = (k: number) => rows(30, (i) => ({ open: 100 + k + i, close: 101 + k + 2 * i + (i % 3), high: 110 + k + 2 * i, low: 95 + k, volume: 1000 + 37 * i * k + (i % 4) * 11 }));

afterEach(() => vi.restoreAllMocks());

describe("runAlphas", () => {
  it("returns combined first, then the six alphas in order", () => {
    const res = runAlphas([stock("a", steady(1)), stock("b", steady(2))], SESSION30);
    expect(res.map((r) => r.id)).toEqual(["combined", "a001", "a002", "a006", "a012", "a054", "a101"]);
    expect(res[0].title).toBe("Alpha rank");
    expect(res.slice(1).map((r) => r.title)).toEqual(ALPHAS.map((a) => a.title));
    expect(ALPHA_WINDOW).toBe(30);
  });

  it("leaves out a stock not priced on the session and counts the scored ones", () => {
    const stale = steady(3).slice(0, 29); // last row is the day before the session
    const res = runAlphas([stock("a", steady(1)), stock("b", steady(2)), stock("stale", stale)], SESSION30);
    const a101 = res.find((r) => r.id === "a101")!;
    expect(a101.count).toBe(2);
    expect([...a101.top, ...a101.bottom].map((h) => h.key).sort()).toEqual(["a", "b"]);
  });

  it("drops a stock with a missing bar from the alphas that need it, without breaking the others", () => {
    const gap = steady(3).filter((d) => d.date !== dateOf(28)); // no row the day before the session
    const res = runAlphas([stock("a", steady(1)), stock("b", steady(2)), stock("gap", gap)], SESSION30);
    const keys = (id: string) => {
      const r = res.find((x) => x.id === id)!;
      return [...r.top, ...r.bottom].map((h) => h.key).sort();
    };
    expect(keys("a012")).toEqual(["a", "b"]); // needs the day before
    expect(keys("a006")).toEqual(["a", "b"]); // 10-bar window holds the gap
    expect(keys("a101")).toEqual(["a", "b", "gap"]); // one bar is enough
  });

  it("scores a stock only once it has an alpha's minimum bars, whatever its returns were", () => {
    // 12 rising bars: a001 would never need its stddev branch, but still wants 25 bars of history
    const young = stock("young", steady(3).slice(-12));
    const res = runAlphas([stock("a", steady(1)), stock("b", steady(2)), young], SESSION30);
    const keys = (id: string) => {
      const r = res.find((x) => x.id === id)!;
      return [...r.top, ...r.bottom].map((h) => h.key).sort();
    };
    expect(keys("a001")).toEqual(["a", "b"]); // needs 25
    expect(keys("a006")).toEqual(["a", "b", "young"]); // needs 10
    expect(keys("a101")).toEqual(["a", "b", "young"]); // needs 1
  });

  it("ignores unpriced rows when it picks the date axis", () => {
    // x has a null-close row on a day nobody else traded, inside the last-5 window; that must not become an all-NaN column
    const x = steady(3).map((d) => (d.date === dateOf(27) ? { ...d, close: null } : d));
    const skip = (k: number) => steady(k).filter((d) => d.date !== dateOf(27));
    const res = runAlphas([stock("a", skip(1)), stock("b", skip(2)), stock("x", x)], SESSION30);
    const a001 = res.find((r) => r.id === "a001")!;
    expect([...a001.top, ...a001.bottom].map((h) => h.key).sort()).toEqual(["a", "b", "x"]);
  });

  it("says how many stocks tie beyond the ten listed", () => {
    // 25 identical stocks: the same a101 score for all
    const same = Array.from({ length: 25 }, (_, i) => stock(`s${String(i).padStart(2, "0")}`, rows(30, () => ({ open: 100, close: 101, high: 102, low: 99 }))));
    const a101 = runAlphas(same, SESSION30).find((r) => r.id === "a101")!;
    expect(a101.top).toHaveLength(10);
    expect(a101.topTied).toBe(15); // 25 share the score, 10 are shown
    expect(a101.bottom).toHaveLength(10);
    expect(a101.bottomTied).toBe(5); // 15 left after the top, 10 are shown
    const distinct = runAlphas([stock("a", steady(1)), stock("b", steady(2))], SESSION30).find((r) => r.id === "a101")!;
    expect([distinct.topTied, distinct.bottomTied]).toEqual([0, 0]);
  });

  it("never lists a stock in both top and bottom when few stocks qualify", () => {
    const stocks = [1, 2, 3, 4, 5, 6].map((k) => stock(`s${k}`, rows(30, (i) => ({ open: 100, close: 100 + k, high: 110, low: 90, volume: 100 + i }))));
    const a101 = runAlphas(stocks, SESSION30).find((r) => r.id === "a101")!;
    expect(a101.count).toBe(6);
    expect(a101.top.map((h) => h.key)).toEqual(["s6", "s5", "s4", "s3", "s2", "s1"]);
    expect(a101.bottom).toEqual([]);
    const small = runAlphas(stocks, SESSION30, 2).find((r) => r.id === "a101")!;
    expect(small.top.map((h) => h.key)).toEqual(["s6", "s5"]);
    expect(small.bottom.map((h) => h.key)).toEqual(["s1", "s2"]); // lowest first
  });

  it("carries close, day % and the raw score on each hit", () => {
    const days = rows(30, (i) => (i === 29 ? { open: 10, high: 12, low: 8, close: 11, pctChange: 0.02 } : {}));
    const a101 = runAlphas([stock("a", days)], SESSION30).find((r) => r.id === "a101")!;
    expect(a101.top[0]).toMatchObject({ key: "a", name: "A", close: 11, dayPct: 0.02 });
    expect(a101.top[0].score).toBeCloseTo(1 / 4.001, 12);
  });

  it("ranks the combined card by mean rank across the alphas that scored a stock", () => {
    // two bars each, so only a012, a054 and a101 can score; A is first on all three, B second, C last
    const two = (b0: Partial<StoredDay>, b1: Partial<StoredDay>) => [day(dateOf(28), b0), day(dateOf(29), b1)];
    const a = stock("a", two({ close: 10, volume: 100 }, { open: 8, high: 12, low: 8, close: 9, volume: 200 }));
    const b = stock("b", two({ close: 10, volume: 100 }, { open: 10, high: 12, low: 8, close: 10, volume: 100 }));
    const c = stock("c", two({ close: 10, volume: 100 }, { open: 14, high: 14, low: 11, close: 13, volume: 200 }));
    const combined = runAlphas([a, b, c], SESSION30)[0];
    expect(combined.count).toBe(3);
    expect(combined.top.map((h) => h.key)).toEqual(["a", "b", "c"]);
    expect(combined.top.map((h) => h.score)).toEqual([1, 2 / 3, 1 / 3].map((v) => expect.closeTo(v, 12)));
  });

  it("leaves a stock scored by fewer than three alphas out of the combined card", () => {
    const newbie = stock("newbie", [day(SESSION30, { open: 10, high: 12, low: 8, close: 11 })]); // a054 and a101 only
    const res = runAlphas([stock("a", steady(1)), stock("b", steady(2)), newbie], SESSION30);
    expect(res[0].count).toBe(2);
    expect([...res[0].top, ...res[0].bottom].map((h) => h.key)).not.toContain("newbie");
    expect(res.find((r) => r.id === "a101")!.count).toBe(3);
    for (const h of res[0].top) expect(h.score).toBeGreaterThan(0);
  });

  it("marks only a throwing alpha unavailable and still ranks the rest", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(ALPHAS[0], "compute").mockImplementation(() => {
      throw new Error("boom");
    });
    const res = runAlphas([stock("a", steady(1)), stock("b", steady(2)), stock("c", steady(3))], SESSION30);
    const a001 = res.find((r) => r.id === "a001")!;
    expect(a001).toMatchObject({ status: "unavailable", count: 0, top: [], bottom: [] });
    expect(res.filter((r) => r.id !== "a001").every((r) => r.status === "ok")).toBe(true);
    expect(res[0].count).toBe(3); // five alphas remain, three are enough
    expect(console.error).toHaveBeenCalled();
  });

  it("returns seven empty results when nothing is priced on the session", () => {
    const res = runAlphas([stock("a", steady(1))], "2030-01-01");
    expect(res).toHaveLength(7);
    expect(res.every((r) => r.count === 0 && r.status === "ok")).toBe(true);
  });
});
