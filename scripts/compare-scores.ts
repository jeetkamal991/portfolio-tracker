// READ-ONLY: scores the universe with enhanced_v2 in memory and compares with the stored legacy_v1 score.
// Writes nothing. Usage: npm run compare-scores
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveLevel } from "@/lib/calc/levels";
import { scoreTechnicalV2, type TechDay } from "@/lib/calc/scoreV2/technical";
import { buildBreadth } from "@/lib/view/breadth";
import { loadStakeDeltas } from "@/lib/jobs/score";
import { pool } from "@/lib/jobs/pool";
import { primarySector } from "@/lib/universe/sectors";
import { listUniverseStocks } from "@/lib/universe/stocks";
import { addDays, istDate } from "@/lib/time/ist";

const DAYS = 300; // EMA200 needs 200; 60-session relative strength needs 61
const toTech = (d: TechDay): TechDay => ({
  date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume, volAvg20: d.volAvg20,
  ema20: d.ema20, ema50: d.ema50, ema200: d.ema200, rsi14: d.rsi14, macd: d.macd, macdSignal: d.macdSignal, macdHist: d.macdHist, patterns: d.patterns,
});

async function main() {
  process.loadEnvFile(".env.local");
  const repo = createSupabaseRepo(createAdminClient());
  const idx = await repo.listInstruments({ types: ["index", "sector"], activeOnly: true });
  const byKey = new Map(idx.map((i) => [i.key, i]));
  const load = async (id: number) => (await repo.getDays(id, DAYS)).filter((d) => d.close !== null);
  const niftyInst = byKey.get("NIFTY50");
  if (!niftyInst) throw new Error("NIFTY50 missing");
  const nifty = await load(niftyInst.id);
  const sectorCache = new Map<string, TechDay[]>();
  const sectorDays = async (key: string) => {
    if (!sectorCache.has(key)) sectorCache.set(key, byKey.get(key) ? await load(byKey.get(key)!.id) : []);
    return sectorCache.get(key)!;
  };

  const keysOf = new Map<number, string[]>();
  for (const m of await repo.listMemberships()) (keysOf.get(m.instrumentId) ?? keysOf.set(m.instrumentId, []).get(m.instrumentId)!).push(m.indexKey);

  const stocks = await listUniverseStocks(repo);
  const latestDate = nifty[nifty.length - 1]!.date;
  const breadth = buildBreadth([...(await repo.getDaysOn(stocks.map((s) => s.id), latestDate)).values()], []);
  const stakes = await loadStakeDeltas(repo);
  const delivery = await repo.listDelivery(addDays(istDate(new Date()), -14));
  const delBy = new Map<string, { date: string; per: number }[]>();
  for (const r of delivery) (delBy.get(r.symbol) ?? delBy.set(r.symbol, []).get(r.symbol)!).push({ date: r.date, per: r.delivPer });

  const rows: { key: string; legacy: number | null; v2: number | null; coverage: number; status: string; cats: Record<string, number>; hist: number; missing: string[] }[] = [];
  await pool(stocks, 8, async (s) => {
    try {
      const days = await load(s.id);
      if (days.length === 0) return;
      const sec = primarySector(keysOf.get(s.id) ?? []);
      const lv = await repo.getLevels(s.id);
      const dv = (delBy.get(s.key) ?? []).sort((a, b) => a.date.localeCompare(b.date)).slice(-5).map((x) => x.per);
      const r = scoreTechnicalV2({
        days: days.map(toTech), nifty: nifty.map(toTech), sector: sec ? (await sectorDays(sec)).map(toTech) : null,
        breadthAboveEma200: breadth.aboveEma200, support: effectiveLevel(lv.autoSupport, lv.manualSupport), resistance: effectiveLevel(lv.autoResistance, lv.manualResistance),
        fiiDelta: stakes.get(s.id)?.fii ?? null, diiDelta: stakes.get(s.id)?.dii ?? null, delivery: dv,
      });
      const lastDay = days[days.length - 1]!;
      rows.push({
        key: s.key, legacy: lastDay.score, v2: r.score, coverage: r.coverage, status: r.status, hist: days.length,
        cats: Object.fromEntries(r.categories.map((c) => [c.key, c.available === 0 ? NaN : (c.earned / c.available) * c.max])),
        missing: r.missing,
      });
    } catch (e) {
      console.error(s.key, e instanceof Error ? e.message : e);
    }
  });

  // History depth: answers whether 60-session relative strength is feasible.
  const depth = (n: number) => rows.filter((r) => r.hist >= n).length;
  console.log(`As of ${latestDate}. Stocks scored: ${rows.length}`);
  console.log(`History >=61 sessions: ${depth(61)}, >=201: ${depth(201)}, >=34: ${depth(34)} (of ${rows.length}); Nifty rows: ${nifty.length}`);
  const sectors = [...sectorCache.entries()].map(([k, v]) => `${k}:${v.length}`).join(" ");
  console.log(`Sector index rows: ${sectors}`);
  const cov = (lo: number, hi: number) => rows.filter((r) => r.coverage >= lo && r.coverage < hi).length;
  console.log(`Coverage: =100% ${cov(1, 2)}, 90-99% ${cov(0.9, 1)}, 80-89% ${cov(0.8, 0.9)}, <80% ${cov(0, 0.8)}`);
  const missingCount = new Map<string, number>();
  for (const r of rows) for (const m of r.missing) missingCount.set(m.split(": ").slice(0, 2).join(": "), (missingCount.get(m.split(": ").slice(0, 2).join(": ")) ?? 0) + 1);
  console.log("Most common missing items:");
  for (const [k, n] of [...missingCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${k}`);

  const both = rows.filter((r) => r.legacy !== null && r.v2 !== null);
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const dx = both.map((r) => r.legacy as number), dy = both.map((r) => r.v2 as number);
  const mx = mean(dx), my = mean(dy);
  const corr = both.length < 2 ? NaN : dx.reduce((s, x, i) => s + (x - mx) * (dy[i]! - my), 0) / Math.sqrt(dx.reduce((s, x) => s + (x - mx) ** 2, 0) * dy.reduce((s, y) => s + (y - my) ** 2, 0));
  console.log(`\nCompared (both scored): ${both.length}. Mean legacy ${mx.toFixed(1)}, mean v2 ${my.toFixed(1)}, correlation ${corr.toFixed(2)}`);
  const sorted = [...both].sort((a, b) => (a.legacy as number) - (b.legacy as number));
  const sample = sorted.filter((_, i) => i % Math.max(1, Math.floor(sorted.length / 25)) === 0);
  console.log("\nSAMPLE (spread across legacy score):\nkey            legacy   v2  diff  cover status       trend mom  vol  pat  mkt   rs  flow");
  const f = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? "  —" : n.toFixed(0).padStart(3));
  for (const r of sample) {
    const d = (r.v2 as number) - (r.legacy as number);
    console.log(`${r.key.padEnd(14)} ${String(r.legacy).padStart(6)} ${(r.v2 as number).toFixed(0).padStart(4)} ${(d >= 0 ? "+" : "") + d.toFixed(0)}`.padEnd(36) + ` ${(r.coverage * 100).toFixed(0).padStart(3)}% ${r.status.padEnd(11)} ${["trend", "momentum", "volume", "pattern", "market", "relativeStrength", "flows"].map((k) => f(r.cats[k])).join("  ")}`);
  }
  console.log("\nBIGGEST DIFFERENCES:");
  for (const r of [...both].sort((a, b) => Math.abs((b.v2 as number) - (b.legacy as number)) - Math.abs((a.v2 as number) - (a.legacy as number))).slice(0, 8)) {
    console.log(`${r.key.padEnd(14)} legacy ${r.legacy} -> v2 ${(r.v2 as number).toFixed(0)}  coverage ${(r.coverage * 100).toFixed(0)}%  rs ${f(r.cats.relativeStrength)}/20 trend ${f(r.cats.trend)}/18 flows ${f(r.cats.flows)}/10`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
