import { describe, it, expect } from "vitest";
import { buildPopupData } from "@/lib/view/popup";
import type { Instrument, Levels, ShareholdingRow, StoredDay } from "@/lib/db/types";

const inst: Instrument = { id: 1, key: "TCS", name: "TCS", type: "stock", yahooTicker: "TCS.NS", active: true };
const sector: Instrument = { id: 2, key: "NIFTY_IT", name: "Nifty IT", type: "sector", yahooTicker: "^CNXIT", active: true };
const noLevels: Levels = { autoSupport: null, autoResistance: null, manualSupport: null, manualResistance: null };

const day = (date: string, o: Partial<StoredDay> = {}): StoredDay => ({
  date, open: 100, high: 101, low: 99, close: 100, volume: 1000, pctChange: null, importedPct: null,
  ema20: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null, macd: null, macdSignal: null, macdHist: null,
  bbUpper: null, bbMiddle: null, bbLower: null, volAvg20: null, high52w: null, low52w: null, patterns: null,
  rsVsSector: null, score: null, scoreComponents: null, scoreLabel: null, scoreConfidence: null, scoreSignal: null,
  ...o,
});
const base = { shareholding: [] as ShareholdingRow[], instrument: inst, sector: null as Instrument | null, levels: noLevels, niftyLatest: null as StoredDay | null, onWatchlist: false, holding: null, reports: [] };
const d = (n: number) => `2026-01-${String(n).padStart(2, "0")}`;

describe("buildPopupData", () => {
  it("computes 52-week distances from the latest row", () => {
    const p = buildPopupData({ ...base, days: [day(d(1), { close: 90, high52w: 120, low52w: 80 })] });
    expect(p.range52.high).toBe(120);
    expect(p.range52.fromHigh).toBeCloseTo(-0.25);
    expect(p.range52.fromLow).toBeCloseTo(0.125);
  });

  it("derives level strength from touches", () => {
    const days = [1, 2, 3, 4].map((n) => day(d(n), { high: 110, low: 95, close: 100 }));
    const p = buildPopupData({ ...base, days, levels: { ...noLevels, autoResistance: 110, manualSupport: 50 } });
    expect(p.levels.resistance).toBe(110);
    expect(p.levels.resistanceStrength).toBe("Strong");
    expect(p.levels.support).toBe(50);
    expect(p.levels.supportManual).toBe(true);
    expect(p.levels.resistanceManual).toBe(false);
    expect(p.levels.supportStrength).toBe("Weak");
  });

  it.each([
    ["Strong Bullish", "Broad market trend supports longs"],
    ["Bullish", "Broad market trend supports longs"],
    ["Neutral", "Market is range-bound"],
    ["Bearish", "Broad market weakness"],
    ["Strong Bearish", "Broad market weakness"],
    [null, "Market score not available"],
  ] as const)("niftyLine for %s", (label, line) => {
    const p = buildPopupData({ ...base, days: [day(d(1))], niftyLatest: day(d(1), { scoreLabel: label }) });
    expect(p.tailwinds.niftyLabel).toBe(label);
    expect(p.tailwinds.niftyLine).toBe(line);
  });

  it("sectorLine sign and text", () => {
    const up = buildPopupData({ ...base, sector, days: [day(d(1), { rsVsSector: 0.024 })] });
    expect(up.tailwinds.sectorLine).toBe("Outperforming its sector by 2.4%");
    expect(up.instrument.sectorName).toBe("Nifty IT");
    const down = buildPopupData({ ...base, sector, days: [day(d(1), { rsVsSector: -0.031 })] });
    expect(down.tailwinds.sectorLine).toBe("Underperforming its sector by 3.1%");
    const idx = buildPopupData({ ...base, instrument: { ...inst, type: "index" }, days: [day(d(1), { rsVsSector: 0.02 })] });
    expect(idx.tailwinds.sectorLine).toBeNull();
  });

  it("lists patterns of the last 10 sessions newest first with effects", () => {
    const days = Array.from({ length: 12 }, (_, i) =>
      day(d(i + 1), { patterns: [{ name: `p${i + 1}`, bias: i % 2 ? "bearish" : "bullish" }] }),
    );
    const p = buildPopupData({ ...base, days });
    expect(p.patterns).toHaveLength(10);
    expect(p.patterns[0]).toEqual({ date: d(12), name: "p12", bias: "bearish", effect: -3.75 });
    expect(p.patterns[9].name).toBe("p3");
    expect(p.patterns[1].effect).toBe(3.75);
  });

  it("doji only has an effect when near a level", () => {
    const days = [day(d(1), { close: 100, patterns: [{ name: "doji", bias: "neutral" }] })];
    const none = buildPopupData({ ...base, days });
    expect(none.patterns[0].effect).toBe(0);
    const sup = buildPopupData({ ...base, days, levels: { ...noLevels, autoSupport: 99.5 } });
    expect(sup.patterns[0].effect).toBe(3.75);
    const res = buildPopupData({ ...base, days, levels: { ...noLevels, autoResistance: 100.5 } });
    expect(res.patterns[0].effect).toBe(-3.75);
  });

  it("indicator table has 18 rows with dashes for nulls", () => {
    const empty = buildPopupData({ ...base, days: [day(d(1))] });
    expect(empty.indicatorTable).toHaveLength(18);
    expect(empty.indicatorTable.map((r) => r.label).slice(0, 4)).toEqual(["CMP", "EMA 20", "EMA 50", "EMA 200"]);
    expect(empty.indicatorTable.find((r) => r.label === "EMA 20")!.value).toBe("—");
    expect(empty.indicatorTable.find((r) => r.label === "Volume vs 20-day avg")!.value).toBe("—");
    const full = buildPopupData({
      ...base,
      days: [day(d(1), { close: 100, ema20: 98, volume: 1820, volAvg20: 1000, rsVsNifty: 0.012, rsVsSector: -0.02 })],
    });
    const v = (l: string) => full.indicatorTable.find((r) => r.label === l)!.value;
    expect(v("EMA 20")).toBe("98.00 (+2.04%)");
    expect(v("Volume vs 20-day avg")).toBe("1.82×");
    expect(v("RS vs Nifty (4W)")).toBe("+1.20%");
    expect(v("RS vs sector (4W)")).toBe("-2.00%");
  });

  it("handles a stock with no priced days", () => {
    const p = buildPopupData({ ...base, days: [] });
    expect(p.latest).toBeNull();
    expect(p.score).toBeNull();
    expect(p.indicatorTable).toHaveLength(18);
    expect(p.patterns).toEqual([]);
  });

  it("exposes the score block", () => {
    const comps = { trend: 1, momentum: 2, volume: 3, pattern: 4, market: 5, risk: 6, flows: 10, partial: true };
    const p = buildPopupData({
      ...base,
      days: [day(d(1), { score: 61, scoreComponents: comps, scoreLabel: "Bullish", scoreConfidence: "High", scoreSignal: "x" })],
      onWatchlist: true,
    });
    expect(p.score).toMatchObject({ value: 61, label: "Bullish", confidence: "High", signal: "x", partial: true });
    expect(p.onWatchlist).toBe(true);
  });

  it("shows FII and DII holding with the change versus the previous quarter, dashes when absent", () => {
    const sh = (quarterEnd: string, fiiPct: number, diiPct: number): ShareholdingRow => ({ instrumentId: 1, quarterEnd, fiiPct, diiPct, promoterPct: 50, sourceUrl: null });
    const none = buildPopupData({ ...base, days: [day(d(1))] });
    expect(none.indicatorTable.slice(-2)).toEqual([{ label: "FII holding", value: "—" }, { label: "DII holding", value: "—" }]);
    const both = buildPopupData({ ...base, days: [day(d(1))], shareholding: [sh("2026-06-30", 48.1, 12), sh("2026-09-30", 49.6, 11.5)] });
    expect(both.indicatorTable.slice(-2)).toEqual([
      { label: "FII holding", value: "49.6% (+1.5 pts vs Apr–Jun)" },
      { label: "DII holding", value: "11.5% (-0.5 pts vs Apr–Jun)" },
    ]);
    const only = buildPopupData({ ...base, days: [day(d(1))], shareholding: [sh("2026-09-30", 49.6, 11.5)] });
    expect(only.indicatorTable.slice(-2).map((r) => r.value)).toEqual(["49.6%", "11.5%"]);
  });
});
