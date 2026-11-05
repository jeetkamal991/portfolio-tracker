import { describe, expect, it } from "vitest";
import { TECH_CONFIG as C, TECH_WEIGHTS } from "@/lib/calc/scoreV2/config";
import { scoreTechnicalV2, type TechDay, type TechInput } from "@/lib/calc/scoreV2/technical";

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

// Mock series for tests only: closes grow by `g` per session.
function series(n: number, start: number, g: number, over: Partial<TechDay> = {}): TechDay[] {
  return Array.from({ length: n }, (_, i) => {
    const close = start * Math.pow(1 + g, i);
    return {
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      open: close * 0.995, high: close * 1.01, low: close * 0.985, close,
      volume: 1_500_000, volAvg20: 1_000_000,
      ema20: close * 0.97, ema50: close * 0.94, ema200: close * 0.85,
      rsi14: 62, macd: 2, macdSignal: 1, macdHist: 1, patterns: [], ...over,
    };
  });
}
// EMAs that rise over time (a real uptrend), so slopes are positive.
const rising = (days: TechDay[]) => days.map((d, i) => ({ ...d, ema20: d.close! * 0.97, ema50: d.close! * 0.94, macdHist: 1 + i * 0.01, rsi14: 55 + (i % 20) * 0.5 }));

const base = (days: TechDay[], nifty: TechDay[], over: Partial<TechInput> = {}): TechInput => ({
  days, nifty, sector: nifty, breadthAboveEma200: 0.7, support: null, resistance: null, fiiDelta: 1, diiDelta: 1, delivery: [65, 66, 64], ...over,
});

describe("config", () => {
  it("category weights total 100", () => expect(sum(TECH_WEIGHTS)).toBe(100));
  it("item weights match their category", () => {
    expect(sum(C.trend)).toBe(TECH_WEIGHTS.trend);
    expect(C.momentum.rsiLevel + C.momentum.rsiDirection + C.momentum.macdOverSignal + C.momentum.macdOverZero + C.momentum.histRising).toBe(TECH_WEIGHTS.momentum);
    expect(C.volume.confirmation + C.volume.accumulation).toBe(TECH_WEIGHTS.volume);
    expect(C.pattern.candle + C.pattern.breakout).toBe(TECH_WEIGHTS.pattern);
    expect(C.market.niftyTrend + C.market.sectorTrend + C.market.breadth).toBe(TECH_WEIGHTS.market);
    const r = C.relativeStrength;
    expect(r.vsNifty20 + r.vsNifty60 + r.vsSector20 + r.vsSector60 + r.improving).toBe(TECH_WEIGHTS.relativeStrength);
    expect(C.flows.fii + C.flows.dii + C.flows.delivery).toBe(TECH_WEIGHTS.flows);
  });
});

describe("scoreTechnicalV2", () => {
  const nifty = series(260, 20000, 0.0005);
  const strong = rising(series(260, 100, 0.004));

  it("is deterministic and bounded", () => {
    const a = scoreTechnicalV2(base(strong, nifty));
    expect(scoreTechnicalV2(base(strong, nifty))).toEqual(a);
    for (const c of a.categories) {
      expect(c.earned).toBeGreaterThanOrEqual(0);
      expect(c.earned).toBeLessThanOrEqual(c.max);
      expect(c.available).toBeLessThanOrEqual(c.max);
    }
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });

  it("scores a strong, fully-covered uptrend high and COMPLETE", () => {
    const r = scoreTechnicalV2(base(strong, nifty));
    expect(r.status).toBe("COMPLETE");
    expect(r.coverage).toBe(1);
    expect(r.score!).toBeGreaterThan(80);
  });

  it("scores a downtrend low", () => {
    const weak = series(260, 100, -0.004, { ema20: null, ema50: null, ema200: null, rsi14: 30, macd: -2, macdSignal: -1, macdHist: -1 }).map((d) => ({ ...d, ema20: d.close! * 1.03, ema50: d.close! * 1.06, ema200: d.close! * 1.15 }));
    expect(scoreTechnicalV2(base(weak, nifty, { fiiDelta: -2, diiDelta: -2, delivery: [] })).score!).toBeLessThan(25);
  });

  it("treats missing data as unavailable, not zero", () => {
    const r = scoreTechnicalV2(base(strong, nifty, { fiiDelta: null, sector: null, delivery: [] }));
    expect(r.status).toBe("PROVISIONAL");
    expect(r.available).toBeLessThan(100);
    expect(r.coverage).toBeCloseTo(r.available / 100, 2);
    expect(r.missing.join("\n")).toMatch(/FII stake/);
    // Dropping unscorable items must not drag the normalised score down versus the same stock fully covered.
    const full = scoreTechnicalV2(base(strong, nifty));
    expect(Math.abs(r.score! - full.score!)).toBeLessThan(10);
  });

  it("returns NOT_AVAILABLE with no data at all", () => {
    const r = scoreTechnicalV2({ days: [], nifty: [], sector: null, breadthAboveEma200: null, support: null, resistance: null, fiiDelta: null, diiDelta: null, delivery: [] });
    expect(r.status).toBe("NOT_AVAILABLE");
    expect(r.score).toBeNull();
  });

  it("marks 60-session relative strength missing on short history", () => {
    const short = strong.slice(-40);
    const r = scoreTechnicalV2(base(short, nifty.slice(-40)));
    const rs = r.categories.find((c) => c.key === "relativeStrength")!;
    expect(rs.items.find((i) => i.key === "vsNifty60")!.status).toBe("missing");
    expect(rs.items.find((i) => i.key === "vsNifty20")!.status).toBe("scored");
  });

  it("penalises an overbought RSI without reversing it", () => {
    const at = (rsi: number) => scoreTechnicalV2(base(strong.map((d, i, a) => (i === a.length - 1 ? { ...d, rsi14: rsi } : d)), nifty)).categories.find((c) => c.key === "momentum")!.items.find((i) => i.key === "rsiLevel")!.points;
    expect(at(62)).toBe(C.momentum.rsiLevel);
    expect(at(80)).toBeLessThan(at(62));
    expect(at(80)).toBeGreaterThan(at(35));
  });

  it("does not credit rising price on light volume like heavy volume, and flags selling pressure", () => {
    const vol = (v: number, up: boolean) => {
      const d = strong.map((x) => ({ ...x }));
      const l = d[d.length - 1]!;
      l.volume = v;
      if (!up) l.close = d[d.length - 2]!.close! * 0.98;
      return scoreTechnicalV2(base(d, nifty)).categories.find((c) => c.key === "volume")!.items.find((i) => i.key === "confirmation")!.points;
    };
    expect(vol(2_100_000, true)).toBeGreaterThan(vol(800_000, true));
    expect(vol(2_100_000, false)).toBe(0);
    expect(vol(800_000, false)).toBeGreaterThan(vol(2_100_000, false));
  });

  it("counts the same pattern once across the window", () => {
    const d = strong.map((x) => ({ ...x }));
    for (const k of [1, 2, 3]) d[d.length - k]!.patterns = [{ name: "bullish_engulfing", bias: "bullish" }];
    const once = scoreTechnicalV2(base(d, nifty)).categories.find((c) => c.key === "pattern")!.items.find((i) => i.key === "candle")!.points;
    expect(once).toBe(C.pattern.candleNeutral + C.pattern.hitStep);
  });

  it("breakout needs volume to be confirmed", () => {
    const d = strong.map((x) => ({ ...x }));
    const l = d[d.length - 1]!;
    l.close = Math.max(...d.slice(-21, -1).map((x) => x.high!)) * 1.02;
    const pts = (rvol: number) => { l.volume = rvol * 1_000_000; return scoreTechnicalV2(base(d, nifty)).categories.find((c) => c.key === "pattern")!.items.find((i) => i.key === "breakout")!.points; };
    expect(pts(2)).toBe(C.pattern.breakout);
    expect(pts(0.8)).toBeLessThan(pts(2));
  });
});
