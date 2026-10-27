import { describe, expect, it } from "vitest";
import { alphaStrategy, holdStrategy, randomStrategy, RULE_IDS, ruleStrategy, type StockSeries } from "@/lib/calc/backtest/strategy";
import type { OhlcvDay, StoredDay } from "@/lib/db/types";

const DATE = "2026-02-06";
const bar = (o: number, h: number, l: number, c: number, date = DATE): OhlcvDay => ({
  date, open: o, high: h, low: l, close: c, volume: 100, pctChange: null, importedPct: null,
});
const one = (key: string, d: OhlcvDay): StockSeries => ({ key, name: key, days: [d] });

function stored(date: string, o: Partial<StoredDay> = {}): StoredDay {
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
const SIX = ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", DATE];
const rows6 = (patch: (i: number) => Partial<StoredDay>): StoredDay[] => SIX.map((d, i) => stored(d, patch(i)));

describe("alphaStrategy", () => {
  it("returns the keys with the highest alpha value first, capped at top", () => {
    const window = [
      one("s1", bar(10, 12, 8, 11)), // (c-o)/(h-l+0.001) = 1/4.001
      one("s2", bar(10, 12, 8, 9)), // -1/4.001
      one("s3", bar(10, 10, 10, 10.5)), // flat range: 0.5/0.001
    ];
    const s = alphaStrategy("a101", 2);
    expect(s.pick(window, DATE, 10)).toEqual(["s3", "s1"]);
    expect(s.pick(window, DATE, 1)).toEqual(["s3"]);
    expect(s.lookback).toBe(30);
    expect(s.id).toBe("alpha:a101");
    expect(s.params).toEqual({ alpha: "a101", top: 2 });
  });
});

describe("ruleStrategy", () => {
  it("golden: keeps only the stock whose EMA 50 crossed above EMA 200 in the last 5 sessions", () => {
    const up: StockSeries<StoredDay> = { key: "up", name: "up", days: rows6((i) => ({ ema50: i < 3 ? 90 : 110, ema200: 100 })) };
    const flat: StockSeries<StoredDay> = { key: "flat", name: "flat", days: rows6(() => ({ ema50: 110, ema200: 100 })) };
    const s = ruleStrategy("golden");
    expect(s.pick([flat, up], DATE, 10)).toEqual(["up"]);
    expect(s.lookback).toBe(6);
    expect(s.id).toBe("rule:golden");
  });

  it("rsi_low: oversold stocks, lowest RSI first", () => {
    const at = (key: string, rsi: number): StockSeries<StoredDay> => ({ key, name: key, days: rows6((i) => (i === 5 ? { rsi14: rsi } : {})) });
    expect(ruleStrategy("rsi_low").pick([at("a", 25), at("b", 15), at("c", 50)], DATE, 10)).toEqual(["b", "a"]);
  });

  it("offers the eight price rules and no score rules", () => {
    expect([...RULE_IDS].sort()).toEqual(["breakdown", "breakout", "death", "golden", "rsi_high", "rsi_low", "vol_down", "vol_up"]);
  });
});

describe("holdStrategy", () => {
  it("wants its stock whenever the stock has a bar", () => {
    const s = holdStrategy("X");
    expect(s.pick([one("X", bar(1, 1, 1, 1)), one("Y", bar(1, 1, 1, 1))], DATE, 10)).toEqual(["X"]);
    expect(s.pick([one("Y", bar(1, 1, 1, 1))], DATE, 10)).toEqual([]);
    expect(s.lookback).toBe(1);
  });
});

describe("randomStrategy", () => {
  const window = Array.from({ length: 20 }, (_, i) => one(`k${String(i).padStart(2, "0")}`, bar(1, 1, 1, 1)));
  it("is deterministic for a seed and date, and differs across seeds and dates", () => {
    const a = randomStrategy(1).pick(window, DATE, 5);
    expect(a).toHaveLength(5);
    expect(new Set(a).size).toBe(5);
    expect(randomStrategy(1).pick(window, DATE, 5)).toEqual(a);
    expect(randomStrategy(2).pick(window, DATE, 5)).not.toEqual(a);
    expect(randomStrategy(1).pick(window, "2026-02-09", 5)).not.toEqual(a);
  });
  it("never returns more than the limit or more than there are stocks", () => {
    expect(randomStrategy(3).pick(window, DATE, 3)).toHaveLength(3);
    expect(randomStrategy(3).pick(window.slice(0, 2), DATE, 10)).toHaveLength(2);
    expect(randomStrategy(3).pick([], DATE, 10)).toEqual([]);
  });
});
