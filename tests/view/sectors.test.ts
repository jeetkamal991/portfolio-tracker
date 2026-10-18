import { describe, it, expect } from "vitest";
import type { StoredDay } from "@/lib/db/types";
import type { SectorRow } from "@/lib/view/dashboard";
import { buildConstituentRows, buildSectorTiles } from "@/lib/view/sectors";

const sd = (date: string, o: Partial<StoredDay> = {}): StoredDay => ({
  date, open: null, high: null, low: null, close: null, volume: null,
  pctChange: null, importedPct: null, ema20: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null,
  rsVsSector: null, score: null, scoreComponents: null, scoreLabel: null, scoreConfidence: null, scoreSignal: null,
  ...o,
});
const D = "2026-10-16";
const members = ["A", "B", "C", "D", "E"].map((k) => ({ key: k, name: `${k} Ltd` }));
const dayOf = new Map<string, StoredDay>([
  ["A", sd(D, { close: 110, pctChange: 0.02, ema20: 100, ema50: 100, ema200: 100, rsi14: 61, score: 70, scoreLabel: "Bullish" })],
  ["B", sd(D, { close: 90, pctChange: 0.01, ema20: 100, ema50: 80, ema200: 80, rsi14: 50 })],
  ["C", sd(D, { close: 50, pctChange: 0 })],
  ["D", sd(D, { close: 40, importedPct: -0.01, ema20: 50, ema50: 50, ema200: 50 })],
]);
const row = (key: string, name = key): SectorRow => ({ key, name, d1: 0.01, w1: null, m1: null, m3: null, trend: null });

describe("buildConstituentRows", () => {
  it("sorts by day % desc, nulls last, and keeps members with no row", () => {
    const rows = buildConstituentRows(members, dayOf);
    expect(rows.map((r) => r.key)).toEqual(["A", "B", "C", "D", "E"]);
    expect(rows[3].dayPct).toBe(-0.01); // importedPct fallback
    expect(rows[4]).toEqual({ key: "E", name: "E Ltd", cmp: null, dayPct: null, score: null, scoreLabel: null, trend: null, rsi: null });
  });
  it("maps close, score, RSI and the 3-EMA trend", () => {
    const [a, b, , d] = buildConstituentRows(members, dayOf);
    expect(a).toMatchObject({ cmp: 110, score: 70, scoreLabel: "Bullish", rsi: 61, trend: "above_all" });
    expect(b.trend).toBe("mixed");
    expect(d.trend).toBe("below_all");
  });
  it("ties on day % break by key", () => {
    const m = new Map([["Z", sd(D, { close: 1, pctChange: 0.01 })], ["Y", sd(D, { close: 1, pctChange: 0.01 })]]);
    expect(buildConstituentRows([{ key: "Z", name: "Z" }, { key: "Y", name: "Y" }], m).map((r) => r.key)).toEqual(["Y", "Z"]);
  });
});

describe("buildSectorTiles", () => {
  const cons = buildConstituentRows(members, dayOf);
  it("derives top gainers/losers and the member count", () => {
    const [t] = buildSectorTiles([row("NIFTY_IT")], new Map([["NIFTY_IT", null]]), new Map([["NIFTY_IT", cons]]));
    expect(t.topGainers.map((r) => r.key)).toEqual(["A", "B"]);
    expect(t.topLosers.map((r) => r.key)).toEqual(["D"]);
    expect(t.constituentCount).toBe(5);
  });
  it("caps previews at 3 each way", () => {
    const many = buildConstituentRows(
      ["P", "Q", "R", "S", "T", "U", "V", "W"].map((k) => ({ key: k, name: k })),
      new Map(["P", "Q", "R", "S", "T", "U", "V", "W"].map((k, i) => [k, sd(D, { close: 1, pctChange: [0.04, 0.03, 0.02, 0.01, -0.01, -0.02, -0.03, -0.04][i] })])),
    );
    const [t] = buildSectorTiles([row("X")], new Map(), new Map([["X", many]]));
    expect(t.topGainers.map((r) => r.key)).toEqual(["P", "Q", "R"]);
    expect(t.topLosers.map((r) => r.key)).toEqual(["W", "V", "U"]);
  });
  it("copies score, RSI and RS from the sector's latest day", () => {
    const latest = new Map([["NIFTY_IT", sd(D, { close: 1, score: 64, scoreLabel: "Bullish", rsi14: 58.2, rsVsNifty: 0.012 })]]);
    const [t] = buildSectorTiles([row("NIFTY_IT")], latest, new Map());
    expect(t).toMatchObject({ score: 64, scoreLabel: "Bullish", rsi: 58.2, rsVsNifty: 0.012 });
  });
  it("flags a partial score (thin sector) so it isn't shown as a confident one", () => {
    // Only `partial` matters here; the component scores are irrelevant.
    const latest = new Map([
      ["THIN", sd(D, { close: 1, score: 50, scoreLabel: "Neutral", scoreComponents: { partial: true } as unknown as StoredDay["scoreComponents"] })],
      ["FULL", sd(D, { close: 1, score: 64, scoreLabel: "Bullish", scoreComponents: { partial: false } as unknown as StoredDay["scoreComponents"] })],
    ]);
    const [thin, full, none] = buildSectorTiles([row("THIN"), row("FULL"), row("NONE")], latest, new Map());
    expect([thin.scorePartial, full.scorePartial, none.scorePartial]).toEqual([true, false, false]);
  });
  it("no members → empty previews; no latest day → null stats", () => {
    const [t] = buildSectorTiles([row("NIFTY_IT")], new Map(), new Map());
    expect(t).toMatchObject({ topGainers: [], topLosers: [], constituentCount: 0, score: null, scoreLabel: null, rsi: null, rsVsNifty: null });
  });
  it("ties in the previews break by key, whatever the input order", () => {
    const tie = (k: string, pct: number) => ({ key: k, name: k, cmp: 1, dayPct: pct, score: null, scoreLabel: null, trend: null, rsi: null });
    const [t] = buildSectorTiles([row("X")], new Map(), new Map([["X", [tie("N", -0.01), tie("M", -0.01), tie("L", 0.02), tie("K", 0.02)]]]));
    expect(t.topGainers.map((r) => r.key)).toEqual(["K", "L"]);
    expect(t.topLosers.map((r) => r.key)).toEqual(["M", "N"]);
  });
  it("keeps the input row order", () => {
    const tiles = buildSectorTiles([row("NIFTY_BANK"), row("NIFTY_IT"), row("NIFTY_AUTO")], new Map(), new Map());
    expect(tiles.map((t) => t.key)).toEqual(["NIFTY_BANK", "NIFTY_IT", "NIFTY_AUTO"]);
  });
});
