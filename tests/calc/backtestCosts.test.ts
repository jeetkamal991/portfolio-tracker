import { describe, expect, it } from "vitest";
import { NSE_COSTS, ZERO_COSTS } from "@/lib/calc/backtest/costs";

describe("NSE_COSTS.fill", () => {
  it("moves the price 0.1% against the trader", () => {
    expect(NSE_COSTS.fill("buy", 100)).toBeCloseTo(100.1, 10);
    expect(NSE_COSTS.fill("sell", 100)).toBeCloseTo(99.9, 10);
  });
});

describe("NSE_COSTS.charges", () => {
  // buy 100000: STT 100 + exchange 2.97 + SEBI 0.10 + stamp 15 + GST 18% of (2.97 + 0.10) = 0.5526
  it("adds every charge line for a buy, including stamp duty", () => {
    expect(NSE_COSTS.charges("buy", 100000)).toBeCloseTo(118.6226, 6);
  });
  it("leaves out stamp duty on a sell", () => {
    expect(NSE_COSTS.charges("sell", 100000)).toBeCloseTo(103.6226, 6);
  });
  it("is 0 for a zero-value trade", () => {
    expect(NSE_COSTS.charges("buy", 0)).toBe(0);
  });
});

describe("ZERO_COSTS", () => {
  it("fills at the price and charges nothing", () => {
    expect(ZERO_COSTS.fill("buy", 123.4)).toBe(123.4);
    expect(ZERO_COSTS.fill("sell", 123.4)).toBe(123.4);
    expect(ZERO_COSTS.charges("buy", 100000)).toBe(0);
  });
});
