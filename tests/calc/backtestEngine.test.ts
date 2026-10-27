import { describe, expect, it } from "vitest";
import { NSE_COSTS, ZERO_COSTS } from "@/lib/calc/backtest/costs";
import { runEngine, type EngineSettings } from "@/lib/calc/backtest/engine";
import type { StockSeries, Strategy } from "@/lib/calc/backtest/strategy";
import type { OhlcvDay } from "@/lib/db/types";

const dates = Array.from({ length: 8 }, (_, i) => `2026-02-0${i + 1}`); // d0..d7
const row = (i: number, o: number | null, over: Partial<OhlcvDay> = {}): OhlcvDay => ({
  date: dates[i], open: o, high: o === null ? null : o + 1, low: o === null ? null : o - 1, close: o,
  volume: 1, pctChange: null, importedPct: null, ...over,
});
// one row per date from the opens; `skip` leaves those dates out, `over` patches rows by index
function series(key: string, opens: (number | null)[], skip: number[] = [], over: Record<number, Partial<OhlcvDay>> = {}): StockSeries {
  return {
    key, name: key,
    days: opens.flatMap((o, i) => (skip.includes(i) ? [] : [row(i, o, over[i])])),
  };
}
const rising = (key: string, skip: number[] = [], over: Record<number, Partial<OhlcvDay>> = {}) =>
  series(key, dates.map((_, i) => 100 + i), skip, over);

// picks[i] are the keys wanted after the close of d_i
function stub(picks: Record<number, string[]>, lookback = 1): Strategy {
  return { id: "stub", label: "stub", params: {}, lookback, pick: (_w, date) => picks[dates.indexOf(date)] ?? [] };
}
const base: EngineSettings = { capital: 10000, maxPositions: 1, holdSessions: 3, stopPct: null, costs: ZERO_COSTS };

describe("runEngine entries and exits", () => {
  it("buys at the next open and sells H sessions later at the open", () => {
    const r = runEngine([rising("A")], dates, stub({ 1: ["A"] }), base);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ key: "A", entryDate: dates[2], entryPrice: 102, qty: 98, exitDate: dates[5], exitPrice: 105, reason: "time" });
    expect(r.trades[0].pnl).toBeCloseTo(294, 9);
    expect(r.trades[0].pnlPct).toBeCloseTo(294 / (98 * 102), 12);
    expect(r.days).toHaveLength(8);
    expect(r.days[0].equity).toBe(10000);
    expect(r.days[2]).toMatchObject({ equity: 10000, invested: 98 * 102 }); // cash 4 + 98 x close 102
    expect(r.days[3].equity).toBe(4 + 98 * 103);
    expect(r.days[5]).toMatchObject({ equity: 10294, invested: 0 });
    expect(r.tradedValue).toBe(98 * 102 + 98 * 105);
  });

  it("fills the free slots in the strategy's priority order", () => {
    const r = runEngine([rising("A"), rising("B")], dates, stub({ 1: ["A", "B"] }), base);
    expect(r.trades.map((t) => t.key)).toEqual(["A"]);
  });

  it("never buys a stock twice for a repeated or already-held pick", () => {
    const r = runEngine([rising("A")], dates, stub({ 1: ["A", "A"], 2: ["A"] }), { ...base, maxPositions: 2 });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].qty).toBe(49); // 5000 slot / 102
  });

  it("skips an order the slot cannot afford one share of", () => {
    const r = runEngine([rising("A")], dates, stub({ 1: ["A"] }), { ...base, capital: 50 });
    expect(r.trades).toEqual([]);
    expect(r.days.every((d) => d.equity === 50 && d.invested === 0)).toBe(true);
  });

  it("drops the order when the stock has no bar on the entry day", () => {
    const r = runEngine([rising("A", [2])], dates, stub({ 1: ["A"] }), base);
    expect(r.trades).toEqual([]);
  });

  it("skips a zero or null open and keeps the last good close when a close is missing", () => {
    expect(runEngine([series("A", [100, 101, 0, 103, 104, 105, 106, 107])], dates, stub({ 1: ["A"] }), base).trades).toEqual([]);
    expect(runEngine([series("A", [100, 101, null, 103, 104, 105, 106, 107])], dates, stub({ 1: ["A"] }), base).trades).toEqual([]);
    const r = runEngine([rising("A", [], { 3: { close: null } })], dates, stub({ 1: ["A"] }), base);
    expect(r.days[3].equity).toBe(4 + 98 * 102); // d3 close missing: marked at the d2 close
    expect(r.days.every((d) => Number.isFinite(d.equity))).toBe(true);
  });

  it("closes a position still open on the last date at that close, reason end", () => {
    const r = runEngine([rising("A")], dates, stub({ 1: ["A"] }), { ...base, holdSessions: 100 });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ exitDate: dates[7], exitPrice: 107, reason: "end" });
    expect(r.days[7].invested).toBe(0);
  });
});

describe("runEngine look-ahead guard", () => {
  it("hands the strategy only rows up to the call date, at most lookback of them", () => {
    const calls: { date: string; rows: string[] }[] = [];
    const spy: Strategy = {
      id: "spy", label: "spy", params: {}, lookback: 3,
      pick: (w, date) => { for (const s of w) calls.push({ date, rows: s.days.map((d) => d.date) }); return []; },
    };
    runEngine([rising("A")], dates, spy, base);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.rows.length).toBeLessThanOrEqual(3);
      expect(c.rows[c.rows.length - 1]).toBe(c.date);
      expect(c.rows.every((d) => d <= c.date)).toBe(true);
    }
    expect(calls.find((c) => c.date === dates[5])!.rows).toEqual([dates[3], dates[4], dates[5]]);
  });

  it("leaves a stock without a bar on the call date out of the window", () => {
    const seen: string[][] = [];
    const spy: Strategy = { id: "spy", label: "spy", params: {}, lookback: 1, pick: (w) => { seen.push(w.map((s) => s.key)); return []; } };
    runEngine([rising("A"), rising("B", [4])], dates, spy, base);
    expect(seen[4]).toEqual(["A"]);
    expect(seen[3]).toEqual(["A", "B"]);
  });
});

describe("runEngine costs", () => {
  it("applies slippage and charges on both fills and counts the traded value", () => {
    const r = runEngine([rising("A")], dates, stub({ 1: ["A"] }), { ...base, costs: NSE_COSTS });
    const t = r.trades[0];
    expect(t.qty).toBe(97); // 98 shares would cost 10005.99 before charges
    const buyFill = NSE_COSTS.fill("buy", 102);
    const sellFill = NSE_COSTS.fill("sell", 105);
    const buyValue = 97 * buyFill;
    const sellValue = 97 * sellFill;
    expect(t.entryPrice).toBeCloseTo(buyFill, 10);
    expect(t.exitPrice).toBeCloseTo(sellFill, 10);
    const cash = 10000 - buyValue - NSE_COSTS.charges("buy", buyValue) + sellValue - NSE_COSTS.charges("sell", sellValue);
    expect(r.days[5].equity).toBeCloseTo(cash, 8);
    expect(t.pnl).toBeCloseTo(cash - 10000, 8);
    expect(t.costs).toBeCloseTo(NSE_COSTS.charges("buy", buyValue) + NSE_COSTS.charges("sell", sellValue), 8);
    expect(r.tradedValue).toBeCloseTo(buyValue + sellValue, 8);
  });
});
