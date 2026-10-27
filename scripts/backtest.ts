import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { backtestAndSave, formatRun, parseBacktestArgs } from "@/lib/jobs/backtest";
import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  process.loadEnvFile(".env.local");
  const opts = parseBacktestArgs(process.argv.slice(2));
  const repo = createSupabaseRepo(createAdminClient());
  const started = Date.now();
  const { run, report, id } = await backtestAndSave(repo, opts);
  console.log(formatRun(run, report));
  console.log(`\nRan in ${Math.round((Date.now() - started) / 1000)} s.`);
  console.log(id === null ? "Dry run: nothing saved." : `Saved as run ${id}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
