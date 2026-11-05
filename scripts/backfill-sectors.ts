// Backfills sector-index history from the provider and verifies integrity. Idempotent: upserts OHLCV by
// (instrument, date) and recomputes indicators; never touches imported_pct or any score column.
// Usage: tsx scripts/backfill-sectors.ts [--verify-only] [--from YYYY-MM-DD]
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { backfillInstrument } from "@/lib/jobs/backfill";
import { createYahooProvider } from "@/lib/provider/yahoo";
import { createAdminClient } from "@/lib/supabase/admin";
import { SECTOR_KEYS } from "@/lib/instruments";
import { sessionCalendar } from "@/lib/calc/returns";

const MIN_SESSIONS = 300;

async function main() {
  process.loadEnvFile(".env.local");
  const verifyOnly = process.argv.includes("--verify-only");
  const fi = process.argv.indexOf("--from");
  const from = fi >= 0 ? process.argv[fi + 1]! : "2024-01-01";
  const repo = createSupabaseRepo(createAdminClient());
  const deps = { repo, provider: createYahooProvider(), now: new Date() };

  const nifty = await repo.getInstrumentByKey("NIFTY50");
  if (!nifty) throw new Error("NIFTY50 missing");
  const niftyDays = (await repo.getDays(nifty.id, 5000)).filter((d) => d.close !== null);
  const cal = sessionCalendar(niftyDays.map((d) => d.date));

  for (const key of SECTOR_KEYS) {
    const inst = await repo.getInstrumentByKey(key);
    if (!inst) { console.log(`${key}: instrument not found`); continue; }
    const before = (await repo.getDays(inst.id, 5000)).filter((d) => d.close !== null).length;
    if (!verifyOnly && before < MIN_SESSIONS) {
      try {
        const n = await backfillInstrument(deps, inst, from);
        console.log(`${key}: provider returned ${n} candles`);
      } catch (e) {
        console.log(`${key}: backfill FAILED: ${e instanceof Error ? e.message : e}`);
      }
    }
    const days = (await repo.getDays(inst.id, 5000)).filter((d) => d.close !== null);
    const dates = new Set(days.map((d) => d.date));
    const first = days[0]?.date, lastD = days[days.length - 1]?.date;
    const span = cal.dates.filter((d) => first !== undefined && d >= first && d <= (lastD as string));
    const gaps = span.filter((d) => !dates.has(d));
    const offCal = days.filter((d) => !cal.index.has(d.date)).map((d) => d.date);
    const badPrice = days.filter((d) => !(d.close! > 0) || (d.high !== null && d.low !== null && (d.high < d.low || d.close! > d.high * 1.0001 || d.close! < d.low * 0.9999))).length;
    const jumps = days.filter((d) => d.pctChange !== null && Math.abs(d.pctChange) > 0.1).map((d) => `${d.date}:${(d.pctChange! * 100).toFixed(1)}%`);
    const mism = days.filter((d) => d.pctChange !== null && d.importedPct !== null && Math.abs(d.pctChange - d.importedPct) > 0.0005).length;
    const withEma200 = days.filter((d) => d.ema200 !== null).length;
    console.log(
      `${key.padEnd(18)} rows ${String(before).padStart(4)} -> ${String(days.length).padStart(4)}  ${first}..${lastD}  nifty-session gaps ${gaps.length}` +
      `${gaps.length ? ` (${gaps.slice(0, 4).join(",")}${gaps.length > 4 ? ",…" : ""})` : ""}  off-calendar ${offCal.length}  bad-price ${badPrice}  >10% jumps ${jumps.length}${jumps.length ? ` (${jumps.join(",")})` : ""}  pct-vs-imported mismatches ${mism}  ema200 rows ${withEma200}  ${days.length >= MIN_SESSIONS ? "OK" : "INSUFFICIENT"}`,
    );
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
