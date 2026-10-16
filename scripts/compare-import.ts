import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";

const TOL = 0.0005;

async function main() {
  process.loadEnvFile(".env.local");
  const repo = createSupabaseRepo(createAdminClient());
  const insts = await repo.listInstruments({ types: ["index", "sector"], activeOnly: true });
  let compared = 0;
  let mismatches = 0;
  for (const inst of insts) {
    const days = await repo.getDays(inst.id, 5000);
    for (const d of days) {
      if (d.pctChange === null || d.importedPct === null) continue;
      compared++;
      const diff = Math.abs(d.pctChange - d.importedPct);
      if (diff > TOL) {
        mismatches++;
        console.log(`${inst.key.padEnd(18)} ${d.date} provider=${d.pctChange.toFixed(6)} imported=${d.importedPct.toFixed(6)} diff=${diff.toFixed(6)}`);
      }
    }
  }
  console.log(`compared=${compared} mismatches=${mismatches}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
