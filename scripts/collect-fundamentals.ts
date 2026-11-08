import YahooFinance from "yahoo-finance2";
import { coverage, FIELDS, formatCoverage, isFinancial, toRow } from "@/lib/calc/fundamentals";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { storeRows, type StoredRow } from "@/lib/jobs/fundamentals";
import { pool } from "@/lib/jobs/pool";
import { withRetry } from "@/lib/provider/retry";
import { createAdminClient } from "@/lib/supabase/admin";
import { istDate } from "@/lib/time/ist";
import { listUniverseStocks } from "@/lib/universe/stocks";

// Usage: npm run collect-fundamentals [-- --dry-run] [-- --only TCS,INFY] [-- --report]
//   (no flag)  fetch every stock in the universe and store one row each for today
//   --dry-run  fetch and print coverage, write nothing
//   --only     restrict to these instrument keys
//   --report   no fetching: print coverage of the latest stored fetch
const TABLE = "fundamentals_snapshots";
const CONCURRENCY = 4;
const PAUSE_MS = 300;
const MODULES = ["assetProfile", "financialData", "summaryDetail", "defaultKeyStatistics"] as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function report(db: ReturnType<typeof createAdminClient>) {
  const latest = await db.from(TABLE).select("fetched_on").order("fetched_on", { ascending: false }).limit(1);
  if (latest.error) throw new Error(latest.error.message);
  const date = latest.data?.[0]?.fetched_on as string | undefined;
  if (!date) { console.log("No fundamentals stored yet."); return; }
  const rows = await db.from(TABLE).select("is_financial,missing").eq("fetched_on", date);
  if (rows.error) throw new Error(rows.error.message);
  console.log(`Latest fetch ${date}: ${rows.data.length} stocks`);
  console.log(formatCoverage(coverage(rows.data.map((r) => ({ isFinancial: r.is_financial as boolean, missing: r.missing as string[] })))));
}

async function main() {
  process.loadEnvFile(".env.local");
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyAt = args.indexOf("--only");
  const only = onlyAt >= 0 ? (args[onlyAt + 1] ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
  if (args.includes("--report") && (dryRun || only)) throw new Error("--report cannot be combined with --dry-run or --only");
  const db = createAdminClient();
  if (args.includes("--report")) return report(db);
  if (onlyAt >= 0 && (!only || only.length === 0)) throw new Error("--only needs a comma-separated list of instrument keys");

  const repo = createSupabaseRepo(db);
  let stocks = await listUniverseStocks(repo);
  if (only) {
    const unknown = only.filter((k) => !stocks.some((s) => s.key === k));
    if (unknown.length > 0) throw new Error(`Not in the stock universe: ${unknown.join(", ")}`);
    stocks = stocks.filter((s) => only.includes(s.key));
  }
  const indexesOf = new Map<number, string[]>();
  for (const m of await repo.listMemberships()) indexesOf.set(m.instrumentId, [...(indexesOf.get(m.instrumentId) ?? []), m.indexKey]);

  const fetchedOn = istDate(new Date());
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
  const rows: StoredRow[] = [];
  const keyOf = new Map<number, string>();
  const failed: string[] = [];
  console.log(`Fetching ${stocks.length} stocks for ${fetchedOn}${dryRun ? " (dry run: nothing is written)" : ""}`);
  await pool(stocks, CONCURRENCY, async (s) => {
    const ctx = { instrumentId: s.id, fetchedOn, isFinancial: isFinancial(indexesOf.get(s.id) ?? []) };
    keyOf.set(s.id, s.key);
    try {
      const summary = await withRetry(() => yf.quoteSummary(s.yahooTicker, { modules: [...MODULES] }, { validateResult: false }), 3, 1000);
      rows.push({ row: toRow(summary, { ...ctx, isFinancial: isFinancial(indexesOf.get(s.id) ?? [], summary) }), failed: false });
    } catch (e) {
      // an unknown or failing symbol is stored with every field missing, never skipped
      failed.push(`${s.key} (${s.yahooTicker}): ${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
      rows.push({ row: toRow(null, ctx), failed: true });
    }
    await sleep(PAUSE_MS);
  });

  if (!dryRun) {
    await storeRows(db, rows, new Date());
    console.log(`Stored ${rows.length} rows`);
  }

  console.log(`Failed fetches: ${failed.length}${failed.length ? "\n  " + failed.join("\n  ") : ""}`);
  console.log(formatCoverage(coverage(rows.map((r) => r.row))));
  const worst = rows.map((r) => r.row).sort((a, b) => b.missing.length - a.missing.length).slice(0, 10);
  console.log("Most missing fields:");
  for (const r of worst) console.log(`  ${(keyOf.get(r.instrumentId) ?? String(r.instrumentId)).padEnd(14)} ${r.missing.length}/${FIELDS.length} missing${r.isFinancial ? " (financial)" : ""}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
