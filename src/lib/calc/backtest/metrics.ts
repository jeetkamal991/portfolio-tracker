import type { Trade } from "./engine";

/** Fractions, not percents. Trade figures are null without trades; Sharpe is null on a flat curve. */
export interface Metrics {
  totalReturn: number;
  cagr: number;
  /** Zero or negative. */
  maxDrawdown: number;
  volatility: number;
  /** Annualised, risk-free rate 0. */
  sharpe: number | null;
  hitRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  trades: number;
  turnoverPerYear: number | null;
  timeInvested: number | null;
}

const DAY_MS = 86_400_000;
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const meanOrNull = (v: number[]) => (v.length ? mean(v) : null);

export function computeMetrics(
  days: { date: string; equity: number; invested?: number }[],
  trades: Trade[] = [],
  tradedValue?: number,
): Metrics {
  const first = days[0];
  const last = days[days.length - 1];
  const years = (Date.parse(last.date) - Date.parse(first.date)) / DAY_MS / 365.25;

  const returns = days.slice(1).map((d, i) => d.equity / days[i].equity - 1);
  const m = returns.length ? mean(returns) : 0;
  const sd = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - m) ** 2, 0) / (returns.length - 1)) : 0;

  let peak = first.equity;
  let maxDrawdown = 0;
  for (const d of days) {
    peak = Math.max(peak, d.equity);
    maxDrawdown = Math.min(maxDrawdown, d.equity / peak - 1);
  }

  const totalReturn = last.equity / first.equity - 1;
  const wins = trades.filter((t) => t.pnl > 0).map((t) => t.pnlPct);
  const losses = trades.filter((t) => t.pnl < 0).map((t) => t.pnlPct);
  const allInvested = days.every((d) => d.invested !== undefined);

  return {
    totalReturn,
    cagr: years > 0 ? (last.equity / first.equity) ** (1 / years) - 1 : 0,
    maxDrawdown,
    volatility: sd * Math.sqrt(252),
    sharpe: sd > 0 ? (m / sd) * Math.sqrt(252) : null,
    hitRate: trades.length ? trades.filter((t) => t.pnl > 0).length / trades.length : null,
    avgWinPct: meanOrNull(wins),
    avgLossPct: meanOrNull(losses),
    trades: trades.length,
    turnoverPerYear: tradedValue !== undefined && years > 0 ? tradedValue / years / mean(days.map((d) => d.equity)) : null,
    timeInvested: allInvested ? mean(days.map((d) => (d.invested as number) / d.equity)) : null,
  };
}
