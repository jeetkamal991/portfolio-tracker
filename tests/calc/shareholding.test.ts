import { describe, it, expect } from "vitest";
import { isValidShareholding, previousQuarterEnd, quarterLabel, rankStakeIncreases } from "@/lib/calc/shareholding";
import type { ShareholdingRow } from "@/lib/db/types";

const row = (instrumentId: number, quarterEnd: string, fiiPct: number | null, diiPct: number | null = 10, promoterPct: number | null = 50): ShareholdingRow =>
  ({ instrumentId, quarterEnd, fiiPct, diiPct, promoterPct, sourceUrl: null });
const members = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, key: `S${String(i + 1).padStart(2, "0")}`, name: `Stock ${i + 1}` }));
const L = "2026-09-30", P = "2026-06-30";

describe("quarter maths", () => {
  it("steps back one quarter, including the year rollover", () => {
    expect(previousQuarterEnd("2026-09-30")).toBe("2026-06-30");
    expect(previousQuarterEnd("2026-06-30")).toBe("2026-03-31");
    expect(previousQuarterEnd("2026-03-31")).toBe("2025-12-31");
    expect(previousQuarterEnd("2026-12-31")).toBe("2026-09-30");
  });
  it("labels a quarter", () => {
    expect(quarterLabel("2026-09-30")).toBe("Jul–Sep 2026");
    expect(quarterLabel("2026-12-31")).toBe("Oct–Dec 2026");
    expect(quarterLabel("2026-03-31")).toBe("Jan–Mar 2026");
    expect(quarterLabel("2026-06-30")).toBe("Apr–Jun 2026");
  });
});

describe("rankStakeIncreases", () => {
  it("lists only positive changes, largest first, rounded to 2 decimals", () => {
    const m = members(4);
    const rows = [
      row(1, P, 48.1), row(1, L, 49.6), row(2, P, 10), row(2, L, 10.2),
      row(3, P, 5), row(3, L, 5), row(4, P, 7), row(4, L, 6.6),
    ];
    const s = rankStakeIncreases("FII", m, rows, L);
    expect(s.hits.map((h) => [h.key, h.change])).toEqual([["S01", 1.5], ["S02", 0.2]]);
    expect(s.hits[0]).toMatchObject({ from: 48.1, to: 49.6, name: "Stock 1" });
    expect(s).toMatchObject({ holder: "FII", quarter: L, label: "Jul–Sep 2026", reported: 4, total: 4 });
  });
  it("uses the DII column for DII", () => {
    const rows = [row(1, P, 1, 20), row(1, L, 1, 22)];
    expect(rankStakeIncreases("DII", members(1), rows, L).hits[0].change).toBe(2);
    expect(rankStakeIncreases("FII", members(1), rows, L).hits).toEqual([]);
  });
  it("excludes a stock with no previous-quarter row, and ignores older rows", () => {
    const rows = [row(1, L, 5), row(2, "2026-03-31", 1), row(2, L, 9)];
    const s = rankStakeIncreases("FII", members(2), rows, L);
    expect(s.hits).toEqual([]);
    expect(s.reported).toBe(2);
  });
  it("excludes null values and rows of non-members", () => {
    const rows = [row(1, P, null), row(1, L, 5), row(99, P, 1), row(99, L, 9)];
    const s = rankStakeIncreases("FII", members(1), rows, L);
    expect(s.hits).toEqual([]);
    expect(s.reported).toBe(1);
  });
  it("caps at the limit and breaks ties by key", () => {
    const m = members(12);
    const rows = m.flatMap((x) => [row(x.id, P, 10), row(x.id, L, 11)]);
    const s = rankStakeIncreases("FII", m, rows, L);
    expect(s.hits).toHaveLength(10);
    expect(s.hits.map((h) => h.key)).toEqual(m.slice(0, 10).map((x) => x.key));
    expect(s.total).toBe(12);
  });
});

describe("isValidShareholding", () => {
  it("accepts nulls and sensible values", () => {
    expect(isValidShareholding(row(1, L, null, null, null))).toBe(true);
    expect(isValidShareholding(row(1, L, 20, 20, 60.5))).toBe(true);
  });
  it("rejects out-of-range values and sums above 100.5", () => {
    expect(isValidShareholding(row(1, L, 101))).toBe(false);
    expect(isValidShareholding(row(1, L, -1))).toBe(false);
    expect(isValidShareholding(row(1, L, 40, 40, 22))).toBe(false);
  });
});
