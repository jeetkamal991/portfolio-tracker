import { describe, expect, it } from "vitest";
import type { Trade } from "@/lib/calc/backtest/engine";
import { computeMetrics } from "@/lib/calc/backtest/metrics";

const curve = (equity: number[]) => equity.map((e, i) => ({ date: `2026-01-0${i + 1}`, equity: e }));
const trade = (pnl: number, pnlPct: number): Trade => ({
  key: "A", name: "A", entryDate: "2026-01-01", exitDate: "2026-01-02", qty: 1, entryPrice: 100, exitPrice: 100 + pnl,
  pnl, pnlPct, costs: 0, reason: "time",
});

describe("computeMetrics curve figures", () => {
  it("return, drawdown and Sharpe on a known curve", () => {
    const m = computeMetrics(curve([100, 110, 99, 121]));
    expect(m.totalReturn).toBeCloseTo(0.21, 12);
    expect(m.maxDrawdown).toBeCloseTo(-0.1, 12); // 110 down to 99
    // daily returns 0.1, -0.1, 0.2222: mean 0.07407, sample sd 0.16267, x sqrt(252)
    expect(m.sharpe).toBeCloseTo(7.229, 2);
    expect(m.volatility).toBeCloseTo(0.16267 * Math.sqrt(252), 3);
  });

  it("CAGR uses calendar days over 365.25", () => {
    const m = computeMetrics([{ date: "2025-01-01", equity: 100 }, { date: "2026-01-01", equity: 121 }]);
    expect(m.cagr).toBeCloseTo(1.21 ** (365.25 / 365) - 1, 12);
  });

  it("a flat curve has no Sharpe, no volatility and no drawdown", () => {
    const m = computeMetrics(curve([100, 100, 100]));
    expect(m.sharpe).toBeNull();
    expect(m.volatility).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.totalReturn).toBe(0);
  });

  it("turnover is traded value per year over average equity, time invested the mean invested share", () => {
    const m = computeMetrics(
      [{ date: "2025-01-01", equity: 100, invested: 50 }, { date: "2026-01-01", equity: 100, invested: 50 }],
      [],
      400,
    );
    expect(m.turnoverPerYear).toBeCloseTo(400 / (365 / 365.25) / 100, 9);
    expect(m.timeInvested).toBeCloseTo(0.5, 12);
  });

  it("leaves turnover and time invested null when they were not supplied", () => {
    const m = computeMetrics(curve([100, 101]));
    expect([m.turnoverPerYear, m.timeInvested]).toEqual([null, null]);
  });
});

describe("computeMetrics trade figures", () => {
  it("hit rate and average win and loss", () => {
    const m = computeMetrics(curve([100, 101]), [trade(100, 0.1), trade(-50, -0.05), trade(25, 0.02)]);
    expect(m.trades).toBe(3);
    expect(m.hitRate).toBeCloseTo(2 / 3, 12);
    expect(m.avgWinPct).toBeCloseTo(0.06, 12);
    expect(m.avgLossPct).toBeCloseTo(-0.05, 12);
  });

  it("a run with no trades has null trade figures and no NaN anywhere", () => {
    const m = computeMetrics(curve([100, 100, 100]), [], 0);
    expect(m.trades).toBe(0);
    expect([m.hitRate, m.avgWinPct, m.avgLossPct]).toEqual([null, null, null]);
    for (const v of Object.values(m)) expect(v === null || Number.isFinite(v)).toBe(true);
  });

  it("only wins gives a null average loss", () => {
    const m = computeMetrics(curve([100, 101]), [trade(10, 0.1)]);
    expect(m.hitRate).toBe(1);
    expect(m.avgLossPct).toBeNull();
  });
});
