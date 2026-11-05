// Runs the resumable snapshot job to completion from the command line (same code as /api/cron/snapshots).
// Usage: tsx scripts/run-snapshots.ts [--batch-size N]
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSnapshotBatch } from "@/lib/jobs/snapshots";

async function main() {
  process.loadEnvFile(".env.local");
  const repo = createSupabaseRepo(createAdminClient());
  const i = process.argv.indexOf("--batch-size");
  const batchSize = i >= 0 ? Number(process.argv[i + 1]) : undefined;
  for (let n = 1; n <= 20; n++) {
    const t = Date.now();
    const r = await runSnapshotBatch({ repo, now: new Date(), batchSize });
    console.log(`batch ${n}: ${r.status} | cursor ${r.nextOffset}/${r.total} | processed ${r.processed} | failed ${r.failed.length} | ${((Date.now() - t) / 1000).toFixed(1)}s | ${r.message}`);
    if (!r.more) return;
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
