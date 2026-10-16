import { existsSync, readFileSync } from "node:fs";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { INDEX_INSTRUMENTS, parseEquityCsv } from "@/lib/instruments";
import { createAdminClient } from "@/lib/supabase/admin";

const CSV_PATH = "data/EQUITY_L.csv";

async function main() {
  if (!existsSync(CSV_PATH)) {
    throw new Error(`${CSV_PATH} not found. Download "Securities available for Equity segment" from nseindia.com into data/.`);
  }
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  else throw new Error(".env.local not found (needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).");
  const stocks = parseEquityCsv(readFileSync(CSV_PATH, "utf8"));
  const repo = createSupabaseRepo(createAdminClient());
  await repo.upsertInstruments([...INDEX_INSTRUMENTS, ...stocks]);
  console.log(`Seeded ${INDEX_INSTRUMENTS.length} indices/sectors and ${stocks.length} stocks.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
