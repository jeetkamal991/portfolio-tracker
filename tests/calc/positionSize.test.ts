import { describe, expect, it } from "vitest";
import { positionSize, type PositionInput } from "@/lib/calc/positionSize";

const base: PositionInput = { equity: 1_000_000, riskPct: 1, entry: 500, stop: 480, maxAllocationPct: 20 };
const ok = (i: PositionInput) => {
  const r = positionSize(i);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe("positionSize", () => {
  it("risk amount / risk per share, rounded down", () => {
    const r = ok(base); // risk 10,000 / 20 per share = 500 shares; allocation cap 200,000 / 500 = 400
    expect(r.riskAmount).toBe(10_000);
    expect(r.riskPerShare).toBe(20);
    expect(r.quantity).toBe(400);
    expect(r.limitedBy).toBe("allocation");
  });
  it("is limited by risk when the allocation cap is looser", () => {
    const r = ok({ ...base, maxAllocationPct: 50 });
    expect(r.quantity).toBe(500);
    expect(r.limitedBy).toBe("risk");
    expect(r.maxLoss).toBe(10_000);
    expect(r.riskPctOfEquity).toBe(1);
    expect(r.capitalRequired).toBe(250_000);
    expect(r.capitalPctOfEquity).toBe(25);
  });
  it("never rounds up: the loss at the stop stays at or below the risk budget", () => {
    const r = ok({ equity: 100_000, riskPct: 1, entry: 333.33, stop: 320, maxAllocationPct: 100 });
    expect(r.quantity).toBe(Math.floor(1000 / 13.33));
    expect(r.maxLoss).toBeLessThanOrEqual(1000);
  });
  it("does not lose a share to float error on an exact multiple", () => {
    expect(ok({ equity: 100_000, riskPct: 1, entry: 10.3, stop: 10.1, maxAllocationPct: 100 }).quantity).toBe(5000);
  });
  it("rounds down to whole lots and says so", () => {
    const r = ok({ equity: 1_000_000, riskPct: 1, entry: 500, stop: 480, maxAllocationPct: 100, lotSize: 175 });
    expect(r.quantity).toBe(350); // 500 shares by risk -> 2 lots of 175
    expect(r.lots).toBe(2);
    expect(r.limitedBy).toBe("lot size");
  });
  it("rejects a stop at or above the entry", () => {
    for (const stop of [500, 510]) {
      const r = positionSize({ ...base, stop });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.stop).toMatch(/below the entry/);
    }
  });
  it("rejects missing, zero, negative and non-finite inputs and sizes nothing", () => {
    for (const bad of [0, -5, NaN, Infinity, undefined as unknown as number]) {
      expect(positionSize({ ...base, entry: bad }).ok).toBe(false);
      expect(positionSize({ ...base, stop: bad }).ok).toBe(false);
      expect(positionSize({ ...base, equity: bad }).ok).toBe(false);
      expect(positionSize({ ...base, riskPct: bad }).ok).toBe(false);
    }
    expect(positionSize({ ...base, riskPct: 101 }).ok).toBe(false);
    expect(positionSize({ ...base, maxAllocationPct: 0 }).ok).toBe(false);
    expect(positionSize({ ...base, lotSize: 0 }).ok).toBe(false);
    expect(positionSize({ ...base, lotSize: 1.5 }).ok).toBe(false);
  });
  it("refuses when not even one share or lot fits, naming the limits", () => {
    const tiny = positionSize({ equity: 10_000, riskPct: 1, entry: 5000, stop: 4000, maxAllocationPct: 20 });
    expect(tiny.ok).toBe(false);
    if (!tiny.ok) expect(tiny.errors.quantity).toMatch(/Not even one share/);
    const lots = positionSize({ equity: 1_000_000, riskPct: 1, entry: 500, stop: 480, maxAllocationPct: 100, lotSize: 600 });
    expect(lots.ok).toBe(false);
    if (!lots.ok) expect(lots.errors.quantity).toMatch(/one lot \(600 shares\)/);
  });
  it("enforces the allocation cap even when risk would allow more", () => {
    const r = ok({ equity: 1_000_000, riskPct: 5, entry: 100, stop: 99, maxAllocationPct: 10 });
    expect(r.capitalRequired).toBeLessThanOrEqual(100_000);
    expect(r.quantity).toBe(1000);
    expect(r.warnings.join(" ")).toMatch(/limited by the maximum allocation/);
  });
  it("warns above the risk warning level without blocking, and always lists assumptions", () => {
    const r = ok({ ...base, riskPct: 6 });
    expect(r.warnings.join(" ")).toMatch(/6% of equity/);
    expect(r.assumptions.join(" ")).toMatch(/Gaps, slippage/);
  });
});
