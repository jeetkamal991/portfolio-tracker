import { describe, expect, it } from "vitest";
import type { BacktestRun } from "@/lib/db/types";
import { fmtFrac, fmtRatio, isDisplayable, parseRunId, rebase100 } from "@/lib/view/backtests";

const M = {
  totalReturn: 0.5, cagr: 0.1, maxDrawdown: -0.2, volatility: 0.15, sharpe: 0.8, hitRate: 0.55, avgWinPct: 0.03,
  avgLossPct: -0.02, trades: 10, turnoverPerYear: 8, timeInvested: 0.7,
};
const run = (): BacktestRun => ({
  id: 1, createdAt: "2026-10-27T10:00:00Z", name: "r",
  strategy: { id: "alpha:a101", label: "Alpha", params: {} },
  settings: { capital: 1000000, maxPositions: 10, holdSessions: 5, stopPct: null, from: "2020-01-01", to: "2026-10-27" },
  metrics: { strategy: M, benchmark: M },
  equity: [["2020-01-01", 1000000, 1000000], ["2020-01-02", 1010000, 1005000]],
  trades: [], dataThrough: "2026-10-27", universeNote: "n",
});

describe("fmtFrac", () => {
  it("shows a fraction as a signed one-decimal percent with a true minus", () => {
    expect(fmtFrac(0.123)).toBe("+12.3%");
    expect(fmtFrac(-0.05)).toBe("−5.0%");
    expect(fmtFrac(0)).toBe("0.0%");
    expect(fmtFrac(null)).toBe("—");
  });
});

describe("fmtRatio", () => {
  it("shows two decimals or a dash", () => {
    expect(fmtRatio(1.234)).toBe("1.23");
    expect(fmtRatio(-0.5)).toBe("−0.50");
    expect(fmtRatio(null)).toBe("—");
  });
});

describe("rebase100", () => {
  it("scales both lines so the first point is 100", () => {
    expect(rebase100([["d1", 1000000, 1000000], ["d2", 1100000, 990000]])).toEqual([
      { time: "d1", strategy: 100, benchmark: 100 },
      { time: "d2", strategy: 110, benchmark: 99 },
    ]);
  });
  it("is empty for no points", () => {
    expect(rebase100([])).toEqual([]);
  });
});

describe("isDisplayable", () => {
  it("accepts a well-formed run, including one with no trades", () => {
    expect(isDisplayable(run())).toBe(true);
  });
  it("rejects a run whose saved JSON is missing pieces", () => {
    expect(isDisplayable({ ...run(), metrics: undefined } as unknown as BacktestRun)).toBe(false);
    expect(isDisplayable({ ...run(), equity: "nope" } as unknown as BacktestRun)).toBe(false);
    expect(isDisplayable({ ...run(), equity: [] })).toBe(false);
    expect(isDisplayable({ ...run(), trades: null } as unknown as BacktestRun)).toBe(false);
  });
});

describe("parseRunId", () => {
  it("accepts a plain positive integer", () => {
    expect(parseRunId("7")).toBe(7);
    expect(parseRunId("007")).toBe(7);
  });
  it("rejects anything else, including ids too long for the database", () => {
    for (const bad of ["", "abc", "-1", "1.5", "0", "99999999999999999999", " 3"]) expect(parseRunId(bad)).toBeNull();
  });
});
