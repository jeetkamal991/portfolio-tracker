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
