import { describe, expect, it } from "vitest";
import { parseDailySummary, parseReportContent } from "@/lib/content/claude";
import type { DailySummary } from "@/lib/db/types";

const row = (o: Record<string, unknown>): DailySummary =>
  ({ date: "2026-10-16", summary: "Markets rose.", marketEvents: [], watchlistNews: [], ...o }) as DailySummary;
const ev = (n: number, extra: Record<string, unknown> = {}) => ({
  title: `T${n}`, explanation: `E${n}`, source_url: `https://example.com/${n}`, ...extra,
});

describe("parseDailySummary", () => {
  it("round-trips a valid summary", () => {
    const p = parseDailySummary(row({
      marketEvents: [ev(1)],
      watchlistNews: [{ key: "RELIANCE", ...ev(2) }],
    }));
    expect(p).toEqual({
      date: "2026-10-16", summary: "Markets rose.",
      events: [{ title: "T1", explanation: "E1", sourceUrl: "https://example.com/1" }],
      news: [{ key: "RELIANCE", title: "T2", explanation: "E2", sourceUrl: "https://example.com/2" }],
    });
  });

  it("parses a JSON string column once", () => {
    const p = parseDailySummary(row({ marketEvents: JSON.stringify([ev(1), ev(2)]) }));
    expect(p.events.map((e) => e.title)).toEqual(["T1", "T2"]);
  });

  it("never throws on garbage columns", () => {
    for (const bad of ["not json", {}, null, 5, "{\"a\":1}"]) {
      const p = parseDailySummary(row({ marketEvents: bad, watchlistNews: bad }));
      expect(p.events).toEqual([]);
      expect(p.news).toEqual([]);
    }
  });

  it("drops an invalid event but keeps the others", () => {
    const p = parseDailySummary(row({ marketEvents: [ev(1), { explanation: "no title" }, ev(3)] }));
    expect(p.events.map((e) => e.title)).toEqual(["T1", "T3"]);
  });

  it("caps events at 3 and news at 5", () => {
    const p = parseDailySummary(row({
      marketEvents: [1, 2, 3, 4, 5].map((n) => ev(n)),
      watchlistNews: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ key: `K${n}`, ...ev(n) })),
    }));
    expect(p.events).toHaveLength(3);
    expect(p.news).toHaveLength(5);
  });

  it("nulls a non-http(s) or missing source_url", () => {
    const p = parseDailySummary(row({
      marketEvents: [ev(1, { source_url: "javascript:alert(1)" }), ev(2, { source_url: "not a url" }), { title: "a", explanation: "b" }],
    }));
    expect(p.events.map((e) => e.sourceUrl)).toEqual([null, null, null]);
  });

  it("drops news without a key and coerces a non-string summary to empty", () => {
    const p = parseDailySummary(row({ summary: 42, watchlistNews: [ev(1)] }));
    expect(p.summary).toBe("");
    expect(p.news).toEqual([]);
  });
});

describe("parseReportContent", () => {
  const valid = {
    summary: "Solid.",
    fundamentals: { valuation: "Fair", growth: 5, balance_sheet: "Strong" },
    technicals: { trend: "Up", momentum: "Firm", volume: "Avg", support: [100, "x", 98.5], resistance: [120, null], notes: "n" },
    scenarios: { bullish: { case: "Break out", confirm_above: 121 }, bearish: { case: "Fails", invalidate_below: 97 } },
    risks: ["r1", 2, "r3"],
    sources: [{ title: "A", url: "https://a.com" }, { title: "B", url: "ftp://b.com" }, { url: "https://c.com" }],
    disclaimer: "Custom.",
    extra: "ignored",
  };

  it("parses snake_case into camelCase and filters bad entries", () => {
    const r = parseReportContent(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      summary: "Solid.",
      fundamentals: { valuation: "Fair", balance_sheet: "Strong" },
      technicals: { trend: "Up", momentum: "Firm", volume: "Avg", support: [100, 98.5], resistance: [120], notes: "n" },
      scenarios: { bullish: { case: "Break out", confirmAbove: 121 }, bearish: { case: "Fails", invalidateBelow: 97 } },
      risks: ["r1", "r3"],
      sources: [{ title: "A", url: "https://a.com" }],
      disclaimer: "Custom.",
    });
  });

  it("missing scenarios gives both null and default disclaimer", () => {
    const r = parseReportContent({ summary: "s" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scenarios).toEqual({ bullish: null, bearish: null });
    expect(r.value.disclaimer).toBe("Analysis to inform your own decision, not investment advice.");
    expect(r.value.technicals).toEqual({ support: [], resistance: [] });
    expect(r.value.risks).toEqual([]);
  });

  it("handles bad scenario pieces", () => {
    const r = parseReportContent({ scenarios: { bullish: { case: 3 }, bearish: { case: "x", invalidate_below: "n" } } });
    expect(r.ok && r.value.scenarios).toEqual({ bullish: null, bearish: { case: "x", invalidateBelow: null } });
  });

  it("non-string summary becomes null", () => {
    const r = parseReportContent({ summary: 3 });
    expect(r.ok && r.value.summary).toBeNull();
  });

  it("is not ok when the root is not an object", () => {
    for (const raw of ["text", null, 5, [1]]) expect(parseReportContent(raw)).toEqual({ ok: false, raw });
  });
});
