import { describe, expect, it } from "vitest";
import {
  confidenceFor,
  labelFor,
  scoreInstrument,
  type ScoreComponents,
  type ScoreInput,
  type ScoreLabel,
} from "@/lib/calc/score";

const base: ScoreInput = {
  kind: "stock",
  close: 100,
  prevClose: 100,
  ema20: 100,
  ema50: 100,
  ema200: 100,
  rsi14: 50,
  macd: 0,
  macdSignal: 0,
  macdHist: 0,
  prevMacdHist: 0,
  volume: 100,
  volAvg20: 100,
  recentPatterns: [],
  niftyLabel: "Neutral",
  sectorLabel: "Neutral",
  rs20: 0,
  support: null,
  resistance: null,
};
const make = (o: Partial<ScoreInput>): ScoreInput => ({ ...base, ...o });
const comp = (o: Partial<ScoreInput>) => scoreInstrument(make(o)).components;

describe("Trend", () => {
  const rows: [string, Partial<ScoreInput>, number, boolean][] = [
    ["above all three, 20>50>200", { ema20: 90, ema50: 80, ema200: 70 }, 20, false],
    ["above all three, fully inverted stack", { ema20: 80, ema50: 85, ema200: 90 }, 12, false],
    ["below all three, exactly two orders", { ema20: 130, ema50: 110, ema200: 120 }, 4, false],
    ["ema200 null: stack 4, above-200 2", { ema20: 90, ema50: 80, ema200: null }, 14, true],
  ];
  it.each(rows)("%s", (_n, o, trend, partial) => {
    const r = scoreInstrument(make(o));
    expect(r.components.trend).toBe(trend);
    expect(r.partial).toBe(partial);
  });
});

describe("Momentum RSI", () => {
  const rows: [number, number][] = [
    [39.99, 0], [40, 4], [45, 8], [55, 12], [70, 12], [70.01, 6], [80, 6], [80.01, 2],
  ];
  it.each(rows)("rsi %s -> %s", (rsi14, pts) => {
    // base MACD is all false (0 > 0 false, hist 0 > 0 false) -> 0 MACD points
    expect(comp({ rsi14 }).momentum).toBe(pts);
  });
});

describe("Momentum MACD", () => {
  it("all three true -> 8", () => {
    expect(comp({ macd: 1, macdSignal: 0.5, macdHist: 0.5, prevMacdHist: 0.3 }).momentum).toBe(8 + 8);
  });
  it("all false -> 0", () => {
    expect(comp({ macd: -1, macdSignal: 0, macdHist: -0.5, prevMacdHist: 0.3 }).momentum).toBe(8);
  });
});

describe("Volume", () => {
  const rows: [string, Partial<ScoreInput>, number][] = [
    ["up 2.0", { close: 101, volume: 200 }, 15],
    ["up 1.5", { close: 101, volume: 150 }, 12],
    ["up 1.0", { close: 101, volume: 100 }, 9],
    ["up 0.9", { close: 101, volume: 90 }, 7],
    ["down 2.0", { close: 99, volume: 200 }, 0],
    ["down 1.5", { close: 99, volume: 150 }, 3],
    ["down 1.0", { close: 99, volume: 100 }, 5],
    ["down 0.9", { close: 99, volume: 90 }, 7],
    ["unchanged", { close: 100, volume: 200 }, 7],
  ];
  it.each(rows)("%s -> %s", (_n, o, pts) => {
    const r = scoreInstrument(make(o));
    expect(r.components.volume).toBe(pts);
    expect(r.partial).toBe(false);
  });
  it("index with volume 0 -> 7.5, not partial", () => {
    const r = scoreInstrument(make({ kind: "index", volume: 0, niftyLabel: "Neutral" }));
    expect(r.components.volume).toBe(7.5);
    expect(r.partial).toBe(false);
  });
});

describe("Pattern", () => {
  const bull = { name: "hammer", bias: "bullish" as const };
  const bear = { name: "shooting_star", bias: "bearish" as const };
  const doji = { name: "doji", bias: "neutral" as const };
  const rows: [string, Partial<ScoreInput>, number][] = [
    ["two bullish", { recentPatterns: [bull, bull] }, 15],
    ["one bearish", { recentPatterns: [bear] }, 3.75],
    ["three bearish", { recentPatterns: [bear, bear, bear] }, 0],
    ["doji near support", { recentPatterns: [doji], support: 99.5 }, 11.25],
    ["doji far from both", { recentPatterns: [doji], support: 90, resistance: 110 }, 7.5],
  ];
  it.each(rows)("%s -> %s", (_n, o, pts) => {
    expect(comp(o).pattern).toBe(pts);
  });
});

describe("Market", () => {
  const rows: [string, Partial<ScoreInput>, number][] = [
    ["nifty kind fixed", { kind: "nifty", niftyLabel: null, sectorLabel: null, rs20: null }, 10],
    ["Bullish + Neutral + rs 0.03", { niftyLabel: "Bullish", sectorLabel: "Neutral", rs20: 0.03 }, 13.5],
    ["rs -0.06 -> 0 part", { niftyLabel: "Bullish", sectorLabel: "Neutral", rs20: -0.06 }, 9],
  ];
  it.each(rows)("%s -> %s", (_n, o, pts) => {
    expect(comp(o).market).toBe(pts);
  });
  it("nifty kind is not partial on market", () => {
    expect(scoreInstrument(make({ kind: "nifty", niftyLabel: null, sectorLabel: null, rs20: null })).partial).toBe(false);
  });
});

describe("Risk", () => {
  const rows: [string, Partial<ScoreInput>, number][] = [
    ["ratio 3", { support: 95, resistance: 115 }, 10],
    ["ratio 0.4", { support: 90, resistance: 104 }, 0],
    ["only support 2% below", { support: 98 }, 7],
    ["only resistance 1% above", { resistance: 101 }, 3],
    ["neither", {}, 5],
    ["index kind", { kind: "index", support: 95, resistance: 115 }, 5],
  ];
  it.each(rows)("%s -> %s", (_n, o, pts) => {
    expect(comp(o).risk).toBe(pts);
  });
});

describe("labelFor", () => {
  const rows: [number, ScoreLabel][] = [
    [75, "Strong Bullish"], [74, "Bullish"], [60, "Bullish"], [59, "Neutral"],
    [45, "Neutral"], [44, "Bearish"], [30, "Bearish"], [29, "Strong Bearish"],
  ];
  it.each(rows)("%s -> %s", (s, l) => {
    expect(labelFor(s)).toBe(l);
  });
});

describe("confidenceFor", () => {
  const hi = (n: number): ScoreComponents => {
    // n bearish components (share 0), the rest bullish (share 1)
    const keys = ["trend", "momentum", "volume", "pattern", "market", "risk"] as const;
    const max = { trend: 20, momentum: 20, volume: 15, pattern: 15, market: 20, risk: 10 };
    const c = { ...max };
    keys.slice(0, n).forEach((k) => (c[k] = 0));
    return c;
  };
  it("Bullish, one bearish -> High", () => expect(confidenceFor(hi(1), "Bullish")).toBe("High"));
  it("Bullish, two bearish -> Medium", () => expect(confidenceFor(hi(2), "Bullish")).toBe("Medium"));
  it("Bullish, three bearish -> Low", () => expect(confidenceFor(hi(3), "Bullish")).toBe("Low"));
  it("Neutral, four bullish -> Medium", () => expect(confidenceFor(hi(2), "Neutral")).toBe("Medium"));
  it("Neutral otherwise -> Low", () => expect(confidenceFor(hi(3), "Neutral")).toBe("Low"));
});

describe("signal", () => {
  it("Bearish, lowest share is volume on a down day", () => {
    const r = scoreInstrument(
      make({
        close: 99, prevClose: 100, volume: 200,
        ema20: 105, ema50: 110, ema200: 90,
        rsi14: 50, macd: -1, macdSignal: 0, macdHist: -1, prevMacdHist: 0,
        niftyLabel: "Bearish", sectorLabel: "Bearish", rs20: -0.1,
        support: 95, resistance: 115,
      }),
    );
    expect(r.label).toBe("Bearish");
    expect(r.signal).toBe("Bearish weakness · supply pressure");
  });
});

describe("all-null stock", () => {
  it("has no NaN, is partial, integer score", () => {
    const r = scoreInstrument({
      kind: "stock", close: 100, prevClose: null,
      ema20: null, ema50: null, ema200: null, rsi14: null,
      macd: null, macdSignal: null, macdHist: null, prevMacdHist: null,
      volume: null, volAvg20: null, recentPatterns: [],
      niftyLabel: null, sectorLabel: null, rs20: null, support: null, resistance: null,
    });
    expect(r.partial).toBe(true);
    expect(Number.isInteger(r.score)).toBe(true);
    for (const v of Object.values(r.components)) expect(Number.isFinite(v)).toBe(true);
    expect(r.signal).not.toMatch(/NaN|undefined/);
  });
});
