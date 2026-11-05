// READ-ONLY summary of the latest enhanced_v2 snapshots: coverage, confidence and the two separate rankings.
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";
import { SCORING_VERSION } from "@/lib/calc/scoreV2/config";
import { rankSnapshots } from "@/lib/view/snapshotRank";

async function main() {
  process.loadEnvFile(".env.local");
  const repo = createSupabaseRepo(createAdminClient());
  const nifty = await repo.getInstrumentByKey("NIFTY50");
  const date = (await repo.getLatestDay(nifty!.id))!.date;
  const rows = await repo.listSnapshots({ version: SCORING_VERSION, date });
  const run = await repo.getScoreRun(date, SCORING_VERSION);
  console.log(`version ${SCORING_VERSION}, date ${date}: ${rows.length} snapshots, ${new Set(rows.map((r) => r.instrumentId)).size} distinct instruments`);
  console.log(`run: ${JSON.stringify({ status: run?.status, total: run?.total, processed: run?.processed, nextOffset: run?.nextOffset, batches: run?.batches, failed: run?.failed.length })}`);
  type Cov = { technical: { coverage: number; status: string }; tradeQuality: { coverage: number; rankable: boolean; observation: string }; confidence: { score: number; status: string; stale: boolean } };
  const cov = rows.map((r) => r.dataCoverage as Cov);
  const n = (f: (c: Cov) => boolean) => cov.filter(f).length;
  console.log(`technical coverage: =100% ${n((c) => c.technical.coverage >= 1)}, >=90% ${n((c) => c.technical.coverage >= 0.9)}, >=80% ${n((c) => c.technical.coverage >= 0.8)}, <80% ${n((c) => c.technical.coverage < 0.8)}`);
  console.log(`trade quality: coverage >=80% ${n((c) => c.tradeQuality.coverage >= 0.8)}, rankable ${n((c) => c.tradeQuality.rankable)}, not rankable ${n((c) => !c.tradeQuality.rankable)}`);
  const conf = cov.map((c) => c.confidence.score);
  console.log(`data confidence: min ${Math.min(...conf)}, avg ${(conf.reduce((s, x) => s + x, 0) / conf.length).toFixed(1)}, max ${Math.max(...conf)}; LOW CONFIDENCE ${n((c) => c.confidence.status === "LOW CONFIDENCE")}; stale ${n((c) => c.confidence.stale)}`);
  console.log(`scores null: technical ${rows.filter((r) => r.technicalScore === null).length}, trade ${rows.filter((r) => r.tradeQualityScore === null).length}; fundamental non-null ${rows.filter((r) => r.fundamentalScore !== null).length}`);
  for (const kind of ["technical", "tradeQuality"] as const) {
    const r = rankSnapshots(rows, { version: SCORING_VERSION, kind });
    const why = new Map<string, number>();
    for (const e of r.excluded) why.set(e.reason.replace(/\d+%/g, "N%"), (why.get(e.reason.replace(/\d+%/g, "N%")) ?? 0) + 1);
    console.log(`\n${kind} ranking: ${r.ranked.length} ranked, ${r.excluded.length} excluded`);
    console.log("  top 5:", r.ranked.slice(0, 5).map((x) => `${x.symbol} ${x.score.toFixed(0)}`).join(", "));
    console.log("  excluded because:", [...why.entries()].map(([k, c]) => `${k} x${c}`).join(" | "));
  }
  const trent = rows.find((r) => r.symbol === "TRENT");
  console.log(`\nTRENT (after correction): technical ${trent?.technicalScore}, trade ${trent?.tradeQualityScore}, confidence ${trent?.dataConfidence}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
