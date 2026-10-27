import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";

function fakeDb(total: number) {
  const ranges: [number, number][] = [];
  const db = {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.order = () => q; q.in = () => q; q.eq = () => q;
      q.range = (a: number, b: number) => {
        ranges.push([a, b]);
        const data = [];
        for (let i = a; i <= Math.min(b, total - 1); i++) data.push({ id: i + 1, key: `K${i}`, name: "n", type: "stock", yahoo_ticker: `K${i}.NS`, active: true });
        return Promise.resolve({ data, error: null });
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, ranges };
}

describe("listInstruments paging", () => {
  it("reads past the 1000-row cap", async () => {
    const { db, ranges } = fakeDb(2357);
    const rows = await createSupabaseRepo(db).listInstruments();
    expect(rows).toHaveLength(2357);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("stops after a short first page", async () => {
    const { db, ranges } = fakeDb(5);
    expect(await createSupabaseRepo(db).listInstruments()).toHaveLength(5);
    expect(ranges).toHaveLength(1);
  });
});

describe("getDaysRange paging", () => {
  it("pages past 1000 rows and groups rows per instrument", async () => {
    const ranges: [number, number][] = [];
    const total = 2100;
    const db = {
      from: () => {
        const q: Record<string, unknown> = {};
        q.select = () => q; q.order = () => q; q.in = () => q; q.gte = () => q; q.lte = () => q;
        q.range = (a: number, b: number) => {
          ranges.push([a, b]);
          const data = [];
          for (let i = a; i <= Math.min(b, total - 1); i++) data.push({ instrument_id: 1 + Math.floor(i / 1050), date: `d${i}` });
          return Promise.resolve({ data, error: null });
        };
        return q;
      },
    } as unknown as SupabaseClient;
    const m = await createSupabaseRepo(db).getDaysRange([1, 2], "a", "b");
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(m.get(1)).toHaveLength(1050);
    expect(m.get(2)).toHaveLength(1050);
  });
});

describe("getOhlcvRange", () => {
  // one row per requested id per page slot; records every select string and id list
  function fake(rowsPerId: number) {
    const selects: string[] = [];
    const idLists: number[][] = [];
    const ranges: [number, number][] = [];
    const db = {
      from: () => {
        let ids: number[] = [];
        const q: Record<string, unknown> = {};
        q.select = (cols: string) => { selects.push(cols); return q; };
        q.order = () => q; q.gte = () => q; q.lte = () => q;
        q.in = (_c: string, list: number[]) => { ids = list; idLists.push(list); return q; };
        q.range = (a: number, b: number) => {
          ranges.push([a, b]);
          const all = ids.flatMap((id) => Array.from({ length: rowsPerId }, (_, k) => ({ instrument_id: id, date: `d${k}`, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, pct_change: 0.01, imported_pct: null })));
          return Promise.resolve({ data: all.slice(a, b + 1), error: null });
        };
        return q;
      },
    } as unknown as SupabaseClient;
    return { db, selects, idLists, ranges };
  }

  it("reads only the OHLCV columns, in parallel chunks of 20 ids, grouped per instrument", async () => {
    const { db, selects, idLists } = fake(1);
    const ids = Array.from({ length: 45 }, (_, i) => i + 1);
    const m = await createSupabaseRepo(db).getOhlcvRange(ids, "a", "b");
    expect(idLists.map((l) => l.length)).toEqual([20, 20, 5]);
    expect(new Set(selects).size).toBe(1);
    expect(selects[0]).not.toContain("*");
    expect(selects[0]).toContain("pct_change");
    expect(m.size).toBe(45);
    expect(m.get(7)).toEqual([{ date: "d0", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, pctChange: 0.01, importedPct: null }]);
  });
  it("keeps paging within a chunk that fills a page", async () => {
    const { db, ranges } = fake(1005);
    const m = await createSupabaseRepo(db).getOhlcvRange([1], "a", "b");
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(m.get(1)).toHaveLength(1005);
  });
});

describe("backtest runs", () => {
  const M = {
    totalReturn: 0.5, cagr: 0.1, maxDrawdown: -0.2, volatility: 0.15, sharpe: 0.8, hitRate: 0.55, avgWinPct: 0.03,
    avgLossPct: -0.02, trades: 10, turnoverPerYear: 8, timeInvested: 0.7,
  };
  const input = {
    name: "run", strategy: { id: "alpha:a101", label: "Alpha #101", params: { alpha: "a101", top: 10 } },
    settings: { capital: 1000000, maxPositions: 10, holdSessions: 5, stopPct: null, from: "2020-01-01", to: "2026-10-27" },
    metrics: { strategy: M, benchmark: M }, equity: [["2020-01-01", 1000000, 1000000]] as [string, number, number][], trades: [],
    dataThrough: "2026-10-27", universeNote: "note",
  };
  const row = {
    id: 7, created_at: "2026-10-27T10:00:00Z", name: "run", strategy: input.strategy, settings: input.settings, metrics: input.metrics,
    data_through: "2026-10-27", equity: input.equity, trades: [], universe_note: "note",
  };

  it("saveBacktestRun inserts snake_case columns and returns the new id", async () => {
    const calls: unknown[] = [];
    const db = {
      from: (table: string) => {
        const q: Record<string, unknown> = {};
        q.insert = (r: unknown) => { calls.push({ table, insert: r }); return q; };
        q.select = (cols: string) => { calls.push({ select: cols }); return q; };
        q.single = () => Promise.resolve({ data: { id: 7 }, error: null });
        return q;
      },
    } as unknown as SupabaseClient;
    expect(await createSupabaseRepo(db).saveBacktestRun(input)).toBe(7);
    expect(calls[0]).toEqual({
      table: "backtest_runs",
      insert: {
        name: "run", strategy: input.strategy, settings: input.settings, metrics: input.metrics, equity: input.equity, trades: [],
        data_through: "2026-10-27", universe_note: "note",
      },
    });
  });

  it("listBacktestRuns selects only the light columns, newest first, mapped to camelCase", async () => {
    const calls: unknown[] = [];
    const db = {
      from: () => {
        const q: Record<string, unknown> = {};
        q.select = (cols: string) => { calls.push({ select: cols }); return q; };
        q.order = (col: string, o: unknown) => { calls.push({ order: [col, o] }); return Promise.resolve({ data: [row], error: null }); };
        return q;
      },
    } as unknown as SupabaseClient;
    const list = await createSupabaseRepo(db).listBacktestRuns();
    expect(calls).toEqual([{ select: "id,created_at,name,strategy,settings,metrics,data_through" }, { order: ["id", { ascending: false }] }]);
    expect(list).toEqual([{
      id: 7, createdAt: "2026-10-27T10:00:00Z", name: "run", strategy: input.strategy, settings: input.settings,
      metrics: input.metrics, dataThrough: "2026-10-27",
    }]);
  });

  it("getBacktestRun maps every column, and gives null when there is no row", async () => {
    const fake = (data: unknown) => ({
      from: () => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.maybeSingle = () => Promise.resolve({ data, error: null });
        return q;
      },
    }) as unknown as SupabaseClient;
    expect(await createSupabaseRepo(fake(row)).getBacktestRun(7)).toEqual({
      id: 7, createdAt: "2026-10-27T10:00:00Z", name: "run", strategy: input.strategy, settings: input.settings, metrics: input.metrics,
      dataThrough: "2026-10-27", equity: input.equity, trades: [], universeNote: "note",
    });
    expect(await createSupabaseRepo(fake(null)).getBacktestRun(8)).toBeNull();
  });
});
