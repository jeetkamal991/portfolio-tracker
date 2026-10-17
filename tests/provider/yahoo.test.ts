import { describe, expect, test } from "vitest";
import { createYahooProvider, mapChart, mapQuote, type YahooLike } from "@/lib/provider/yahoo";

test("mapChart uses IST date and drops null closes", () => {
  const c = mapChart({ quotes: [
    { date: new Date("2026-10-15T18:30:00Z"), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { date: new Date("2026-10-16T03:45:00Z"), open: 1, high: 2, low: 0.5, close: null, volume: 0 },
  ] });
  expect(c).toEqual([{ date: "2026-10-16", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
});

test("mapChart dedupes same IST date keeping the later bar, ascending", () => {
  const c = mapChart({ quotes: [
    { date: new Date("2026-10-16T10:01:00Z"), open: 5, high: 6, low: 4, close: 5.5, volume: 20 },
    { date: new Date("2026-10-15T03:45:00Z"), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { date: new Date("2026-10-16T03:45:00Z"), open: 3, high: 4, low: 2, close: 3.5, volume: 15 },
  ] });
  expect(c.map((x) => x.date)).toEqual(["2026-10-15", "2026-10-16"]);
  expect(c[1]).toEqual({ date: "2026-10-16", open: 5, high: 6, low: 4, close: 5.5, volume: 20 });
});

test("mapQuote converts percent to fraction", () => {
  expect(mapQuote({ symbol: "^NSEI", regularMarketPrice: 25000, regularMarketChangePercent: -0.88, regularMarketPreviousClose: 25222, regularMarketTime: new Date("2026-10-16T09:00:00Z") }).changePct).toBeCloseTo(-0.0088);
});

describe("createYahooProvider", () => {
  const bars = [
    { date: new Date("2026-10-14T03:45:00Z"), open: 1, high: 2, low: 0.5, close: 1, volume: 1 },
    { date: new Date("2026-10-15T03:45:00Z"), open: 1, high: 2, low: 0.5, close: 2, volume: 1 },
    { date: new Date("2026-10-16T03:45:00Z"), open: 1, high: 2, low: 0.5, close: 3, volume: 1 },
    { date: new Date("2026-10-17T03:45:00Z"), open: 1, high: 2, low: 0.5, close: 4, volume: 1 },
  ];
  const mk = (fail = 0) => {
    const calls: { period1: Date; period2: Date; interval: string }[] = [];
    let f = fail;
    const client: YahooLike = {
      chart: async (_t, o) => { calls.push(o); if (f-- > 0) throw new Error("net"); return { quotes: bars }; },
      quote: async (t) => t.map((s) => ({ symbol: s, regularMarketPrice: 10, regularMarketChangePercent: 1, regularMarketPreviousClose: 9.9, regularMarketTime: new Date("2026-10-16T09:00:00Z") })),
    };
    return { client, calls };
  };

  test("getDailyHistory filters inclusively and period2 covers toDate", async () => {
    const { client, calls } = mk();
    const p = createYahooProvider(client, async () => {});
    const c = await p.getDailyHistory("^NSEI", "2026-10-15", "2026-10-16");
    expect(c.map((x) => x.date)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(calls[0].interval).toBe("1d");
    expect(calls[0].period2.getTime()).toBeGreaterThan(new Date("2026-10-16T18:30:00Z").getTime());
  });

  test("retries transient failures", async () => {
    const { client, calls } = mk(2);
    const p = createYahooProvider(client, async () => {});
    await p.getDailyHistory("^NSEI", "2026-10-15", "2026-10-16");
    expect(calls.length).toBe(3);
  });

  test("rejects when all attempts fail", async () => {
    const { client } = mk(5);
    const p = createYahooProvider(client, async () => {});
    await expect(p.getDailyHistory("BAD", "2026-10-15", "2026-10-16")).rejects.toThrow("net");
  });

  test("getQuotes maps all tickers", async () => {
    const { client } = mk();
    const q = await createYahooProvider(client, async () => {}).getQuotes(["^NSEI", "^NSEBANK"]);
    expect(q.map((x) => x.ticker)).toEqual(["^NSEI", "^NSEBANK"]);
    expect(q[0].changePct).toBeCloseTo(0.01);
    expect(q[0].asOf).toBe("2026-10-16T09:00:00.000Z");
  });
});

import { mapQuote as mapQuoteDay } from "@/lib/provider/yahoo";
import { test as dayTest, expect as dayExpect } from "vitest";
dayTest("mapQuote carries the session's day high/low, null when Yahoo omits them", () => {
  const q = mapQuoteDay({ symbol: "^NSEI", regularMarketPrice: 100, regularMarketChangePercent: 1, regularMarketDayHigh: 101, regularMarketDayLow: 98 });
  dayExpect(q.dayHigh).toBe(101);
  dayExpect(q.dayLow).toBe(98);
  const bare = mapQuoteDay({ symbol: "^NSEI", regularMarketPrice: 100 });
  dayExpect(bare.dayHigh).toBeNull();
  dayExpect(bare.dayLow).toBeNull();
});
