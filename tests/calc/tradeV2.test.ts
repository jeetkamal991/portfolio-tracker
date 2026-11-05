import { describe, expect, it } from "vitest";
import { atrSeries } from "@/lib/calc/atr";
import { tradedValue } from "@/lib/calc/tradedValue";
import { TRADE_WEIGHTS, TRADE_CONFIG as C } from "@/lib/calc/scoreV2/tradeConfig";
import { scoreTradeQuality } from "@/lib/calc/scoreV2/tradeQuality";
import { scoreTechnicalV2, type TechDay } from "@/lib/calc/scoreV2/technical";

const bar = (high: number, low: number, close: number) => ({ high, low, close });

describe("atrSeries (Wilder)", () => {
  // Hand calculation, period 3:
  //  i1 TR=max(2,|11-9|,|9-9|)=2   i2 TR=max(2,2,0)=2   i3 TR=max(3,|13-11|,|10-11|)=3 -> seed ATR=(2+2+3)/3=2.3333
  //  i4 TR=max(3,|12-12|,|9-12|)=3 -> ATR=(2.3333*2+3)/3=2.5556
  const bars = [bar(10, 8, 9), bar(11, 9, 10), bar(12, 10, 11), bar(13, 10, 12), bar(12, 9, 10)];
  it("matches the hand-computed Wilder values", () => {
    const r = atrSeries(bars, 3, 0.3, 5);
    expect(r.series[2]).toBeNull();
    expect(r.series[3]).toBeCloseTo(7 / 3, 6);
    expect(r.series[4]).toBeCloseTo((7 / 3) * (2 / 3) + 1, 6);
    expect(r.atr).toBeCloseTo(2.5556, 4);
    expect(r.atrPct).toBeCloseTo((2.5556 / 10) * 100, 3);
    expect(r.status).toBe("OK");
  });
  it("equals a constant range once warmed up", () => {
    const flat = Array.from({ length: 60 }, () => bar(102, 98, 100));
    expect(atrSeries(flat).atr).toBeCloseTo(4, 9);
  });
  it("reports insufficient history rather than a number", () => {
    const r = atrSeries(Array.from({ length: 33 }, () => bar(102, 98, 100)));
    expect(r.atr).toBeNull();
    expect(r.status).toBe("INSUFFICIENT_HISTORY");
    expect(atrSeries(Array.from({ length: 34 }, () => bar(102, 98, 100))).atr).not.toBeNull();
  });
  it("restarts after a missing bar and after a split-sized jump instead of filling in", () => {
    const ok = Array.from({ length: 40 }, () => bar(102, 98, 100));
    const gap = [...ok, { high: null, low: null, close: null }, ...ok.slice(0, 20)];
    expect(atrSeries(gap).atr).toBeNull(); // only 20 valid candles after the hole
    const split = [...ok, ...Array.from({ length: 40 }, () => bar(51, 49, 50))]; // 2:1 unadjusted
    const r = atrSeries(split);
    expect(r.jumps).toEqual([40]);
    expect(r.atr).toBeCloseTo(2, 6); // computed only on the post-split run, not polluted by a 50-point TR
  });
  it("rejects inconsistent bars (high below low)", () => {
    expect(atrSeries([bar(9, 10, 9.5), ...Array.from({ length: 40 }, () => bar(102, 98, 100))]).atr).toBeCloseTo(4, 9);
  });
});

describe("tradedValue", () => {
  const mk = (n: number, vol: number | null, close = 100) => Array.from({ length: n }, (_, i) => ({ date: `d${i}`, close, volume: vol }));
  it("is close x volume with mean and median over 20 sessions", () => {
    const t = tradedValue(mk(30, 1000));
    expect(t.latest).toBe(100_000);
    expect(t.avg).toBe(100_000);
    expect(t.median).toBe(100_000);
    expect(t.readings).toBe(20);
    expect(t.estimated).toBe(true);
  });
  it("leaves zero or missing volume out instead of averaging a zero", () => {
    const days = mk(20, 1000);
    days[3]!.volume = 0;
    days[4]!.volume = null;
    const t = tradedValue(days);
    expect(t.readings).toBe(18);
    expect(t.missingVolume).toBe(2);
    expect(t.avg).toBe(100_000);
  });
  it("returns nothing when too few sessions have volume", () => {
    const t = tradedValue(mk(20, null));
    expect(t.avg).toBeNull();
    expect(t.median).toBeNull();
  });
  it("scores on a median that ignores a single spike", () => {
    const days = mk(20, 1000);
    days[10]!.volume = 1_000_000;
    const t = tradedValue(days);
    expect(t.median).toBe(100_000);
    expect(t.avg!).toBeGreaterThan(t.median! * 5);
    expect(t.spikes).toEqual(["d10"]);
  });
});

// Mock series for tests only.
function days(n: number, o: Partial<TechDay> & { g?: number; rangePct?: number; volume?: number } = {}): TechDay[] {
  const { g = 0.002, rangePct = 0.02, volume = 5_000_000, ...rest } = o;
  return Array.from({ length: n }, (_, i) => {
    const close = 100 * Math.pow(1 + g, i);
    return {
      date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
      open: close, high: close * (1 + rangePct / 2), low: close * (1 - rangePct / 2), close,
      volume, volAvg20: volume, ema20: close * 0.99, ema50: close * 0.97, ema200: close * 0.9,
      rsi14: 60, macd: 1, macdSignal: 0.5, macdHist: 0.5, patterns: [], ...rest,
    };
  });
}

describe("scoreTradeQuality", () => {
  it("weights total 100 and item maxima match their categories", () => {
    expect(Object.values(TRADE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(C.entry.ema20 + C.entry.ema50 + C.entry.resistanceRoom + C.entry.supportHolding).toBe(TRADE_WEIGHTS.entry);
    expect(C.volatility.atrPct + C.volatility.expansion + C.volatility.stopDistance + C.volatility.gapRisk).toBe(TRADE_WEIGHTS.volatility);
    expect(C.liquidity.value + C.liquidity.steady + C.liquidity.position).toBe(TRADE_WEIGHTS.liquidity);
  });

  it("builds suggested levels: stop is the lower of support and 1.5 ATR, target is the nearest resistance", () => {
    const d = days(300);
    const close = d[d.length - 1]!.close!;
    const r = scoreTradeQuality({ days: d, support: close * 0.99, resistance: close * 1.2 });
    const atr = r.atr.value!;
    expect(r.levels.entry).toBeCloseTo(close, 6);
    expect(r.levels.stop).toBeCloseTo(Math.min(close * 0.99, close - 1.5 * atr), 6);
    expect(r.levels.target).toBeCloseTo(close * 1.2, 6);
    expect(r.levels.rewardRisk).toBeCloseTo((close * 1.2 - close) / (close - r.levels.stop!), 1);
  });

  it("prefers the holder's levels when valid and ignores invalid ones with a flag", () => {
    const d = days(300);
    const close = d[d.length - 1]!.close!;
    const ok = scoreTradeQuality({ days: d, support: null, resistance: null, manualStop: close * 0.95, manualTarget1: close * 1.1 });
    expect(ok.levels.stopSource).toBe("manual");
    expect(ok.levels.targetSource).toBe("manual");
    expect(ok.levels.rewardRisk).toBeCloseTo(2, 1);
    const bad = scoreTradeQuality({ days: d, support: null, resistance: close * 1.1, manualStop: close * 1.05, manualTarget1: close * 0.9 });
    expect(bad.levels.stopSource).toBe("atr");
    expect(bad.levels.targetSource).toBe("resistance");
    expect(bad.flags.join("|")).toMatch(/stop-loss is at or above/);
  });

  it("does not invent a target: breakout territory has no reward-to-risk, is provisional and unrankable", () => {
    const r = scoreTradeQuality({ days: days(300), support: null, resistance: null });
    expect(r.levels.target).toBeNull();
    expect(r.levels.rewardRisk).toBeNull();
    expect(r.observation).toBe("No valid target (breakout territory)");
    expect(r.rankable).toBe(false);
    expect(r.status).toBe("PROVISIONAL");
    expect(r.coverage).toBeLessThan(0.8);
    expect(r.missing.join("|")).toMatch(/Reward-to-risk/);
  });

  it("is fully covered, bounded and rankable with valid levels, and normalises over available points", () => {
    const d = days(300);
    const close = d[d.length - 1]!.close!;
    const r = scoreTradeQuality({ days: d, support: close * 0.97, resistance: close * 1.2 });
    expect(r.status).toBe("COMPLETE");
    expect(r.coverage).toBe(1);
    expect(r.rankable).toBe(true);
    for (const c of r.categories) {
      expect(c.earned).toBeLessThanOrEqual(c.max);
      expect(c.earned).toBeGreaterThanOrEqual(0);
    }
    expect(r.normalised).toBeCloseTo((r.earned / r.available) * 100, 1);
    expect(r.normalised!).toBeLessThanOrEqual(100);
  });

  it("handles insufficient history: ATR items missing, never zero", () => {
    const r = scoreTradeQuality({ days: days(20), support: 90, resistance: 150 });
    expect(r.atr.status).toBe("INSUFFICIENT_HISTORY");
    expect(r.coverage).toBeLessThan(1);
    expect(r.observation).toBe("Insufficient data");
    const vol = r.categories.find((c) => c.key === "volatility")!;
    expect(vol.items.find((x) => x.key === "atrPct")!.status).toBe("missing");
  });

  it("flags illiquid stocks and scores them low on liquidity", () => {
    const d = days(300, { volume: 1000 }); // ~₹1-2L a day
    const r = scoreTradeQuality({ days: d, support: 90, resistance: 400 });
    expect(r.flags.join("|")).toMatch(/Serious liquidity problem/);
    expect(r.categories.find((c) => c.key === "liquidity")!.earned).toBeLessThan(5);
  });

  it("treats missing volume as unavailable liquidity, not zero", () => {
    const r = scoreTradeQuality({ days: days(300, { volume: null as unknown as number }), support: 90, resistance: 400 });
    const liq = r.categories.find((c) => c.key === "liquidity")!;
    expect(liq.available).toBe(0);
    expect(r.coverage).toBeLessThanOrEqual(0.8);
  });

  it("classifies an extended stock as Overextended and a weak technical as such", () => {
    const d = days(300);
    const l = d[d.length - 1]!;
    l.ema20 = l.close! * 0.9; // ~5 ATR above its EMA20
    const close = l.close!;
    expect(scoreTradeQuality({ days: d, support: close * 0.95, resistance: close * 1.3 }).observation).toBe("Overextended");
    const ok = days(300);
    const c = ok[ok.length - 1]!.close!;
    expect(scoreTradeQuality({ days: ok, support: c * 0.97, resistance: c * 1.3, technicalScore: 40 }).observation).toBe("Weak technical setup");
    expect(scoreTradeQuality({ days: ok, support: c * 0.97, resistance: c * 1.3, technicalScore: 70 }).observation).toBe("Favourable setup");
  });

  it("flags an unadjusted split and excludes the jump from the gap measure", () => {
    const pre = days(150, { g: 0 });
    const post = days(150, { g: 0 }).map((x) => ({ ...x, open: 50, high: 51, low: 49, close: 50, date: x.date + "b" }));
    const r = scoreTradeQuality({ days: [...pre, ...post], support: 40, resistance: 80 });
    expect(r.flags.join("|")).toMatch(/over 30%/);
    expect(r.atr.jumps).toHaveLength(1);
  });
});

describe("technical v2 refinements", () => {
  it("groups Market and Sector conditions and keeps a missing sector out of coverage", () => {
    const d = days(300, { g: 0.003 });
    const r = scoreTechnicalV2({ days: d, nifty: d, sector: null, breadthAboveEma200: 0.7, support: null, resistance: null, fiiDelta: 1, diiDelta: 1, delivery: [] });
    const m = r.categories.find((c) => c.key === "market")!;
    expect(m.items.filter((i) => i.group === "Market conditions").map((i) => i.key)).toEqual(["niftyTrend", "breadth"]);
    const sector = m.items.find((i) => i.group === "Sector conditions")!;
    expect(sector.status).toBe("missing");
    expect(sector.points).toBe(0);
    expect(m.available).toBe(7);
    expect(m.coverage).toBeCloseTo(7 / 12, 2);
  });
  it("gives no candlestick points either way when there are fewer than 3 sessions", () => {
    const d = days(2);
    const r = scoreTechnicalV2({ days: d, nifty: d, sector: null, breadthAboveEma200: null, support: null, resistance: null, fiiDelta: null, diiDelta: null, delivery: [] });
    expect(r.categories.find((c) => c.key === "pattern")!.items.find((i) => i.key === "candle")!.status).toBe("missing");
  });
});
