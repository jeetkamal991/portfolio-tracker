import type { SupabaseClient } from "@supabase/supabase-js";
import { FIELDS, type FundamentalsRow } from "@/lib/calc/fundamentals";

const TABLE = "fundamentals_snapshots";
const BATCH = 100;

export interface StoredRow { row: FundamentalsRow; failed: boolean }

const record = (r: FundamentalsRow, now: Date) => ({
  instrument_id: r.instrumentId, fetched_on: r.fetchedOn, is_financial: r.isFinancial,
  ...Object.fromEntries(FIELDS.map((f) => [f.column, r.values[f.key]])),
  missing: r.missing, raw: r.raw, fetched_at: now.toISOString(),
});

/**
 * Upserts fetched rows (replacing the same day's earlier row), but writes rows whose fetch failed with ignoreDuplicates,
 * so a re-run that hits a Yahoo error can only fill a gap and never overwrite a good row with an empty one.
 */
export async function storeRows(db: SupabaseClient, rows: StoredRow[], now: Date): Promise<void> {
  const groups = [
    { items: rows.filter((r) => !r.failed), opts: { onConflict: "instrument_id,fetched_on" } },
    { items: rows.filter((r) => r.failed), opts: { onConflict: "instrument_id,fetched_on", ignoreDuplicates: true } },
  ];
  for (const g of groups) {
    for (let i = 0; i < g.items.length; i += BATCH) {
      const { error } = await db.from(TABLE).upsert(g.items.slice(i, i + BATCH).map((s) => record(s.row, now)), g.opts);
      if (error) throw new Error(`write failed: ${error.message}`);
    }
  }
}
