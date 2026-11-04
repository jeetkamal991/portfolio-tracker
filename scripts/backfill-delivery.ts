import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { runDelivery } from "@/lib/jobs/delivery";
import { createAdminClient } from "@/lib/supabase/admin";

// Usage: npm run backfill-delivery [-- --days 35]   (calendar days back from today; 35 covers ~24 sessions)
async function main() {
  process.loadEnvFile(".env.local");
  const i = process.argv.indexOf("--days");
  const days = i >= 0 ? Number(process.argv[i + 1]) : 35;
  if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error("--days needs a whole number from 1 to 400");
  const run = await runDelivery(createSupabaseRepo(createAdminClient()), new Date(), days);
  console.log(`fetched ${run.fetched.length}: ${run.fetched.join(", ") || "-"}`);
  console.log(`not published (holiday / not out yet) ${run.unavailable.length}: ${run.unavailable.join(", ") || "-"}`);
  console.log(`failed ${run.failed.length}${run.failed.length ? ": " + run.failed.join("; ") : ""}`);
  if (run.failed.length > 0) process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
