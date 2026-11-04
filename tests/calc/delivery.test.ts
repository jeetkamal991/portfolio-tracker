import { describe, expect, it } from "vitest";
import { buildDelivery, parseBhavcopy } from "@/lib/calc/delivery";
import type { DeliveryRow } from "@/lib/db/types";

const HEAD = "SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER";
const line = (sym: string, series: string, turn: number, per: string) =>
  `${sym}, ${series}, 03-Nov-2026, 1, 1, 1, 1, 1, 100.5, 1, 1000, ${turn}, 10, 500, ${per}`;

describe("parseBhavcopy", () => {
  it("keeps EQ only, drops '-' delivery, ranks by traded value, ISO dates", () => {
    const rows = parseBhavcopy([HEAD, line("AAA", "EQ", 50, "61.5"), line("BBB", "BE", 900, "70"), line("CCC", "EQ", 80, "-"), line("DDD", "EQ", 90, "40")].join("\n"));
    expect(rows.map((r) => [r.symbol, r.turnoverRank, r.delivPer, r.date])).toEqual([["DDD", 1, 40, "2026-11-03"], ["AAA", 2, 61.5, "2026-11-03"]]);
  });
  it("throws on an unknown header", () => {
    expect(() => parseBhavcopy("A,B\n1,2")).toThrow(/columns/);
  });
});

const r = (symbol: string, date: string, rank: number, per: number): DeliveryRow =>
  ({ symbol, date, turnoverLacs: 1000 - rank, tradedQty: 1, delivQty: 1, delivPer: per, close: 1, turnoverRank: rank });

describe("buildDelivery", () => {
  const dates = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  it("shortlists a stock active and >=60% on at least 5 of the last 10 sessions", () => {
    const rows = dates.flatMap((d, i) => [
      r("KEEP", d, 5, i >= 5 ? 70 : 50), // 7 qualifying days in the last 10 (indices 5..11), 5 are within the window? window = last 10 -> indices 2..11 -> 7 days
      r("LOW", d, 5, 59.9), // never high enough
      r("QUIET", d, 31, 90), // never in the top 30
    ]);
    const s = buildDelivery(rows).shortlists[0]!;
    expect(s.hits.map((h) => h.symbol)).toEqual(["KEEP"]);
    expect(s.hits[0]).toMatchObject({ days: 7, avgPer: 70, latestPer: 70 });
    expect(s.available).toBe(10);
  });
  it("needs 8 days for the 20-session window", () => {
    const rows = dates.map((d, i) => r("X", d, 1, i < 7 ? 80 : 10)); // 7 qualifying days, 12 sessions
    expect(buildDelivery(rows).shortlists[1]!.hits).toEqual([]);
  });
  it("today list: newest session, >=60%, highest delivery first", () => {
    const rows = [r("OLD", "2026-10-01", 1, 99), r("A", "2026-10-02", 3, 65), r("B", "2026-10-02", 9, 80), r("C", "2026-10-02", 2, 20)];
    const v = buildDelivery(rows);
    expect(v.session).toBe("2026-10-02");
    expect(v.today.map((t) => t.symbol)).toEqual(["B", "A"]);
  });
  it("is empty before any import", () => {
    expect(buildDelivery([])).toMatchObject({ session: null, today: [] });
  });
});
