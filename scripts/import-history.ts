import { readFileSync } from "node:fs";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { parseHistoryWorkbook } from "@/lib/import/history";
import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const { rows, report } = await parseHistoryWorkbook(readFileSync("data/history.xlsx"));
  console.log(`sheets=${report.sheets} dates=${report.dates} values=${report.values} blanks=${report.blanks}`);
  console.log(`outliers (|pct|>0.1): ${report.outliers.length}`);
  for (const o of report.outliers) console.log(`  ${o.key} ${o.date} ${o.pct}`);
  console.log(`unknown headers: ${report.unknownHeaders.length ? report.unknownHeaders.join(", ") : "none"}`);
  if (dry) { console.log("dry run: nothing written"); return; }

  process.loadEnvFile(".env.local");
  const repo = createSupabaseRepo(createAdminClient());
  const ids = new Map<string, number>();
  for (const key of new Set(rows.map((r) => r.key))) {
    const inst = await repo.getInstrumentByKey(key);
    if (!inst) throw new Error(`Instrument not found: ${key}`);
    ids.set(key, inst.id);
  }
  const payload = rows.map((r) => ({ instrumentId: ids.get(r.key)!, date: r.date, importedPct: r.pct }));
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) await repo.upsertImportedPct(payload.slice(i, i + CHUNK));
  console.log(`wrote ${payload.length} imported_pct values`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
