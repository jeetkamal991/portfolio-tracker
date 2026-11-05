// Corrects a CONFIRMED mis-adjusted stretch of stored prices, with a full audit trail. DRY RUN unless --apply.
//
//   tsx scripts/correct-price-history.ts --key TRENT --before 2026-01-01 --factor 1.5 --reason "..." --source "..."          (plan only)
//   tsx scripts/correct-price-history.ts ... --apply                                                                         (audit rows, then prices, indicators, levels, score)
//   tsx scripts/correct-price-history.ts --revert <batch_id> [--apply]                                                      (restore the audited old values)
//
// Open/high/low/close of every bar dated before --before are divided by --factor. Volume is NOT touched: whether Yahoo
// adjusted it on the same boundary cannot be proven from the data (see the report), and the stretch is outside every
// volume window the scores use today. Old values are written to price_corrections BEFORE any price changes.
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCloses, recomputeInstrument } from "@/lib/jobs/eod";
import { scorePass } from "@/lib/jobs/score";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FIELDS = ["open", "high", "low", "close"] as const;
const round = (x: number) => Math.round(x * 1e6) / 1e6;

async function main() {
  process.loadEnvFile(".env.local");
  const apply = process.argv.includes("--apply");
  const db = createAdminClient();
  const repo = createSupabaseRepo(db);

  const revert = arg("--revert");
  if (revert) return doRevert(revert, apply);

  const key = arg("--key"), before = arg("--before"), factor = Number(arg("--factor")), reason = arg("--reason"), source = arg("--source");
  if (!key || !before || !(factor > 1) || !reason || !source) throw new Error("need --key --before YYYY-MM-DD --factor (>1) --reason --source");
  const inst = await repo.getInstrumentByKey(key);
  if (!inst) throw new Error(`unknown instrument ${key}`);
  const days = (await repo.getDays(inst.id, 5000)).filter((d) => d.close !== null);
  const target = days.filter((d) => d.date < before);
  const first = days.find((d) => d.date >= before);
  const last = target[target.length - 1];
  if (!first || !last) throw new Error("nothing before/after the boundary");

  // Guard: after dividing, the series must be continuous across the boundary (the open sits at the adjusted prior close).
  const adjustedPrev = last.close! / factor;
  const gap = (first.open ?? first.close!) / adjustedPrev - 1;
  console.log(`${key}: ${target.length} bars dated before ${before} (${target[0]!.date}..${last.date}) will be divided by ${factor}`);
  console.log(`boundary ${last.date} -> ${first.date}: before ${last.close} -> open ${first.open}  (raw step x${((first.open ?? first.close!) / last.close!).toFixed(4)})`);
  console.log(`after correction: ${round(adjustedPrev)} -> open ${first.open}  (step ${(gap * 100).toFixed(2)}%)`);
  if (Math.abs(gap) > 0.02) throw new Error(`corrected series is still discontinuous by ${(gap * 100).toFixed(1)}%: wrong factor or boundary, refusing`);
  const oldLegacy = (await repo.getLatestDay(inst.id))?.score ?? null;
  console.log(`current legacy score on the latest day: ${oldLegacy}`);
  console.log(`audit rows to write: ${target.length * FIELDS.length}; sample: ${last.date} close ${last.close} -> ${round(last.close! / factor)}, open ${last.open} -> ${round(last.open! / factor)}`);
  if (!apply) { console.log("DRY RUN: nothing written. Add --apply to correct."); return; }

  const batch = `fix-${key}-${before}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}`;
  const audit = target.flatMap((d) =>
    FIELDS.filter((f) => d[f] !== null).map((f) => ({
      batch_id: batch, instrument_id: inst.id, date: d.date, field: f, old_value: d[f], new_value: round(d[f]! / factor), factor, reason, source,
    })),
  );
  // 1. Audit first: if this fails nothing has changed.
  for (let i = 0; i < audit.length; i += 500) {
    const { error } = await db.from("price_corrections").insert(audit.slice(i, i + 500));
    if (error) throw new Error(`audit insert failed, no prices changed: ${error.message}`);
  }
  console.log(`audit trail written: batch ${batch} (${audit.length} rows)`);
  // 2. Prices (volume unchanged).
  await repo.upsertCandles(inst.id, target.map((d) => ({
    date: d.date, open: round(d.open! / factor), high: round(d.high! / factor), low: round(d.low! / factor), close: round(d.close! / factor), volume: d.volume ?? 0,
  })));
  // 3. Indicators for every day, and auto support/resistance.
  const nifty = await repo.getInstrumentByKey("NIFTY50");
  await recomputeInstrument(repo, inst, await loadCloses(repo, nifty!.id), { upsertAll: true });
  // 4. The legacy score of the latest day.
  const scored = await scorePass(repo, { onlyIds: new Set([inst.id]) });
  console.log(`indicators and levels recomputed; legacy score refreshed (scored ${scored.scored}, failed ${scored.failed.length})`);
  await verify(key);
  console.log(`legacy score on the latest day: ${oldLegacy} -> ${(await repo.getLatestDay(inst.id))?.score}`);
  console.log(`Revert with: tsx scripts/correct-price-history.ts --revert ${batch} --apply`);

  async function verify(k: string) {
    const after = (await repo.getDays(inst!.id, 5000)).filter((d) => d.close !== null);
    let worst = 0, worstDate = "";
    for (let i = 1; i < after.length; i++) {
      const r = Math.abs(after[i]!.close! / after[i - 1]!.close! - 1);
      if (r > worst) { worst = r; worstDate = after[i]!.date; }
    }
    console.log(`${k} verification: ${after.length} bars, largest close-to-close move now ${(worst * 100).toFixed(1)}% on ${worstDate}; EMA200 on the latest bar ${after[after.length - 1]!.ema200?.toFixed(2)}`);
  }

  async function doRevert(batchId: string, doIt: boolean) {
    const { data, error } = await db.from("price_corrections").select("*").eq("batch_id", batchId).is("reverted_at", null).limit(100000);
    if (error) throw new Error(error.message);
    if (!data?.length) { console.log("nothing to revert for that batch"); return; }
    const id = Number(data[0]!.instrument_id);
    const byDate = new Map<string, Record<string, number>>();
    for (const r of data) byDate.set(r.date as string, { ...(byDate.get(r.date as string) ?? {}), [r.field as string]: Number(r.old_value) });
    console.log(`revert batch ${batchId}: ${data.length} values on ${byDate.size} bars of instrument ${id}`);
    if (!doIt) { console.log("DRY RUN: add --apply"); return; }
    const current = new Map((await repo.getDays(id, 5000)).map((d) => [d.date, d]));
    await repo.upsertCandles(id, [...byDate.entries()].map(([date, v]) => {
      const c = current.get(date)!;
      return { date, open: v.open ?? c.open!, high: v.high ?? c.high!, low: v.low ?? c.low!, close: v.close ?? c.close!, volume: c.volume ?? 0 };
    }));
    const inst2 = (await repo.listInstruments()).find((i) => i.id === id)!;
    const nifty = await repo.getInstrumentByKey("NIFTY50");
    await recomputeInstrument(repo, inst2, await loadCloses(repo, nifty!.id), { upsertAll: true });
    await scorePass(repo, { onlyIds: new Set([id]) });
    const { error: e2 } = await db.from("price_corrections").update({ reverted_at: new Date().toISOString() }).eq("batch_id", batchId);
    if (e2) throw new Error(e2.message);
    console.log("reverted, indicators and score recomputed");
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
