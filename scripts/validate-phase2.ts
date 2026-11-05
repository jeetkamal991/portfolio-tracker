// READ-ONLY validation of Technical v2 coverage and Trade Quality (ATR, traded value). Writes nothing.
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createYahooProvider } from "@/lib/provider/yahoo";
import { effectiveLevel } from "@/lib/calc/levels";
import { scoreTechnicalV2, type TechDay } from "@/lib/calc/scoreV2/technical";
import { scoreTradeQuality } from "@/lib/calc/scoreV2/tradeQuality";
import { buildBreadth } from "@/lib/view/breadth";
import { loadStakeDeltas } from "@/lib/jobs/score";
import { pool } from "@/lib/jobs/pool";
import { primarySector } from "@/lib/universe/sectors";
import { listUniverseStocks } from "@/lib/universe/stocks";
import { addDays, istDate } from "@/lib/time/ist";

const DAYS = 300;
const SAMPLE = ["HDFCBANK", "SBIN", "BAJAJ-AUTO", "TRENT", "HDFCAMC", "CUMMINSIND", "RVNL", "SWIGGY", "PFOCUS", "ACE"];

// Independent ATR: written differently from src/lib/calc/atr.ts (TR array first, then Wilder's RMA recursion).
function independentAtr(h: number[], l: number[], c: number[], n = 14): number | null {
  if (c.length <= n) return null;
  const tr = c.map((_, i) => (i === 0 ? NaN : Math.max(h[i]! - l[i]!, Math.abs(h[i]! - c[i - 1]!), Math.abs(l[i]! - c[i - 1]!))));
  let atr = tr.slice(1, n + 1).reduce((s, x) => s + x, 0) / n;
  for (let i = n + 1; i < c.length; i++) atr += (tr[i]! - atr) / n;
  return atr;
}
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const cr = (x: number | null) => (x === null ? "—" : (x / 1e7).toFixed(2));

async function main() {
  process.loadEnvFile(".env.local");
  const t0 = Date.now();
  const repo = createSupabaseRepo(createAdminClient());
  const provider = createYahooProvider();
  const idx = await repo.listInstruments({ types: ["index", "sector"], activeOnly: true });
  const byKey = new Map(idx.map((i) => [i.key, i]));
  const load = async (id: number) => (await repo.getDays(id, DAYS)).filter((d) => d.close !== null) as TechDay[];
  const nifty = await load(byKey.get("NIFTY50")!.id);
  const sectorCache = new Map<string, TechDay[]>();
  const sectorDays = async (k: string) => { if (!sectorCache.has(k)) sectorCache.set(k, byKey.get(k) ? await load(byKey.get(k)!.id) : []); return sectorCache.get(k)!; };
  const keysOf = new Map<number, string[]>();
  for (const m of await repo.listMemberships()) (keysOf.get(m.instrumentId) ?? keysOf.set(m.instrumentId, []).get(m.instrumentId)!).push(m.indexKey);
  const stocks = await listUniverseStocks(repo);
  const latestDate = nifty[nifty.length - 1]!.date;
  const breadth = buildBreadth([...(await repo.getDaysOn(stocks.map((s) => s.id), latestDate)).values()], []);
  const stakes = await loadStakeDeltas(repo);
  const delivery = await repo.listDelivery(addDays(istDate(new Date()), -14));
  const delBy = new Map<string, { date: string; per: number }[]>();
  for (const r of delivery) (delBy.get(r.symbol) ?? delBy.set(r.symbol, []).get(r.symbol)!).push({ date: r.date, per: r.delivPer });
  const holdings = new Map((await repo.listHoldings()).map((h) => [h.key, h]));
  console.log(`setup ${((Date.now() - t0) / 1000).toFixed(1)}s; as of ${latestDate}; universe ${stocks.length}`);

  const t1 = Date.now();
  let loadMs = 0, calcMs = 0, queries = 0;
  const out = new Map<string, { tech: ReturnType<typeof scoreTechnicalV2>; trade: ReturnType<typeof scoreTradeQuality>; days: TechDay[]; sector: string | null; id: number; ticker: string }>();
  await pool(stocks, 8, async (s) => {
    try {
      const a = Date.now();
      const days = await load(s.id);
      const lv = await repo.getLevels(s.id);
      loadMs += Date.now() - a; queries += 2;
      if (!days.length) return;
      const b = Date.now();
      const sec = primarySector(keysOf.get(s.id) ?? []);
      const support = effectiveLevel(lv.autoSupport, lv.manualSupport), resistance = effectiveLevel(lv.autoResistance, lv.manualResistance);
      const dv = (delBy.get(s.key) ?? []).sort((x, y) => x.date.localeCompare(y.date)).slice(-5).map((x) => x.per);
      const tech = scoreTechnicalV2({
        days, nifty, sector: sec ? await sectorDays(sec) : null, breadthAboveEma200: breadth.aboveEma200, support, resistance,
        fiiDelta: stakes.get(s.id)?.fii ?? null, diiDelta: stakes.get(s.id)?.dii ?? null, delivery: dv,
      });
      const h = holdings.get(s.key);
      const trade = scoreTradeQuality({ days, support, resistance, manualStop: h?.stopLoss ?? null, manualTarget1: h?.target1 ?? null, technicalScore: tech.score });
      calcMs += Date.now() - b;
      out.set(s.key, { tech, trade, days, sector: sec, id: s.id, ticker: s.yahooTicker });
    } catch (e) { console.error(s.key, e instanceof Error ? e.message : e); }
  });
  console.log(`scored ${out.size} stocks in ${((Date.now() - t1) / 1000).toFixed(1)}s (db read ${(loadMs / 1000).toFixed(1)}s summed over 8 workers, calc ${calcMs}ms total, ${queries} level/day queries; ~${DAYS} rows per getDays)\n`);

  // ---- A. Sector mapping + Technical coverage ----
  const rows = [...out.entries()];
  console.log("A. SECTOR MAPPING (primary sector of each stock) and history rows:");
  const bySector = new Map<string, number>();
  for (const [, v] of rows) bySector.set(v.sector ?? "(none)", (bySector.get(v.sector ?? "(none)") ?? 0) + 1);
  for (const [k, n] of [...bySector.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} stocks ${String(n).padStart(3)}  sector index rows ${k === "(none)" ? "—" : sectorCache.get(k)?.length ?? 0}`);
  const tc = (f: (c: number) => boolean) => rows.filter(([, v]) => f(v.tech.coverage)).length;
  console.log(`\n  Technical v2 coverage: =100% ${tc((c) => c >= 1)}, >=90% ${tc((c) => c >= 0.9)}, >=80% ${tc((c) => c >= 0.8)}, <80% ${tc((c) => c < 0.8)} (of ${rows.length})`);
  const miss = new Map<string, number>();
  for (const [, v] of rows) for (const m of v.tech.missing) { const k = m.split(": ").slice(0, 2).join(": "); miss.set(k, (miss.get(k) ?? 0) + 1); }
  console.log("  Missing items:", [...miss.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, n]) => `${k} x${n}`).join(" | "));
  // RS 20/60 vs sector work where history exists
  const withSec = rows.filter(([, v]) => v.sector && (sectorCache.get(v.sector)?.length ?? 0) >= 61);
  const rsOk = withSec.filter(([, v]) => v.tech.categories.find((c) => c.key === "relativeStrength")!.items.filter((i) => i.key.startsWith("vsSector")).every((i) => i.status === "scored")).length;
  console.log(`  Stocks whose sector has >=61 rows: ${withSec.length}; of those, 20- and 60-session sector RS both scored: ${rsOk}`);

  // ---- B. Trade Quality coverage ----
  console.log("\nB. TRADE QUALITY (all stocks)");
  const qc = (f: (c: number) => boolean) => rows.filter(([, v]) => f(v.trade.coverage)).length;
  console.log(`  coverage =100% ${qc((c) => c >= 1)}, >=80% ${qc((c) => c >= 0.8)}, <80% ${qc((c) => c < 0.8)}; rankable ${rows.filter(([, v]) => v.trade.rankable).length}; no valid target ${rows.filter(([, v]) => v.trade.levels.target === null).length}; ATR unavailable ${rows.filter(([, v]) => v.trade.atr.value === null).length}`);
  const tm = new Map<string, number>();
  for (const [, v] of rows) for (const m of v.trade.missing) { const k = m.split(": ").slice(0, 2).join(": "); tm.set(k, (tm.get(k) ?? 0) + 1); }
  console.log("  Missing items:", [...tm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} x${n}`).join(" | "));
  const obs = new Map<string, number>();
  for (const [, v] of rows) obs.set(v.trade.observation, (obs.get(v.trade.observation) ?? 0) + 1);
  console.log("  Observations:", [...obs.entries()].map(([k, n]) => `${k} ${n}`).join(", "));
  const flags = new Map<string, number>();
  for (const [, v] of rows) for (const f of v.trade.flags) { const k = f.replace(/\d{4}-\d{2}-\d{2}(, )?/g, "").slice(0, 70); flags.set(k, (flags.get(k) ?? 0) + 1); }
  console.log("  Flags:", [...flags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} x${n}`).join(" | "));
  const jumpStocks = rows.filter(([, v]) => v.trade.atr.jumps.length).map(([k, v]) => `${k}(${v.trade.atr.jumps.join("/")})`);
  console.log(`  Possible unadjusted corporate actions (>30% close-to-close): ${jumpStocks.length ? jumpStocks.join(", ") : "none"}`);

  // ---- C. 10-stock sample vs fresh provider data ----
  console.log("\nC. SAMPLE: stored data vs independently recomputed from freshly fetched provider candles");
  console.log("key         close    ATR14(module)  ATR14(indep)  diff%   ATR%   TV20avg(cr) TV20med(cr) indep avg/med(cr)   dayTV(cr)  Trade   cov  RR    obs");
  for (const key of SAMPLE) {
    const v = out.get(key);
    if (!v) { console.log(`${key.padEnd(11)} not in scored set`); continue; }
    const first = v.days[0]!.date;
    const fresh = (await provider.getDailyHistory(v.ticker, first, istDate(new Date()))).filter((c) => c.close != null && c.high != null && c.low != null);
    const ia = independentAtr(fresh.map((c) => c.high as number), fresh.map((c) => c.low as number), fresh.map((c) => c.close as number));
    const tvIdx = fresh.slice(-20).map((c) => (c.close as number) * (c.volume ?? 0)).filter((x) => x > 0);
    const m = v.trade.atr.value;
    const diff = m !== null && ia !== null ? ((m - ia) / ia) * 100 : NaN;
    const l = v.trade.liquidity;
    console.log(
      `${key.padEnd(11)} ${v.days[v.days.length - 1]!.close!.toFixed(2).padStart(8)} ${m === null ? "—".padStart(13) : m.toFixed(3).padStart(13)} ${ia === null ? "—".padStart(13) : ia.toFixed(3).padStart(13)} ${Number.isNaN(diff) ? "   —" : (diff >= 0 ? "+" : "") + diff.toFixed(2).padStart(5)}%` +
      ` ${v.trade.atr.pct === null ? "  — " : v.trade.atr.pct.toFixed(2).padStart(5)}  ${cr(l.avg).padStart(10)} ${cr(l.median).padStart(11)}   ${cr(tvIdx.reduce((s, x) => s + x, 0) / (tvIdx.length || 1)).padStart(8)}/${cr(tvIdx.length ? med(tvIdx) : null).padEnd(8)} ${cr(l.latest).padStart(9)}` +
      `  ${v.trade.normalised?.toFixed(0).padStart(3)}  ${(v.trade.coverage * 100).toFixed(0).padStart(3)}%  ${v.trade.levels.rewardRisk?.toFixed(2) ?? "—"}  ${v.trade.observation}`,
    );
    console.log(`            entry ${v.trade.levels.entry?.toFixed(2)} stop ${v.trade.levels.stop?.toFixed(2) ?? "—"} (${v.trade.levels.stopSource ?? "—"}) target ${v.trade.levels.target?.toFixed(2) ?? "—"} (${v.trade.levels.targetSource ?? "—"}); candles ${v.trade.atr.candles}; stored ${v.days.length} rows vs fresh ${fresh.length}; tech ${v.tech.score?.toFixed(0)} cov ${(v.tech.coverage * 100).toFixed(0)}%`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
