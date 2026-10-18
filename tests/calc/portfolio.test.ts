import { describe, it, expect } from "vitest";
import {
  holdingMetrics,
  holdingStatus,
  portfolioTotals,
  mergeHolding,
  validateHoldingInput,
  type HoldingInput,
  type HoldingMetrics,
} from "@/lib/calc/portfolio";

const TODAY = "2026-10-18";
const base: HoldingInput = { qty: 10, avgPrice: 100, buyDate: "2026-01-10", stopLoss: null, target1: null, target2: null };

describe("holdingMetrics", () => {
  it("computes value, pnl and day pnl from the previous close", () => {
    const m = holdingMetrics(base, 110, 0.1, TODAY);
    expect(m.invested).toBe(1000);
    expect(m.value).toBeCloseTo(1100);
    expect(m.pnl).toBeCloseTo(100);
    expect(m.pnlPct).toBeCloseTo(0.1);
    expect(m.dayPnl).toBeCloseTo(100); // prevClose 100
  });

  it("uses avgPrice as the base for day pnl when bought today", () => {
    expect(holdingMetrics({ ...base, buyDate: TODAY }, 110, 0.1, TODAY).dayPnl).toBeCloseTo(100);
    expect(holdingMetrics({ ...base, buyDate: TODAY, avgPrice: 105 }, 110, 0.1, TODAY).dayPnl).toBeCloseTo(50);
  });

  it("returns nulls without a CMP but keeps invested", () => {
    const m = holdingMetrics(base, null, null, TODAY);
    expect(m).toEqual({ invested: 1000, value: null, pnl: null, pnlPct: null, dayPnl: null, status: null });
  });

  it("day pnl is null when dayPct is null and bought earlier", () => {
    expect(holdingMetrics(base, 110, null, TODAY).dayPnl).toBeNull();
  });

  it("includes status from SL/T1", () => {
    expect(holdingMetrics({ ...base, stopLoss: 95 }, 95, 0, TODAY).status).toBe("SL_HIT");
  });
});

describe("holdingStatus", () => {
  it("SL rules", () => {
    expect(holdingStatus(95, 95, null)).toBe("SL_HIT");
    expect(holdingStatus(96.9, 95, null)).toBe("NEAR_SL");
    expect(holdingStatus(97, 95, null)).toBe("OK");
  });
  it("target rules", () => {
    expect(holdingStatus(120, null, 120)).toBe("TARGET_HIT");
    expect(holdingStatus(117.7, null, 120)).toBe("NEAR_TARGET");
  });
  it("precedence and empty", () => {
    expect(holdingStatus(96, 95, 120)).toBe("NEAR_SL");
    expect(holdingStatus(94, 95, 120)).toBe("SL_HIT");
    expect(holdingStatus(100, null, null)).toBe("OK");
  });
});

describe("portfolioTotals", () => {
  const row = (invested: number, value: number | null, pnl: number | null, dayPnl: number | null): HoldingMetrics & { hasPrice: boolean } => ({
    invested, value, pnl, pnlPct: null, dayPnl, status: null, hasPrice: value !== null,
  });
  it("sums priced rows and counts unpriced", () => {
    const t = portfolioTotals([row(1000, 1100, 100, 20), row(500, 450, -50, null), row(300, null, null, null)]);
    expect(t.invested).toBe(1500);
    expect(t.value).toBe(1550);
    expect(t.pnl).toBe(50);
    expect(t.pnlPct).toBeCloseTo(50 / 1500);
    expect(t.todayPnl).toBe(20);
    expect(t.count).toBe(3);
    expect(t.unpriced).toBe(1);
  });
  it("pnlPct null when nothing invested", () => {
    expect(portfolioTotals([row(0, 0, 0, null)]).pnlPct).toBeNull();
    expect(portfolioTotals([]).pnlPct).toBeNull();
  });
});

describe("mergeHolding", () => {
  it("weights the average and keeps the earlier date", () => {
    const a: HoldingInput = { qty: 10, avgPrice: 100, buyDate: "2026-01-10", stopLoss: 90, target1: null, target2: null };
    const b: HoldingInput = { qty: 5, avgPrice: 130, buyDate: "2026-03-01", stopLoss: null, target1: 150, target2: null };
    expect(mergeHolding(a, b)).toEqual({ qty: 15, avgPrice: 110, buyDate: "2026-01-10", stopLoss: 90, target1: 150, target2: null });
  });
  it("does not round the average", () => {
    const a = { ...base, qty: 3, avgPrice: 101.35 };
    const b = { ...base, qty: 7, avgPrice: 99.1 };
    expect(mergeHolding(a, b).avgPrice).toBeCloseTo(99.775, 10);
  });
  it("incoming values override when given", () => {
    const a = { ...base, stopLoss: 90 };
    expect(mergeHolding(a, { ...base, stopLoss: 92 }).stopLoss).toBe(92);
  });
});

describe("validateHoldingInput", () => {
  const ctx = { today: TODAY, cmp: 100 };
  const good = { qty: 10, avgPrice: 100, buyDate: "2026-01-10", stopLoss: "", target1: null, target2: undefined };
  it("accepts valid input; empty optionals become null", () => {
    const r = validateHoldingInput(good, ctx);
    expect(r).toEqual({ ok: true, value: { ...base }, warnings: [] });
  });
  it("accepts numeric strings", () => {
    const r = validateHoldingInput({ ...good, qty: "10", avgPrice: "100" }, ctx);
    expect(r.ok).toBe(true);
  });
  it("rejects fractional qty", () => {
    const r = validateHoldingInput({ ...good, qty: 2.5 }, ctx);
    expect(r).toEqual({ ok: false, errors: { qty: "Enter a whole number above 0" } });
  });
  it("rejects bad price, future and ancient dates, bad optionals", () => {
    const r = validateHoldingInput({ ...good, avgPrice: 0, buyDate: "2026-10-19", stopLoss: -1 }, ctx);
    expect(r).toEqual({
      ok: false,
      errors: { avgPrice: "Enter a price above 0", buyDate: "Buy date can't be in the future", stopLoss: "Enter a price above 0, or leave empty" },
    });
    const old = validateHoldingInput({ ...good, buyDate: "1999-12-31" }, ctx);
    expect(old.ok).toBe(false);
    const junk = validateHoldingInput({ ...good, buyDate: "nope", qty: "abc" }, ctx);
    expect(junk.ok).toBe(false);
  });
  it("warns without blocking", () => {
    const sl = validateHoldingInput({ ...good, stopLoss: 120 }, ctx);
    expect(sl.ok && sl.warnings).toEqual(["Stop loss is at or above your buy price"]);
    const t1 = validateHoldingInput({ ...good, target1: 90 }, ctx);
    expect(t1.ok && t1.warnings).toEqual(["Target 1 is already below the current price"]);
    const t2 = validateHoldingInput({ ...good, target1: 120, target2: 110 }, ctx);
    expect(t2.ok && t2.warnings).toEqual(["Target 2 should be above Target 1"]);
  });
});
