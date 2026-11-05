import { describe, expect, it } from "vitest";
import { BACKTEST_CONFIG, forwardOutcome, summarize, type Bar, type Outcome } from "@/lib/calc/backtest/forward";
import { EVENT_RISK_STATUS, fundamentalQuality } from "@/lib/calc/scoreV2/fundamental";

const bar = (date: string, open: number, high: number, low: number, close: number): Bar => ({ date, open, high, low, close });
// Mock bars for tests only. Evaluation date 2026-01-01 closes at 100; the next session is the entry.
const bars: Bar[] = [
  bar("2026-01-01", 99, 101, 98, 100),
  bar("2026-01-02", 101, 103, 100, 102),
  bar("2026-01-05", 102, 106, 101, 105),
  bar("2026-01-06", 105, 110, 104, 108),
  bar("2026-01-07", 108, 109, 106, 107),
  bar("2026-01-08", 107, 108, 105, 106),
];

describe("forwardOutcome", () => {
  it("enters at the NEXT session's open plus slippage (never the evaluation-day close) and charges costs", () => {
    const o = forwardOutcome(bars, "2026-01-01");
    expect(o.entryDate).toBe("2026-01-02");
    expect(o.entryPrice).toBeCloseTo(101.101, 6); // 101 x 1.001
    // 5th session close 106 less 10 bps slippage, over entry, less 25 bps costs. Computed by hand.
    expect(o.returns[5]).toBeCloseTo(0.0449080375, 8);
    expect(o.returns[10]).toBeNull(); // the future has not happened yet: unavailable, never zero
    expect(o.returns[20]).toBeNull();
  });
  it("measures excursions and thresholds from the entry", () => {
    const o = forwardOutcome(bars, "2026-01-01");
    expect(o.mfe).toBeCloseTo(110 / 101.101 - 1, 8); // best high 110
    expect(o.mae).toBeCloseTo(100 / 101.101 - 1, 8); // worst low 100
    expect(o.reached).toEqual({ "0.03": true, "0.05": true, "0.1": false });
  });
  it("does not look ahead: a snapshot on the last bar has no outcome", () => {
    const o = forwardOutcome(bars, "2026-01-08");
    expect(o.entryPrice).toBeNull();
    expect(o.returns[5]).toBeNull();
  });
  it("assumes the stop fills first when stop and target sit inside one bar", () => {
    const wide = [bar("2026-01-01", 100, 100, 100, 100), bar("2026-01-02", 100, 120, 80, 100)];
    const o = forwardOutcome(wide, "2026-01-01", { stop: 90, target: 115 });
    expect(o).toMatchObject({ stopFirst: true, targetFirst: false });
  });
  it("detects target-first and neither", () => {
    expect(forwardOutcome(bars, "2026-01-01", { stop: 90, target: 109 })).toMatchObject({ stopFirst: false, targetFirst: true });
    expect(forwardOutcome(bars, "2026-01-01", { stop: 50, target: 500 })).toMatchObject({ stopFirst: false, targetFirst: false });
  });
  it("compares with the benchmark over the same sessions", () => {
    const nifty = [bar("2026-01-01", 0, 0, 0, 1000), bar("2026-01-02", 0, 0, 0, 1010), bar("2026-01-05", 0, 0, 0, 1020), bar("2026-01-06", 0, 0, 0, 1030), bar("2026-01-07", 0, 0, 0, 1040), bar("2026-01-08", 0, 0, 0, 1050)];
    expect(forwardOutcome(bars, "2026-01-01", { benchmark: nifty }).benchmark[5]).toBeCloseTo(0.05, 10);
  });
});

describe("summarize", () => {
  const out = (r: number): Outcome => ({ evaluationDate: "d", entryDate: "e", entryPrice: 100, returns: { 5: r, 10: r, 20: r }, benchmark: { 5: 0.01, 10: 0.01, 20: 0.01 }, mfe: 0.06, mae: -0.02, reached: { "0.03": true, "0.05": true, "0.1": false }, stopFirst: false, targetFirst: false, sessions: 20 });
  it("reports no rates and says so below the minimum sample", () => {
    const s = summarize(Array.from({ length: BACKTEST_CONFIG.minSample - 1 }, () => out(0.05)));
    expect(s.status).toBe("INSUFFICIENT SAMPLE");
    expect(s.byHorizon[5]).toBeNull();
    expect(s.reachedShare).toBeNull();
    expect(s.note).toMatch(/not evidence of profitability/);
  });
  it("is descriptive only at the minimum sample, never a profitability claim", () => {
    const outcomes = Array.from({ length: 100 }, (_, i) => out(i % 2 ? 0.05 : -0.02));
    const s = summarize(outcomes);
    expect(s.status).toBe("DESCRIPTIVE ONLY");
    expect(s.byHorizon[5]!.winRate).toBe(0.5);
    expect(s.byHorizon[5]!.avgExcessVsBenchmark).toBeCloseTo(0.015 - 0.01, 10);
    expect(s.note).toMatch(/survivorship/);
  });
  it("ignores snapshots with no entry yet", () => {
    expect(summarize([{ ...out(0.1), entryPrice: null }]).n).toBe(0);
  });
});

describe("fundamental and event placeholders", () => {
  it("fundamental quality is NOT AVAILABLE, never zero", () => {
    expect(fundamentalQuality(null)).toMatchObject({ status: "NOT AVAILABLE", score: null });
  });
  it("event risk is unknown, not 'no risk'", () => {
    expect(EVENT_RISK_STATUS).toBe("UNKNOWN / NOT AVAILABLE");
  });
});
