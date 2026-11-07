import { describe, expect, it } from "vitest";
import { computeStage, type StageDay } from "@/lib/calc/stage";

// Week w starts on a Monday: 2024-01-01 + 7w days. Each week has 5 sessions (Mon-Fri).
const START = Date.UTC(2024, 0, 1);
const iso = (offsetDays: number) => new Date(START + offsetDays * 86_400_000).toISOString().slice(0, 10);
interface Wk { close: number; high?: number; low?: number; vol?: number }

function build(weeks: Wk[], sessionsInLast = 5): StageDay[] {
  return weeks.flatMap((w, i) => {
    const n = i === weeks.length - 1 ? sessionsInLast : 5;
    return Array.from({ length: n }, (_, d) => ({
      date: iso(i * 7 + d), close: w.close, high: w.high ?? w.close, low: w.low ?? w.close, volume: w.vol ?? 1000,
    }));
  });
}
const mondayAfter = (weeks: number) => iso(weeks * 7); // first day after `weeks` full weeks
const grow = (n: number, from: number, rate: number): Wk[] => Array.from({ length: n }, (_, i) => ({ close: from * (1 + rate) ** i }));
const flat = (n: number, price: number): Wk[] => Array.from({ length: n }, () => ({ close: price }));

describe("computeStage", () => {
  it("needs 34 completed weeks", () => {
    const r = computeStage(build(grow(33, 100, 0.01)), mondayAfter(33));
    expect(r).toMatchObject({ stage: null, freshBreakout: false, ma30: null, slope: null });
    expect(computeStage(build(grow(34, 100, 0.01)), mondayAfter(34)).stage).toBe(2);
  });

  it("steady uptrend is stage 2, counting the weeks since it began", () => {
    const r = computeStage(build(grow(50, 100, 0.01)), mondayAfter(50));
    expect(r.stage).toBe(2);
    expect(r.weeksInStage).toBe(17); // weeks 33..49 are the first computable stage
    expect(r.slope!).toBeGreaterThan(0.01);
    expect(r.ma30!).toBeGreaterThan(0);
  });

  it("steady downtrend is stage 4", () => {
    expect(computeStage(build(grow(50, 200, -0.01)), mondayAfter(50)).stage).toBe(4);
  });

  it("flat after a decline is stage 1, flat after a rise is stage 3", () => {
    const after = computeStage(build([...grow(40, 200, -0.0173), ...flat(30, 100)]), mondayAfter(70));
    expect(after.stage).toBe(1);
    const top = computeStage(build([...grow(40, 100, 0.0173), ...flat(30, 200)]), mondayAfter(70));
    expect(top.stage).toBe(3);
  });

  it("uses completed weeks only: a part week counts once the next week has started or it ends on a Friday", () => {
    const full = grow(40, 100, 0.01);
    const crash = [...full, { close: 10 }];
    const partial = build(crash, 3); // Mon-Wed of week 41
    const base = computeStage(build(full), mondayAfter(40));
    // still inside that week: the crash is ignored
    expect(computeStage(partial, iso(40 * 7 + 2))).toEqual(base);
    // a later week has begun: the part week is final
    expect(computeStage(partial, iso(41 * 7))!.ma30).not.toBe(base.ma30);
    // a week whose last stored session is a Friday counts at once
    expect(computeStage(build(crash), iso(40 * 7 + 4)).ma30).not.toBe(base.ma30);
  });

  it("takes each week's close from its last session, and skips unpriced days", () => {
    const days = build(grow(34, 100, 0.01));
    const last = days.length - 1;
    const noisy = days.map((d, i) => (i === last - 1 ? { ...d, close: 1 } : d)); // Thursday of the last week
    expect(computeStage(noisy, mondayAfter(34))).toEqual(computeStage(days, mondayAfter(34)));
    const gaps = days.map((d, i) => (i % 7 === 0 ? { ...d, close: null } : d));
    expect(computeStage(gaps, mondayAfter(34)).stage).toBe(2);
  });

  describe("fresh breakout", () => {
    // 40 rising weeks, a 12-week base around 100 (highs 103, lows 97), then a breakout week.
    const uptrend = (): Wk[] => Array.from({ length: 40 }, (_, i) => ({ close: 60 + i, high: 61 + i, low: 59 + i }));
    const base = (): Wk[] => Array.from({ length: 12 }, (_, i) => ({ close: i % 2 ? 102 : 98, high: 103, low: 97 }));
    const run = (breakout: Wk, after = 0) => {
      const weeks = [...uptrend(), ...base(), breakout, ...flat(after, breakout.close)];
      return computeStage(build(weeks), mondayAfter(weeks.length));
    };

    it("flags a close above the base high on 2x volume, not more than 8% above it", () => {
      const r = run({ close: 106, high: 107, low: 100, vol: 3000 });
      expect(r).toMatchObject({ stage: 2, freshBreakout: true, baseHigh: 103 });
    });
    it("needs the volume, and stays inside the 8% extension limit", () => {
      expect(run({ close: 106, high: 107, low: 100, vol: 1500 }).freshBreakout).toBe(false);
      expect(run({ close: 115, high: 116, low: 100, vol: 3000 }).freshBreakout).toBe(false);
    });
    it("is not fresh once the breakout is more than 4 weeks old", () => {
      expect(run({ close: 106, high: 107, low: 100, vol: 3000 }, 3).freshBreakout).toBe(true);
      expect(run({ close: 106, high: 107, low: 100, vol: 3000 }, 4).freshBreakout).toBe(false);
    });
    it("is only for stage 2", () => {
      const weeks = [...grow(40, 200, -0.01), ...base(), { close: 150, high: 151, low: 100, vol: 3000 }];
      const r = computeStage(build(weeks), mondayAfter(weeks.length));
      expect(r.stage).not.toBe(2);
      expect(r.freshBreakout).toBe(false);
    });
  });
});
