import type { OhlcvDay } from "@/lib/db/types";
import type { CostModel } from "./costs";
import type { StockSeries, Strategy } from "./strategy";

export interface EngineSettings {
  capital: number;
  maxPositions: number;
  holdSessions: number;
  stopPct: number | null;
  costs: CostModel;
}

export interface Trade {
  key: string;
  name: string;
  entryDate: string;
  exitDate: string;
  qty: number;
  /** Fill prices, slippage included. */
  entryPrice: number;
  exitPrice: number;
  /** After all charges. */
  pnl: number;
  pnlPct: number;
  costs: number;
  reason: "time" | "stop" | "end" | "delisted";
}

export interface DayPoint {
  date: string;
  equity: number;
  invested: number;
}

export interface EngineResult {
  days: DayPoint[];
  trades: Trade[];
  /** Buy plus sell notional. */
  tradedValue: number;
}

interface Position {
  key: string;
  name: string;
  qty: number;
  entryIdx: number;
  entryDate: string;
  entryPrice: number;
  entryCost: number;
  lastClose: number;
}

const usable = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0;

/**
 * Walks the calendar. A pick made on the close of day t is bought at the open of t+1; a position is sold at the open
 * H sessions after its entry. The strategy only ever sees the last `lookback` rows ending on t.
 */
export function runEngine<D extends OhlcvDay>(
  stocks: StockSeries<D>[],
  calendar: string[],
  strategy: Strategy<D>,
  s: EngineSettings,
): EngineResult {
  const byKey = new Map(stocks.map((st) => [st.key, st]));
  const barOf = new Map(stocks.map((st) => [st.key, new Map(st.days.map((d) => [d.date, d]))]));
  const upTo = new Map(stocks.map((st) => [st.key, 0])); // rows dated <= today, advanced as the calendar moves

  const positions = new Map<string, Position>();
  const trades: Trade[] = [];
  const days: DayPoint[] = [];
  let cash = s.capital;
  let equity = s.capital;
  let tradedValue = 0;
  let pending: string[] = [];

  function sell(p: Position, raw: number, date: string, reason: Trade["reason"]) {
    const fill = s.costs.fill("sell", raw);
    const value = p.qty * fill;
    const charges = s.costs.charges("sell", value);
    cash += value - charges;
    tradedValue += value;
    const pnl = value - charges - p.qty * p.entryPrice - p.entryCost;
    trades.push({
      key: p.key, name: p.name, entryDate: p.entryDate, exitDate: date, qty: p.qty,
      entryPrice: p.entryPrice, exitPrice: fill, pnl, pnlPct: pnl / (p.qty * p.entryPrice),
      costs: p.entryCost + charges, reason,
    });
    positions.delete(p.key);
  }

  calendar.forEach((date, i) => {
    const bar = (key: string) => barOf.get(key)?.get(date);

    // time exits at the open; a due position with no usable bar today waits for the next one
    for (const p of [...positions.values()]) {
      const b = bar(p.key);
      if (i - p.entryIdx >= s.holdSessions && usable(b?.open)) sell(p, b.open, date, "time");
    }

    // entries chosen on the previous close, at today's open
    const slot = equity / s.maxPositions;
    const tried = new Set<string>();
    for (const key of pending) {
      if (positions.size >= s.maxPositions) break;
      if (positions.has(key) || tried.has(key)) continue;
      tried.add(key);
      const b = bar(key);
      if (!usable(b?.open)) continue;
      const fill = s.costs.fill("buy", b.open);
      const budget = Math.min(slot, cash);
      let qty = Math.floor(budget / fill);
      while (qty > 0 && qty * fill + s.costs.charges("buy", qty * fill) > budget) qty--;
      if (qty < 1) continue;
      const value = qty * fill;
      const charges = s.costs.charges("buy", value);
      cash -= value + charges;
      tradedValue += value;
      positions.set(key, {
        key, name: byKey.get(key)!.name, qty, entryIdx: i, entryDate: date, entryPrice: fill, entryCost: charges, lastClose: fill,
      });
    }

    // mark to the close; a missing close keeps the last good one
    let invested = 0;
    for (const p of positions.values()) {
      const c = bar(p.key)?.close;
      if (usable(c)) p.lastClose = c;
      invested += p.qty * p.lastClose;
    }
    if (i === calendar.length - 1) {
      for (const p of [...positions.values()]) sell(p, p.lastClose, date, "end");
      invested = 0;
    }
    equity = cash + invested;
    days.push({ date, equity, invested });

    // what to buy tomorrow
    pending = [];
    if (i < calendar.length - 1) {
      const window: StockSeries<D>[] = [];
      for (const st of stocks) {
        let p = upTo.get(st.key)!;
        while (p < st.days.length && st.days[p].date <= date) p++;
        upTo.set(st.key, p);
        if (p > 0 && st.days[p - 1].date === date) {
          window.push({ key: st.key, name: st.name, days: st.days.slice(Math.max(0, p - strategy.lookback), p) });
        }
      }
      pending = strategy.pick(window, date, s.maxPositions);
    }
  });

  return { days, trades, tradedValue };
}
