import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument, ScoreSnapshot } from "@/lib/db/types";
import type { Candle } from "@/lib/provider/types";
import { computeIndicators } from "@/lib/calc/indicators";
import { SCORING_VERSION } from "@/lib/calc/scoreV2/config";
import { dataConfidence } from "@/lib/calc/scoreV2/confidence";
import { sessionCalendar } from "@/lib/calc/returns";
import { addDays } from "@/lib/time/ist";
import { runSnapshotBatch, type BatchDeps } from "@/lib/jobs/snapshots";
import { rankSnapshots } from "@/lib/view/snapshotRank";

const inst = (id: number, key: string, type: Instrument["type"]): Instrument => ({ id, key, name: key, type, yahooTicker: `T_${key}`, active: true });

// Mock candles for tests only.
function series(n: number, drift: number): Candle[] {
  const out: Candle[] = [];
  let d = "2026-10-16";
  while (out.length < n) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const i = n - out.length;
      const close = 1000 + (n - i) * drift + Math.sin(i / 4) * 25;
      out.unshift({ date: d, open: close - 2, high: close + 6, low: close - 6, close, volume: 100_000 + (i % 7) * 10_000 });
    }
    d = addDays(d, -1);
  }
  return out;
}

type Mem = ReturnType<typeof createMemoryRepo>;
const N_STOCKS = 10;

async function setup(): Promise<Mem> {
  const instruments = [inst(1, "NIFTY50", "index"), inst(2, "NIFTY_IT", "sector")];
  for (let i = 0; i < N_STOCKS; i++) instruments.push(inst(10 + i, `S${i}`, "stock"));
  const repo = createMemoryRepo({ instruments });
  const nc = series(320, 1);
  const nm = new Map(nc.map((c) => [c.date, c.close]));
  const put = async (id: number, c: Candle[]) => {
    await repo.upsertCandles(id, c);
    await repo.upsertIndicators(id, computeIndicators(c, nm));
  };
  await put(1, nc);
  await put(2, series(320, 1.2));
  for (let i = 0; i < N_STOCKS; i++) await put(10 + i, series(320, 0.5 + i * 0.3));
  await repo.replaceConstituents("NIFTY200", Array.from({ length: N_STOCKS }, (_, i) => 10 + i));
  await repo.replaceConstituents("NIFTY_IT", [10, 11, 12]);
  return repo;
}

const deps = (repo: Mem, o: Partial<BatchDeps> = {}): BatchDeps => ({ repo, now: new Date("2026-10-16T14:00:00Z"), batchSize: 4, ...o });
const DATE = "2026-10-16";
const rows = async (repo: Mem) => repo.listSnapshots({ version: SCORING_VERSION, date: DATE });

describe("runSnapshotBatch", () => {
  it("covers the whole universe over several resumable batches and writes exact breakdowns", async () => {
    const repo = await setup();
    const results = [];
    for (let i = 0; i < 10; i++) {
      const r = await runSnapshotBatch(deps(repo));
      results.push(r);
      if (!r.more) break;
    }
    expect(results.map((r) => r.nextOffset)).toEqual([4, 8, 10]);
    expect(results[results.length - 1]!.status).toBe("completed");
    const snaps = await rows(repo);
    expect(snaps).toHaveLength(N_STOCKS);
    const s = snaps.find((x) => x.symbol === "S0")!;
    expect(s.scoringVersion).toBe(SCORING_VERSION);
    expect(s.evaluationDate).toBe(DATE);
    expect(s.fundamentalScore).toBeNull();
    expect(s.technicalScore).toBeGreaterThanOrEqual(0);
    expect(s.technicalScore).toBeLessThanOrEqual(100);
    expect(s.dataTimestamp).toBe(`${DATE}T10:00:00.000Z`);
    expect(JSON.stringify(s.categoryBreakdown)).toContain("relativeStrength");
    expect((s.dataCoverage as { fundamental: string }).fundamental).toBe("NOT AVAILABLE");
    const run = await repo.getScoreRun(DATE, SCORING_VERSION);
    expect(run).toMatchObject({ status: "completed", total: N_STOCKS, processed: N_STOCKS, nextOffset: N_STOCKS });
    expect(run!.batches).toBe(3);
  });

  it("running again after completion changes nothing and creates no duplicates", async () => {
    const repo = await setup();
    while ((await runSnapshotBatch(deps(repo))).more);
    const before = await rows(repo);
    const again = await runSnapshotBatch(deps(repo));
    expect(again.status).toBe("completed");
    expect(again.message).toMatch(/already completed/i);
    expect(await rows(repo)).toEqual(before);
  });

  it("a replayed batch (same rows written twice) stays one row per stock", async () => {
    const repo = await setup();
    await runSnapshotBatch(deps(repo, { batchSize: 20 }));
    const first = await rows(repo);
    await repo.upsertSnapshots(first);
    await repo.upsertSnapshots(first);
    expect(await rows(repo)).toHaveLength(N_STOCKS);
  });

  it("recovers from a crash between writing a batch and saving the cursor, without duplicating", async () => {
    const repo = await setup();
    const realSave = repo.saveScoreRun.bind(repo);
    let crash = true;
    repo.saveScoreRun = async (run) => {
      if (crash) {
        crash = false;
        throw new Error("simulated crash before the cursor was saved");
      }
      return realSave(run);
    };
    await expect(runSnapshotBatch(deps(repo))).rejects.toThrow(/simulated crash/);
    expect(await rows(repo)).toHaveLength(4); // the batch was written, the cursor was not
    // The dead invocation still holds the lease, so an immediate retry waits...
    expect((await runSnapshotBatch(deps(repo))).status).toBe("not_claimed");
    // ...and once the lease has expired the batch is simply done again.
    const later = new Date("2026-10-16T14:10:00Z");
    let r = await runSnapshotBatch(deps(repo, { now: later }));
    while (r.more) r = await runSnapshotBatch(deps(repo, { now: later }));
    expect(r.status).toBe("completed");
    expect(await rows(repo)).toHaveLength(N_STOCKS);
    expect(new Set((await rows(repo)).map((x) => x.symbol)).size).toBe(N_STOCKS);
  });

  it("stops starting work when its time budget is spent and resumes from the cursor", async () => {
    const repo = await setup();
    let t = 0;
    const clock = () => (t += 40); // every look at the clock costs 40 ms of the 100 ms budget
    const first = await runSnapshotBatch(deps(repo, { batchSize: 10, maxMs: 100, clock }));
    expect(first.more).toBe(true);
    expect(first.nextOffset).toBeLessThan(N_STOCKS);
    let r = first;
    for (let i = 0; i < 20 && r.more; i++) r = await runSnapshotBatch(deps(repo, { batchSize: 10, maxMs: 1e9 }));
    expect(r.status).toBe("completed");
    expect(await rows(repo)).toHaveLength(N_STOCKS);
  });

  it("retries a transient failure at the end of the run and then reports no failures", async () => {
    const repo = await setup();
    let blown = false;
    const evaluate: BatchDeps["evaluate"] = async (ctx, i) => {
      if (i.key === "S3" && !blown) {
        blown = true;
        throw new Error("transient read error");
      }
      return (await import("@/lib/jobs/snapshots")).evaluateStock(ctx, i);
    };
    let r = await runSnapshotBatch(deps(repo, { evaluate }));
    while (r.more) r = await runSnapshotBatch(deps(repo, { evaluate }));
    expect(r.status).toBe("completed");
    expect(r.failed).toEqual([]);
    expect(await rows(repo)).toHaveLength(N_STOCKS);
  });

  it("gives up on a permanently failing symbol after the attempt limit and still completes the rest", async () => {
    const repo = await setup();
    let calls = 0;
    const evaluate: BatchDeps["evaluate"] = async (ctx, i) => {
      if (i.key === "S3") {
        calls++;
        throw new Error("bad data");
      }
      return (await import("@/lib/jobs/snapshots")).evaluateStock(ctx, i);
    };
    let r = await runSnapshotBatch(deps(repo, { evaluate, maxSymbolAttempts: 3 }));
    for (let i = 0; i < 10 && r.more; i++) r = await runSnapshotBatch(deps(repo, { evaluate, maxSymbolAttempts: 3 }));
    expect(r.status).toBe("completed");
    expect(calls).toBe(3);
    expect(r.failed).toEqual([{ key: "S3", attempts: 3, error: "bad data" }]);
    expect(await rows(repo)).toHaveLength(N_STOCKS - 1);
  });

  it("fails the run instead of chaining without limit", async () => {
    const repo = await setup();
    let r = await runSnapshotBatch(deps(repo, { batchSize: 1, maxBatches: 3 }));
    for (let i = 0; i < 6 && r.more; i++) r = await runSnapshotBatch(deps(repo, { batchSize: 1, maxBatches: 3 }));
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/Batch allowance of 3/);
    expect((await repo.getScoreRun(DATE, SCORING_VERSION))!.batches).toBe(3);
  });

  it("does not let two invocations process the same run at once", async () => {
    const repo = await setup();
    const a = runSnapshotBatch(deps(repo));
    const b = runSnapshotBatch(deps(repo));
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status].filter((s) => s === "not_claimed")).toHaveLength(1);
  });
});

describe("dataConfidence", () => {
  const cal = sessionCalendar(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  const emptyResult = { categories: [], earned: 0, available: 0, coverage: 0, score: null, status: "NOT_AVAILABLE", missing: [], version: SCORING_VERSION } as never;
  const tradeEmpty = { categories: [], earned: 0, available: 0, coverage: 0, normalised: null, status: "NOT_AVAILABLE", missing: [], flags: [], rankable: false, levels: {} } as never;
  it("is fresh on the latest session, 75% fresh one session behind, stale after that", () => {
    const f = (d: string) => dataConfidence({ lastBarDate: d, cal, bars: 300, tech: emptyResult, trade: tradeEmpty });
    expect(f("2026-10-16").freshness).toBe(1);
    expect(f("2026-10-15").freshness).toBe(0.75);
    expect(f("2026-10-14")).toMatchObject({ freshness: 0, stale: true });
  });
  it("uses the 40/40/20 weights and flags LOW CONFIDENCE below 70", () => {
    const item = (key: string, status: "scored" | "missing") => ({ key, label: key, max: 10, points: 0, status, value: null, note: "" });
    const cat = (items: ReturnType<typeof item>[]) => ({ key: "k", label: "k", max: 100, items, earned: 0, available: 0, coverage: 0 });
    const tech = { ...(emptyResult as object), categories: [cat([item("a", "scored"), item("b", "missing")])] } as never;
    const full = dataConfidence({ lastBarDate: "2026-10-16", cal, bars: 201, tech: { ...(tech as object), categories: [cat([item("a", "scored")])] } as never, trade: tradeEmpty });
    expect(full.score).toBe(100);
    const half = dataConfidence({ lastBarDate: "2026-10-16", cal, bars: 201, tech, trade: tradeEmpty });
    expect(half.score).toBe(80); // 40 fresh + 20 (half the required inputs) + 20 history
    expect(half.status).toBe("OK");
    const low = dataConfidence({ lastBarDate: "2026-10-12", cal, bars: 100, tech, trade: tradeEmpty });
    expect(low.status).toBe("LOW CONFIDENCE");
  });
  it("does not count optional inputs (delivery, sector, FII/DII, breakout levels) as missing", () => {
    const item = (key: string, status: "scored" | "missing") => ({ key, label: key, max: 10, points: 0, status, value: null, note: "" });
    const tech = { ...(emptyResult as object), categories: [{ key: "k", label: "k", max: 100, earned: 0, available: 0, coverage: 0, items: [item("a", "scored"), item("delivery", "missing"), item("sectorTrend", "missing"), item("fii", "missing"), item("rewardRisk", "missing")] }] } as never;
    expect(dataConfidence({ lastBarDate: "2026-10-16", cal, bars: 201, tech, trade: tradeEmpty }).requiredInputs).toBe(1);
  });
});

describe("rankSnapshots", () => {
  const snap = (symbol: string, o: Partial<ScoreSnapshot> & { rankable?: boolean; techCov?: number; tradeCov?: number; conf?: string } = {}): ScoreSnapshot => ({
    instrumentId: 1, symbol, evaluationDate: DATE, scoringVersion: SCORING_VERSION,
    technicalScore: 70, tradeQualityScore: 60, fundamentalScore: null, dataConfidence: 90, categoryBreakdown: {},
    dataCoverage: { technical: { coverage: o.techCov ?? 1 }, tradeQuality: { coverage: o.tradeCov ?? 1, rankable: o.rankable ?? true }, confidence: { status: o.conf ?? "OK" } },
    dataTimestamp: `${DATE}T10:00:00.000Z`, ...o,
  });
  it("keeps breakout stocks in the technical ranking and out of the trade quality ranking, with a reason", () => {
    const rows = [snap("A", { technicalScore: 90 }), snap("BRK", { technicalScore: 95, tradeQualityScore: 50, rankable: false, tradeCov: 0.7 }), snap("B", { technicalScore: 80, tradeQualityScore: 75 })];
    const tech = rankSnapshots(rows, { version: SCORING_VERSION, kind: "technical" });
    expect(tech.ranked.map((r) => r.symbol)).toEqual(["BRK", "A", "B"]);
    const trade = rankSnapshots(rows, { version: SCORING_VERSION, kind: "tradeQuality" });
    expect(trade.ranked.map((r) => r.symbol)).toEqual(["B", "A"]);
    expect(trade.excluded).toEqual([{ symbol: "BRK", reason: "Trade quality coverage 70% is below 80%" }]);
  });
  it("excludes low-coverage and low-confidence stocks instead of ranking them as verified", () => {
    const rows = [snap("A"), snap("LOWCOV", { techCov: 0.7 }), snap("LOWCONF", { conf: "LOW CONFIDENCE" })];
    const r = rankSnapshots(rows, { version: SCORING_VERSION, kind: "technical" });
    expect(r.ranked.map((x) => x.symbol)).toEqual(["A"]);
    expect(r.excluded.map((x) => x.symbol).sort()).toEqual(["LOWCONF", "LOWCOV"]);
  });
  it("refuses to mix scoring versions or dates", () => {
    expect(() => rankSnapshots([snap("A"), snap("B", { scoringVersion: "legacy_v1" })], { version: SCORING_VERSION, kind: "technical" })).toThrow(/version/);
    expect(() => rankSnapshots([snap("A"), snap("B", { evaluationDate: "2026-10-15" })], { version: SCORING_VERSION, kind: "technical" })).toThrow(/several evaluation dates/);
  });
});
