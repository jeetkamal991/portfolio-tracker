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
  // Like real PostgREST: a select with { count: "exact" } also returns the filtered total.
  function rangeDb(total: number) {
    const ranges: [number, number][] = [];
    const counted: boolean[] = [];
    const db = {
      from: () => {
        let withCount = false;
        const q: Record<string, unknown> = {};
        q.select = (_c: string, opts?: { count?: string }) => { withCount = opts?.count === "exact"; return q; };
        q.order = () => q; q.in = () => q; q.gte = () => q; q.lte = () => q; q.not = () => q;
        q.range = (a: number, b: number) => {
          ranges.push([a, b]);
          counted.push(withCount);
          const data = [];
          for (let i = a; i <= Math.min(b, total - 1); i++) data.push({ instrument_id: 1 + Math.floor(i / 1050), date: `d${i}` });
          return Promise.resolve({ data, error: null, count: withCount ? total : null });
        };
        return q;
      },
    } as unknown as SupabaseClient;
    return { db, ranges, counted };
  }

  it("pages past 1000 rows and groups rows per instrument", async () => {
    const { db, ranges } = rangeDb(2100);
    const m = await createSupabaseRepo(db).getDaysRange([1, 2], "a", "b");
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(m.get(1)).toHaveLength(1050);
    expect(m.get(2)).toHaveLength(1050);
  });
  it("asks for the total once, with the first page, and requests every remaining page together", async () => {
    const { db, counted } = rangeDb(4500);
    await createSupabaseRepo(db).getDaysRange([1], "a", "b");
    expect(counted).toEqual([true, false, false, false, false]); // 5 pages: 1 counted + 4 in parallel, not 5 in a row
  });
  it("a result under one page costs a single request", async () => {
    const { db, ranges } = rangeDb(300);
    await createSupabaseRepo(db).getDaysRange([1], "a", "b");
    expect(ranges).toEqual([[0, 999]]);
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
