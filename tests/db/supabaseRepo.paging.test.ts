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
