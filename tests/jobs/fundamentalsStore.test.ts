import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FIELDS, toRow } from "@/lib/calc/fundamentals";
import { storeRows } from "@/lib/jobs/fundamentals";

const ctx = (id: number) => ({ instrumentId: id, fetchedOn: "2026-11-08", isFinancial: id % 2 === 0 });
const good = (id: number) => ({ row: toRow({ financialData: { returnOnEquity: 0.2 } }, ctx(id)), failed: false });
const failedRow = (id: number) => ({ row: toRow(null, ctx(id)), failed: true });

function fakeDb(error: string | null = null) {
  const calls: { table: string; records: Record<string, unknown>[]; opts: Record<string, unknown> }[] = [];
  const db = {
    from: (table: string) => ({
      upsert: (records: Record<string, unknown>[], opts: Record<string, unknown>) => {
        calls.push({ table, records, opts });
        return Promise.resolve({ error: error ? { message: error } : null });
      },
    }),
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("storeRows", () => {
  it("upserts fetched rows normally, with the table's primary key as the conflict target", async () => {
    const { db, calls } = fakeDb();
    await storeRows(db, [good(1), good(2)], new Date("2026-11-08T10:00:00Z"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "fundamentals_snapshots", opts: { onConflict: "instrument_id,fetched_on" } });
    expect(calls[0].opts.ignoreDuplicates).toBeUndefined();
    expect(calls[0].records[0]).toMatchObject({ instrument_id: 1, fetched_on: "2026-11-08", is_financial: false, return_on_equity: 0.2, fetched_at: "2026-11-08T10:00:00.000Z" });
    expect(calls[0].records[0].missing).toHaveLength(FIELDS.length - 1);
  });

  it("stores failed rows with ignoreDuplicates, so a bad re-run never overwrites a good row", async () => {
    const { db, calls } = fakeDb();
    await storeRows(db, [good(1), failedRow(2), failedRow(3)], new Date());
    const ignoring = calls.filter((c) => c.opts.ignoreDuplicates === true);
    expect(ignoring).toHaveLength(1);
    expect(ignoring[0].records.map((r) => r.instrument_id)).toEqual([2, 3]);
    expect(calls.filter((c) => c.opts.ignoreDuplicates !== true).flatMap((c) => c.records.map((r) => r.instrument_id))).toEqual([1]);
  });

  it("writes in batches of 100 and writes nothing for an empty list", async () => {
    const many = Array.from({ length: 250 }, (_, i) => good(i + 1));
    const a = fakeDb();
    await storeRows(a.db, many, new Date());
    expect(a.calls.map((c) => c.records.length)).toEqual([100, 100, 50]);
    const b = fakeDb();
    await storeRows(b.db, [], new Date());
    expect(b.calls).toHaveLength(0);
  });

  it("throws when a write fails", async () => {
    await expect(storeRows(fakeDb("boom").db, [good(1)], new Date())).rejects.toThrow("write failed: boom");
  });
});
