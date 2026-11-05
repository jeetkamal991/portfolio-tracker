import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { ScoreSnapshot } from "@/lib/db/types";
import { SCORING_VERSION } from "@/lib/calc/scoreV2/config";
import { handleEvaluationGet } from "@/lib/api/evaluation";
import { buildEvaluationView, tone } from "@/lib/view/evaluation";
import { filterSnapshots, rankSnapshots } from "@/lib/view/snapshotRank";

const cat = (key: string, earned: number, available: number, max: number) => ({
  key, label: key, max, earned, available, coverage: available / max,
  items: [{ key: "i", label: "item", max: available, points: earned, status: "scored" as const, value: 1, note: "n" }],
});
const snap = (symbol: string, o: Partial<ScoreSnapshot> = {}, cov: Record<string, unknown> = {}, metrics: Record<string, unknown> = {}): ScoreSnapshot => ({
  instrumentId: symbol.charCodeAt(0), symbol, evaluationDate: "2026-11-05", scoringVersion: SCORING_VERSION,
  technicalScore: 70, tradeQualityScore: 60, fundamentalScore: null, dataConfidence: 95,
  categoryBreakdown: { technical: [cat("trend", 12, 18, 18), cat("relativeStrength", 10, 13, 20), cat("volume", 6, 12, 12)], tradeQuality: [cat("entry", 15, 25, 25)], levels: { entry: 100, stop: 95, stopSource: "atr", target: 110, targetSource: "resistance", rewardRisk: 2 } },
  dataCoverage: {
    technical: { coverage: 0.9, available: 90, earned: 63, status: "PROVISIONAL", missing: ["Flows: Delivery: x"] },
    tradeQuality: { coverage: 1, available: 100, earned: 60, status: "COMPLETE", rankable: true, observation: "Wait for pullback", flags: [], missing: [] },
    confidence: { score: 95, status: "OK", stale: false, freshness: 1, requiredInputs: 1, history: 1 },
    dataQuality: [], atr: { value: 2, pct: 2, candles: 300 }, liquidity: { median: 5e8, avg: 6e8, latest: 7e8 },
    metrics: { rsi: 60, rvol: 1.5, tradedValueCr: 50, trend: "above_all", sector: "NIFTY_IT", ...metrics }, ...cov,
  },
  dataTimestamp: "2026-11-05T10:00:00.000Z", ...o,
});

describe("buildEvaluationView", () => {
  it("maps statuses, never invents a fundamental score, and labels derived values", () => {
    const v = buildEvaluationView(snap("AAA"));
    expect(v.technical.status).toBe("PROVISIONAL");
    expect(v.tradeQuality.status).toBe("AVAILABLE");
    expect(v.fundamental).toMatchObject({ status: "NOT AVAILABLE" });
    expect(v.liquidity).toMatchObject({ medianCr: 50, estimated: true });
    expect(v.missing).toEqual(["Flows: Delivery: x"]);
    expect(v.tradeQuality.levels.rewardRisk).toBe(2);
    expect(v.notes.join(" ")).toMatch(/not guaranteed/);
  });
  it("shows STALE DATA when the confidence says the price is old", () => {
    const v = buildEvaluationView(snap("AAA", {}, { confidence: { score: 60, status: "LOW CONFIDENCE", stale: true, freshness: 0, requiredInputs: 1, history: 1 } }));
    expect(v.technical.status).toBe("STALE DATA");
    expect(v.confidence?.status).toBe("LOW CONFIDENCE");
  });
  it("colours by share earned and greys what was not scored", () => {
    expect(tone(15, 20, true)).toBe("good");
    expect(tone(9, 20, true)).toBe("caution");
    expect(tone(2, 20, true)).toBe("bad");
    expect(tone(0, 20, false)).toBe("missing");
    expect(tone(0, 0, true)).toBe("missing");
  });
});

describe("handleEvaluationGet", () => {
  it("returns the enhanced_v2 view with the legacy score alongside, never merged", async () => {
    const repo = createMemoryRepo({ instruments: [{ id: 5, key: "AAA", name: "AAA", type: "stock", yahooTicker: "AAA.NS", active: true }] });
    await repo.upsertCandles(5, [{ date: "2026-11-05", open: 1, high: 2, low: 1, close: 2, volume: 10 }]);
    await repo.upsertScore(5, { date: "2026-11-05", rsVsSector: null, score: 55, scoreComponents: null, scoreLabel: "Neutral", scoreConfidence: "Low", scoreSignal: "x" } as never);
    const none = await handleEvaluationGet(repo, "AAA");
    expect((none.body as { evaluation: unknown }).evaluation).toBeNull();
    expect((none.body as { legacy: { score: number } }).legacy.score).toBe(55);
    await repo.upsertSnapshots([{ ...snap("AAA"), instrumentId: 5 }]);
    const r = await handleEvaluationGet(repo, "AAA");
    const body = r.body as { evaluation: { scoringVersion: string }; legacy: { version: string } };
    expect(body.evaluation.scoringVersion).toBe(SCORING_VERSION);
    expect(body.legacy.version).toBe("legacy_v1");
    expect((await handleEvaluationGet(repo, "NOPE")).status).toBe(404);
  });
});

describe("rankings: kinds and filters", () => {
  const rows = [
    snap("AAA", { technicalScore: 90, tradeQualityScore: 50 }, {}, { rsi: 72, sector: "NIFTY_IT" }),
    snap("BBB", { technicalScore: 80, tradeQualityScore: 80 }, {}, { rsi: 55, rvol: 0.8, sector: "NIFTY_BANK", trend: "mixed" }),
    snap("CCC", { technicalScore: 60, tradeQualityScore: 90 }, { tradeQuality: { coverage: 0.7, rankable: false, observation: "x", flags: [], missing: [] } }, { tradedValueCr: 2 }),
  ];
  it("combined needs eligibility in both rankings and averages the two scores", () => {
    const r = rankSnapshots(rows, { version: SCORING_VERSION, kind: "combined" });
    expect(r.ranked.map((x) => [x.symbol, x.score])).toEqual([["BBB", 80], ["AAA", 70]]);
    expect(r.excluded[0]).toMatchObject({ symbol: "CCC" });
    expect(r.excluded[0]!.reason).toMatch(/^Trade quality/);
  });
  it("category rankings use the share of scorable points in that category", () => {
    const r = rankSnapshots(rows, { version: SCORING_VERSION, kind: "relativeStrength" });
    expect(r.ranked[0]!.score).toBeCloseTo((10 / 13) * 100, 6);
    expect(rankSnapshots(rows, { version: SCORING_VERSION, kind: "volume" }).ranked[0]!.score).toBe(50);
  });
  it("filters on score, RSI range, relative volume, liquidity, trend and sector; unknown values fail a filter", () => {
    const ids = (f: Parameters<typeof filterSnapshots>[1]) => filterSnapshots(rows, f).map((r) => r.symbol);
    expect(ids({ minTechnical: 75 })).toEqual(["AAA", "BBB"]);
    expect(ids({ rsiMin: 50, rsiMax: 60 })).toEqual(["BBB", "CCC"]);
    expect(ids({ minRvol: 1 })).toEqual(["AAA", "CCC"]);
    expect(ids({ minTradedCr: 10 })).toEqual(["AAA", "BBB"]);
    expect(ids({ trend: "mixed" })).toEqual(["BBB"]);
    expect(ids({ sector: "NIFTY_IT" })).toEqual(["AAA", "CCC"]);
    const unknown = snap("DDD", {}, {}, { rsi: null });
    expect(filterSnapshots([unknown], { rsiMin: 0 })).toEqual([]);
  });
});
