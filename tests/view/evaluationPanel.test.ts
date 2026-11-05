import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvaluationPanel } from "@/app/components/popup/EvaluationTab";
import { buildEvaluationView } from "@/lib/view/evaluation";
import type { ScoreSnapshot } from "@/lib/db/types";

const item = (key: string, label: string, max: number, points: number, status: "scored" | "missing", extra: object = {}) => ({ key, label, max, points, status, value: status === "scored" ? 1.5 : null, note: status === "scored" ? "because" : "no data", ...extra });
const cat = (key: string, label: string, max: number, items: ReturnType<typeof item>[]) => {
  const available = items.filter((i) => i.status === "scored").reduce((s, i) => s + i.max, 0);
  const earned = items.reduce((s, i) => s + i.points, 0);
  return { key, label, max, items, earned, available, coverage: available / max };
};
// Mock snapshot for tests only, in the exact shape the snapshot job stores.
const snapshot = (over: Partial<ScoreSnapshot["dataCoverage"] & object> = {}): ScoreSnapshot => ({
  instrumentId: 1, symbol: "AAA", evaluationDate: "2026-11-05", scoringVersion: "enhanced_v2",
  technicalScore: 72.5, tradeQualityScore: 64, fundamentalScore: null, dataConfidence: 91,
  categoryBreakdown: {
    technical: [
      cat("trend", "Trend", 18, [item("a", "Price above EMA20", 3, 3, "scored"), item("b", "EMA50 slope", 1, 0, "missing")]),
      cat("market", "Market & sector conditions", 12, [item("n", "Nifty 50 trend", 5, 4, "scored", { group: "Market conditions" }), item("s", "Sector index trend", 5, 0, "missing", { group: "Sector conditions" })]),
    ],
    tradeQuality: [cat("entry", "Entry location", 25, [item("e", "EMA20 distance", 10, 7, "scored")])],
    levels: { entry: 100, stop: 95, stopSource: "lower of support and ATR", target: null, targetSource: null, rewardRisk: null },
  },
  dataCoverage: {
    technical: { coverage: 0.88, available: 88, earned: 64, status: "PROVISIONAL", missing: ["Trend: EMA50 slope: no data"] },
    tradeQuality: { coverage: 0.7, available: 70, earned: 45, status: "PROVISIONAL", rankable: false, observation: "No valid target (breakout territory)", flags: ["No valid target: no resistance above the price (breakout territory)"], missing: [] },
    confidence: { score: 91, status: "OK", stale: false, freshness: 1, requiredInputs: 0.9, history: 1 },
    dataQuality: [{ kind: "price_break", date: "2025-10-14", note: "Demerger: different bases", sessionsUsed: 263 }],
    atr: { value: 2.5, pct: 2.5, candles: 300 }, liquidity: { median: 4e8, avg: 5e8, latest: 6e8 }, metrics: {},
    ...over,
  },
  dataTimestamp: "2026-11-05T10:00:00.000Z",
});
const html = (s: ScoreSnapshot, legacy: { version: string; score: number; label: string | null; date: string } | null = null) =>
  renderToStaticMarkup(createElement(EvaluationPanel, { e: buildEvaluationView(s), legacy }));

describe("EvaluationPanel", () => {
  it("shows every score with points, coverage and status, and never a fundamental number", () => {
    const h = html(snapshot(), { version: "legacy_v1", score: 55, label: "Neutral", date: "2026-11-05" });
    expect(h).toContain("Technical strength");
    expect(h).toContain("Trade quality");
    expect(h).toContain("Fundamental quality");
    expect(h).toContain("NOT AVAILABLE");
    expect(h).toContain("coverage 88%");
    expect(h).toContain("PROVISIONAL");
    expect(h).toContain("enhanced_v2");
    expect(h).toContain("legacy_v1 score 55");
    expect(h).toContain("Data confidence");
  });
  it("shows the breakdown with points awarded and maximum, grouped market vs sector, and missing items as not scored", () => {
    const h = html(snapshot());
    expect(h).toContain("Market conditions");
    expect(h).toContain("Sector conditions");
    expect(h).toContain("3/3");
    expect(h).toContain("Not scored: no data");
    expect(h).toContain("1 input(s) could not be scored");
  });
  it("states the trade assessment honestly: no invented target, no reward-to-risk", () => {
    const h = html(snapshot());
    expect(h).toContain("No valid target (breakout territory)");
    expect(h).toContain("not calculable");
    expect(h).toContain("Not ranked: needs");
    expect(h).toContain("not guaranteed prices");
    expect(h).toContain("(estimate)");
  });
  it("surfaces data-quality warnings, low confidence and stale data", () => {
    expect(html(snapshot())).toContain("Demerger: different bases");
    const low = html(snapshot({ confidence: { score: 60, status: "LOW CONFIDENCE", stale: true, freshness: 0, requiredInputs: 0.8, history: 1 } }));
    expect(low).toContain("LOW CONFIDENCE");
    expect(low).toContain("STALE DATA");
  });
});
