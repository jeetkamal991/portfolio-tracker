import { describe, it, expect } from "vitest";
import type { Holding, StoredDay } from "@/lib/db/types";
import { buildPortfolioView, fmtInr, fmtSignedInr, sortPortfolioRows } from "@/lib/view/portfolio";

const day = (close: number | null, extra: Partial<StoredDay> = {}): StoredDay =>
  ({ date: "2026-10-16", close, pctChange: null, importedPct: null, score: null, scoreLabel: null, ...extra }) as StoredDay;

const h = (id: number, key: string, o: Partial<Holding> = {}): Holding => ({
  instrumentId: id, key, name: key, yahooTicker: `${key}.NS`,
  qty: 10, avgPrice: 100, buyDate: "2026-09-01", stopLoss: null, target1: null, target2: null, ...o,
});

describe("buildPortfolioView", () => {
  it("uses the live price when present, the stored close otherwise", () => {
    const v = buildPortfolioView(
      [h(1, "AAA"), h(2, "BBB")],
      new Map([[1, day(110, { pctChange: 0.01, score: 70, scoreLabel: "Bullish" })], [2, day(90)]]),
      { "AAA.NS": { price: 120, changePct: 0.02 } },
      "2026-10-16",
    );
    const a = v.rows.find((r) => r.key === "AAA")!;
    const b = v.rows.find((r) => r.key === "BBB")!;
    expect(a).toMatchObject({ cmp: 120, dayPct: 0.02, value: 1200, pnl: 200, score: 70 });
    expect(b).toMatchObject({ cmp: 90, value: 900, pnl: -100 });
    expect(v.totals.count).toBe(2);
  });

  it("unpriced holdings keep null figures and are counted as unpriced", () => {
    const v = buildPortfolioView([h(1, "AAA")], new Map([[1, null]]), {}, "2026-10-16");
    expect(v.rows[0]).toMatchObject({ cmp: null, value: null, pnl: null });
    expect(v.totals.unpriced).toBe(1);
  });

  it("orders warnings SL_HIT, TARGET_HIT, NEAR_SL, NEAR_TARGET then key, with the right level", () => {
    const hs = [
      h(1, "Z_NEARSL", { stopLoss: 98 }),
      h(2, "A_NEART", { target1: 101 }),
      h(3, "M_TARGET", { target1: 90, stopLoss: 50 }),
      h(4, "B_SL", { stopLoss: 105, target1: 200 }),
      h(5, "A_SL", { stopLoss: 100 }),
      h(6, "OKAY", { stopLoss: 10, target1: 500 }),
    ];
    const latest = new Map(hs.map((x) => [x.instrumentId, day(100)] as const));
    const v = buildPortfolioView(hs, latest, {}, "2026-10-16");
    expect(v.warnings.map((w) => [w.key, w.status, w.level])).toEqual([
      ["A_SL", "SL_HIT", 100],
      ["B_SL", "SL_HIT", 105],
      ["M_TARGET", "TARGET_HIT", 90],
      ["Z_NEARSL", "NEAR_SL", 98],
      ["A_NEART", "NEAR_TARGET", 101],
    ]);
  });
});

describe("sortPortfolioRows", () => {
  const rows = () =>
    buildPortfolioView(
      [h(1, "AAA"), h(2, "BBB"), h(3, "CCC"), h(4, "DDD")],
      new Map([[1, day(110)], [2, day(90)], [3, null], [4, day(150)]]),
      {},
      "2026-10-16",
    ).rows;

  it("pnl desc puts a null pnl row last", () => {
    expect(sortPortfolioRows(rows(), "pnl", "desc").map((r) => r.key)).toEqual(["DDD", "AAA", "BBB", "CCC"]);
  });
  it("nulls stay last ascending too; default is value desc", () => {
    expect(sortPortfolioRows(rows(), "pnl", "asc").map((r) => r.key)).toEqual(["BBB", "AAA", "DDD", "CCC"]);
    expect(sortPortfolioRows(rows()).map((r) => r.key)).toEqual(["DDD", "AAA", "BBB", "CCC"]);
  });
  it("ties break by key; names sort alphabetically", () => {
    expect(sortPortfolioRows(rows(), "qty", "desc").map((r) => r.key)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    expect(sortPortfolioRows(rows(), "name", "desc").map((r) => r.key)).toEqual(["DDD", "CCC", "BBB", "AAA"]);
  });
});

describe("money formatters", () => {
  it("fmtInr groups the Indian way", () => {
    expect(fmtInr(124560, 0)).toBe("₹1,24,560");
    expect(fmtInr(3412.5)).toBe("₹3,412.50");
    expect(fmtInr(-1120, 0)).toBe("−₹1,120");
    expect(fmtInr(null)).toBe("—");
    expect(fmtInr(NaN)).toBe("—");
    expect(fmtInr(Infinity)).toBe("—");
  });
  it("fmtSignedInr is always signed", () => {
    expect(fmtSignedInr(2340)).toBe("+₹2,340");
    expect(fmtSignedInr(-1120)).toBe("−₹1,120");
    expect(fmtSignedInr(0)).toBe("₹0");
    expect(fmtSignedInr(0.2)).toBe("₹0");
    expect(fmtSignedInr(null)).toBe("—");
  });
});
