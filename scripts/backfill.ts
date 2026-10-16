import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { backfillInstrument } from "@/lib/jobs/backfill";
import { createYahooProvider } from "@/lib/provider/yahoo";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, istDate } from "@/lib/time/ist";

const THIN_BELOW = 200;

function fromArg(): string | null {
  const i = process.argv.indexOf("--from");
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (i < 0) return null;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("--from needs a YYYY-MM-DD date");
  return v;
}

async function main() {
  process.loadEnvFile(".env.local");
  const now = new Date();
  const from = fromArg() ?? addDays(istDate(now), -730);
  const repo = createSupabaseRepo(createAdminClient());
  const deps = { repo, provider: createYahooProvider(), now };

  const all = await repo.listInstruments({ types: ["index", "sector"], activeOnly: true });
  const ordered = [...all.filter((i) => i.key === "NIFTY50"), ...all.filter((i) => i.key !== "NIFTY50")];
  console.log(`Back-filling ${ordered.length} instruments from ${from}`);

  let failed = 0;
  for (const inst of ordered) {
    try {
      const n = await backfillInstrument(deps, inst, from);
      console.log(`${inst.key.padEnd(20)} ${String(n).padStart(6)} candles${n < THIN_BELOW ? "  THIN" : ""}`);
    } catch (e) {
      failed++;
      console.error(`${inst.key.padEnd(20)} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
