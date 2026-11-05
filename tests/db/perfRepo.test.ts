import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import type { Instrument } from "@/lib/db/types";
import type { Candle } from "@/lib/provider/types";

const inst = (id: number, key: string, type: Instrument["type"] = "stock"): Instrument => ({ id, key, name: key, type, yahooTicker: `${key}.NS`, active: true });
const candle = (date: string, close: number): Candle => ({ date, open: close, high: close + 1, low: close - 1, close, volume: 100 });

describe("batched reads (memory repo)", () => {
  async function seeded() {
    const repo = createMemoryRepo({ instruments: [inst(1, "AAA"), inst(2, "BBB"), inst(3, "IDX", "sector")] });
    await repo.upsertCandles(1, ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06"].map((d, i) => candle(d, 100 + i)));
    await repo.upsertCandles(2, ["2026-01-05", "2026-01-06"].map((d, i) => candle(d, 50 + i)));
    await repo.setManualLevels(1, 90, 120);
    await repo.replaceConstituents("IDX", [1, 2]);
    await repo.replaceConstituents("OTHER", [2]);
    return repo;
  }
  it("getRecentDays returns the newest N rows of every instrument in one call, oldest first", async () => {
    const repo = await seeded();
    const m = await repo.getRecentDays([1, 2, 99], 3);
    expect(m.get(1)!.map((d) => d.date)).toEqual(["2026-01-02", "2026-01-05", "2026-01-06"]);
    expect(m.get(2)!.map((d) => d.date)).toEqual(["2026-01-05", "2026-01-06"]);
    expect(m.has(99)).toBe(false);
  });
  it("getLevelsMany gives every id a value, empty when none stored", async () => {
    const repo = await seeded();
    const m = await repo.getLevelsMany([1, 2]);
    expect(m.get(1)).toMatchObject({ manualSupport: 90, manualResistance: 120 });
    expect(m.get(2)).toMatchObject({ manualSupport: null, autoSupport: null });
  });
  it("listConstituentsMany returns every requested key, including empty ones", async () => {
    const repo = await seeded();
    const m = await repo.listConstituentsMany(["IDX", "OTHER", "NONE"]);
    expect(m.get("IDX")!.map((i) => i.key).sort()).toEqual(["AAA", "BBB"]);
    expect(m.get("OTHER")!.map((i) => i.key)).toEqual(["BBB"]);
    expect(m.get("NONE")).toEqual([]);
  });
  it("getChartDays returns the newest rows ascending", async () => {
    const repo = await seeded();
    expect((await repo.getChartDays(1, 2)).map((d) => d.date)).toEqual(["2026-01-05", "2026-01-06"]);
  });
});

describe("batched reads (supabase repo, fake client)", () => {
  // Records the table, the select string and the filters of every request.
  function fake(responder: (table: string, cols: string, ctx: { ids: unknown[] }) => unknown[]) {
    const calls: { table: string; cols: string; ids: unknown[] }[] = [];
    const db = {
      from: (table: string) => {
        let cols = "";
        let ids: unknown[] = [];
        const q: Record<string, unknown> = {};
        q.select = (c: string) => { cols = c; return q; };
        for (const m of ["order", "gte", "lte", "not", "eq"]) q[m] = () => q;
        q.in = (_c: string, list: unknown[]) => { ids = list; return q; };
        const done = () => { calls.push({ table, cols, ids }); return { data: responder(table, cols, { ids }), error: null, count: null }; };
        q.range = () => Promise.resolve(done());
        q.then = (res: (v: unknown) => unknown) => Promise.resolve(done()).then(res);
        return q;
      },
    } as unknown as SupabaseClient;
    return { db, calls };
  }

  it("getRecentDays reads many instruments in ONE request and keeps only the newest N each", async () => {
    const { db, calls } = fake(() => ["a", "b", "c", "d"].map((d, i) => ({ instrument_id: 1, date: d, close: i })).concat([{ instrument_id: 2, date: "a", close: 9 }]));
    const m = await createSupabaseRepo(db).getRecentDays([1, 2], 2);
    expect(calls.filter((c) => c.table === "daily_prices")).toHaveLength(1);
    expect(m.get(1)!.map((d) => d.date)).toEqual(["c", "d"]);
    expect(m.get(2)!.map((d) => d.date)).toEqual(["a"]);
  });
  it("getLevelsMany is one request for all ids", async () => {
    const { db, calls } = fake(() => [{ instrument_id: 2, manual_support: 5, manual_resistance: null, auto_support: null, auto_resistance: null }]);
    const m = await createSupabaseRepo(db).getLevelsMany([1, 2, 3]);
    expect(calls).toHaveLength(1);
    expect(m.get(2)!.manualSupport).toBe(5);
    expect(m.get(1)!.manualSupport).toBeNull();
  });
  it("listConstituentsMany is one request and groups members by index", async () => {
    const row = (k: string, id: number) => ({ index_key: k, instruments: { id, key: `S${id}`, name: "n", type: "stock", yahoo_ticker: "t", active: true } });
    const { db, calls } = fake(() => [row("A", 1), row("B", 2), row("A", 3)]);
    const m = await createSupabaseRepo(db).listConstituentsMany(["A", "B", "C"]);
    expect(calls).toHaveLength(1);
    expect(m.get("A")!.map((i) => i.id)).toEqual([1, 3]);
    expect(m.get("C")).toEqual([]);
  });
  it("getChartDays selects only the chart columns", async () => {
    const { db, calls } = fake(() => []);
    await createSupabaseRepo(db).getChartDays(7, 100);
    expect(calls[0]!.cols).toContain("ema200");
    expect(calls[0]!.cols).not.toContain("score_components");
    expect(calls[0]!.cols).not.toContain("*");
  });
  it("listSnapshotSummaries never reads the large breakdown column", async () => {
    const { db, calls } = fake(() => [{
      instrument_id: 1, symbol: "AAA", evaluation_date: "d", scoring_version: "enhanced_v2", technical_score: 70, trade_quality_score: 60, fundamental_score: null,
      data_confidence: 95, data_timestamp: "t", tcov: 0.9, qcov: 1, qrank: true, qobs: "Wait for pullback", cstat: "OK", metrics: { rsi: 60 }, shares: { volume: 50 },
    }]);
    const [s] = await createSupabaseRepo(db).listSnapshotSummaries({ version: "enhanced_v2", date: "d" });
    expect(calls[0]!.cols).not.toContain("category_breakdown");
    expect(s).toMatchObject({ symbol: "AAA", technicalScore: 70, fundamentalScore: null, categoryBreakdown: {} });
    expect(s!.dataCoverage).toMatchObject({ technical: { coverage: 0.9 }, tradeQuality: { rankable: true, observation: "Wait for pullback" }, confidence: { status: "OK" }, metrics: { rsi: 60 }, categoryShares: { volume: 50 } });
  });
});
