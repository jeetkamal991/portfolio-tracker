// Re-evaluates the CURRENT evaluation date with the current code and upserts the same (instrument, date, version) rows.
// For use after a scoring-code improvement that does not change the methodology version (here: added filter metrics and the
// known-price-break reset). Idempotent, never creates a second row, never touches score_runs or daily_prices (legacy_v1).
// Usage: tsx scripts/refresh-snapshots.ts
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildContext, evaluateStock, orderedUniverse } from "@/lib/jobs/snapshots";
import { pool } from "@/lib/jobs/pool";
import type { ScoreSnapshot } from "@/lib/db/types";

async function main() {
  process.loadEnvFile(".env.local");
  const repo = createSupabaseRepo(createAdminClient());
  const universe = await orderedUniverse(repo);
  const ctx = await buildContext(repo, universe);
  const rows: ScoreSnapshot[] = [];
  const failed: string[] = [];
  await pool(universe, 8, async (inst) => {
    try {
      const s = await evaluateStock(ctx, inst);
      if (s) rows.push(s);
    } catch (e) {
      failed.push(`${inst.key}: ${e instanceof Error ? e.message : e}`);
    }
  });
  await repo.upsertSnapshots(rows);
  console.log(`refreshed ${rows.length} of ${universe.length} snapshots for ${ctx.evaluationDate}; failed ${failed.length}${failed.length ? ": " + failed.join("; ") : ""}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
