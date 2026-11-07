import { describe, expect, it } from "vitest";
import { coverage, FIELDS, formatCoverage, isFinancial, toRow } from "@/lib/calc/fundamentals";

const ctx = { instrumentId: 7, fetchedOn: "2026-11-08", isFinancial: false };
const num = (i: number) => i + 0.5;
const full = () => ({
  financialData: Object.fromEntries(FIELDS.filter((f) => f.module === "financialData").map((f, i) => [f.key, num(i)])),
  summaryDetail: Object.fromEntries(FIELDS.filter((f) => f.module === "summaryDetail").map((f, i) => [f.key, num(i)])),
  defaultKeyStatistics: Object.fromEntries(FIELDS.filter((f) => f.module === "defaultKeyStatistics").map((f, i) => [f.key, num(i)])),
});

describe("FIELDS", () => {
  it("lists the 15 spec fields with unique keys and snake_case columns", () => {
    expect(FIELDS).toHaveLength(15);
    expect(new Set(FIELDS.map((f) => f.key)).size).toBe(15);
    expect(new Set(FIELDS.map((f) => f.column)).size).toBe(15);
    expect(FIELDS.find((f) => f.key === "trailingPE")!.column).toBe("trailing_pe");
    expect(FIELDS.find((f) => f.key === "freeCashflow")!.column).toBe("free_cashflow");
    expect(FIELDS.filter((f) => f.module === "financialData")).toHaveLength(12);
  });
});

describe("isFinancial", () => {
  it("is true when any index is a financial one", () => {
    expect(isFinancial(["NIFTY200", "NIFTY_PVT_BANK"])).toBe(true);
    expect(isFinancial(["NIFTY_FIN"])).toBe(true);
    expect(isFinancial(["NIFTY_PSU_BANK", "NIFTY200"])).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isFinancial(["NIFTY200", "NIFTY_AUTO"])).toBe(false);
    expect(isFinancial([])).toBe(false);
  });
});

describe("toRow", () => {
  it("keeps every value of a full response and echoes the context", () => {
    const input = full();
    const row = toRow(input, ctx);
    expect(row.missing).toEqual([]);
    expect(row.values.returnOnEquity).toBe(input.financialData.returnOnEquity);
    expect(row.values.marketCap).toBe(input.summaryDetail.marketCap);
    expect(row).toMatchObject({ instrumentId: 7, fetchedOn: "2026-11-08", isFinancial: false });
    expect(row.raw).toEqual(input);
  });

  it("marks only the fields of an absent module as missing", () => {
    const all = full();
    const row = toRow({ summaryDetail: all.summaryDetail, defaultKeyStatistics: all.defaultKeyStatistics }, ctx);
    expect(row.missing).toHaveLength(12);
    expect(row.values.debtToEquity).toBeNull();
    expect(row.values.trailingPE).not.toBeNull();
    expect(row.values.priceToBook).not.toBeNull();
  });

  it("treats 0 and negatives as values, and non-finite or non-numbers as missing", () => {
    const row = toRow(
      { financialData: { returnOnEquity: 0, debtToEquity: -5, currentRatio: NaN, totalDebt: Infinity, totalCash: "12", freeCashflow: {}, operatingCashflow: null, returnOnAssets: undefined } },
      ctx,
    );
    expect(row.values.returnOnEquity).toBe(0);
    expect(row.values.debtToEquity).toBe(-5);
    for (const k of ["currentRatio", "totalDebt", "totalCash", "freeCashflow", "operatingCashflow", "returnOnAssets"]) {
      expect(row.values[k]).toBeNull();
      expect(row.missing).toContain(k);
    }
    expect(row.missing).not.toContain("returnOnEquity");
    expect(row.missing).not.toContain("debtToEquity");
  });

  it("gives an all-missing row for an unknown symbol (null, undefined or a non-object)", () => {
    for (const bad of [null, undefined, "x", 3]) {
      const row = toRow(bad, { ...ctx, isFinancial: true });
      expect(row.missing).toHaveLength(15);
      expect(row.raw).toBeNull();
      expect(row).toMatchObject({ instrumentId: 7, fetchedOn: "2026-11-08", isFinancial: true });
    }
  });

  it("stores raw as plain JSON, so dates become strings", () => {
    const row = toRow({ financialData: { returnOnEquity: 1 }, calendarEvents: { earningsDate: new Date("2026-11-01T00:00:00Z") } }, ctx);
    expect((row.raw as { calendarEvents: { earningsDate: string } }).calendarEvents.earningsDate).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("coverage", () => {
  it("counts present fields per group", () => {
    const c = coverage([
      { isFinancial: true, missing: ["debtToEquity"] },
      { isFinancial: false, missing: [] },
      { isFinancial: false, missing: ["returnOnEquity"] },
    ]);
    expect(c.financials.stocks).toBe(1);
    expect(c.financials.byField.debtToEquity).toBe(0);
    expect(c.financials.byField.returnOnEquity).toBe(1);
    expect(c.others.stocks).toBe(2);
    expect(c.others.byField.returnOnEquity).toBe(1);
    expect(c.others.byField.marketCap).toBe(2);
  });
  it("is all zero for no rows", () => {
    const c = coverage([]);
    expect(c.financials.stocks).toBe(0);
    expect(c.others.stocks).toBe(0);
    expect(Object.values(c.others.byField).every((n) => n === 0)).toBe(true);
    expect(Object.keys(c.others.byField)).toHaveLength(15);
  });
});

describe("formatCoverage", () => {
  it("shows present/stocks per field and flags fields under 80%", () => {
    const text = formatCoverage(coverage([
      { isFinancial: false, missing: ["returnOnEquity"] },
      { isFinancial: false, missing: [] },
    ]));
    expect(text).toContain("returnOnEquity");
    expect(text).toContain("1/2");
    expect(text).toContain("<80%");
    expect(text).toContain("2/2");
  });
  it("does not divide by zero for an empty group", () => {
    expect(formatCoverage(coverage([]))).not.toContain("NaN");
  });
});
