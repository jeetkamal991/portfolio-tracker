// READ-ONLY. Scans stored daily history of the whole stock universe for price discontinuities and integrity problems,
// then compares each large jump against Yahoo's current close, adjusted close and split/dividend events.
// Usage: tsx scripts/scan-price-anomalies.ts [--json out.json]
import { writeFileSync } from "node:fs";
import YahooFinance from "yahoo-finance2";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";
import { pool } from "@/lib/jobs/pool";
import { sessionCalendar } from "@/lib/calc/returns";
import { listUniverseStocks } from "@/lib/universe/stocks";
import { istDate } from "@/lib/time/ist";

const JUMP = 0.2; // NSE bands are <= 20% for most stocks; F&O stocks have none, so a jump is a candidate, not a verdict
const FRACTIONS: [string, number][] = [["1/2", 0.5], ["2/3", 2 / 3], ["1/3", 1 / 3], ["1/4", 0.25], ["3/4", 0.75], ["1/5", 0.2], ["1/10", 0.1], ["4/5", 0.8], ["5/6", 5 / 6], ["3/5", 0.6], ["2/5", 0.4]];
const nearFraction = (r: number) => FRACTIONS.filter(([, f]) => Math.abs(r / f - 1) < 0.03 || Math.abs(r * f - 1) < 0.03).map(([n]) => n);

interface Jump { key: string; date: string; prevDate: string; prevClose: number; close: number; ratio: number; open: number; volume: number | null; prevVolume: number | null; volRatio: number | null; fractions: string[] }

async function main() {
  process.loadEnvFile(".env.local");
  const repo = createSupabaseRepo(createAdminClient());
  const nifty = await repo.getInstrumentByKey("NIFTY50");
  const cal = sessionCalendar((await repo.getDays(nifty!.id, 5000)).filter((d) => d.close !== null).map((d) => d.date));
  const stocks = await listUniverseStocks(repo);
  const jumps: Jump[] = [];
  const integrity: string[] = [];
  const stats = { stocks: 0, rows: 0, noRows: 0, stale: 0, ohlcBad: 0, zeroVol: 0, missing: 0, offCal: 0 };
  const latestCal = cal.dates[cal.dates.length - 1]!;
  const info = new Map<string, { ticker: string; id: number; name: string }>();

  await pool(stocks, 8, async (s) => {
    const days = (await repo.getDays(s.id, 5000)).filter((d) => d.close !== null);
    info.set(s.key, { ticker: s.yahooTicker, id: s.id, name: s.name });
    stats.stocks++; stats.rows += days.length;
    if (!days.length) { stats.noRows++; return; }
    if (days[days.length - 1]!.date < latestCal) { stats.stale++; integrity.push(`${s.key}: last bar ${days[days.length - 1]!.date} < ${latestCal}`); }
    const have = new Set(days.map((d) => d.date));
    const first = days[0]!.date;
    const miss = cal.dates.filter((d) => d >= first && !have.has(d)).length;
    stats.missing += miss;
    if (miss > 25) integrity.push(`${s.key}: ${miss} Nifty sessions missing since ${first}`);
    for (let i = 0; i < days.length; i++) {
      const d = days[i]!;
      if (!cal.index.has(d.date)) stats.offCal++;
      if ((d.high !== null && d.low !== null && (d.high < d.low || d.close! > d.high * 1.0001 || d.close! < d.low * 0.9999 || (d.open !== null && (d.open > d.high * 1.0001 || d.open < d.low * 0.9999)))) || !(d.close! > 0)) {
        stats.ohlcBad++; integrity.push(`${s.key} ${d.date}: inconsistent OHLC o${d.open} h${d.high} l${d.low} c${d.close}`);
      }
      if (d.volume === 0 || d.volume === null) stats.zeroVol++;
      if (i === 0) continue;
      const p = days[i - 1]!;
      const ratio = d.close! / p.close!;
      if (Math.abs(ratio - 1) > JUMP) {
        jumps.push({
          key: s.key, date: d.date, prevDate: p.date, prevClose: p.close!, close: d.close!, ratio, open: d.open ?? NaN,
          volume: d.volume, prevVolume: p.volume, volRatio: d.volume && p.volume ? d.volume / p.volume : null, fractions: nearFraction(ratio),
        });
      }
    }
  });

  console.log(`Scanned ${stats.stocks} stocks, ${stats.rows} bars. No rows ${stats.noRows}; stale ${stats.stale}; inconsistent OHLC ${stats.ohlcBad}; zero/missing volume bars ${stats.zeroVol}; Nifty sessions missing ${stats.missing}; bars off the Nifty calendar ${stats.offCal}`);
  for (const l of integrity.slice(0, 15)) console.log("  ", l);
  if (integrity.length > 15) console.log(`   … ${integrity.length - 15} more`);
  console.log(`\nJumps over ${JUMP * 100}% close-to-close: ${jumps.length} across ${new Set(jumps.map((j) => j.key)).size} stocks`);

  // Compare each jump with Yahoo: current raw close, adjusted close and split events around the date.
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
  const report: unknown[] = [];
  const byKey = new Map<string, Jump[]>();
  for (const j of jumps) byKey.set(j.key, [...(byKey.get(j.key) ?? []), j]);
  for (const [key, js] of byKey) {
    const meta = info.get(key)!;
    const stored = new Map((await repo.getDays(meta.id, 5000)).map((d) => [d.date, d]));
    type Q = { date: Date; close: number | null; adjclose?: number | null };
    type Chart = { quotes: Q[]; events?: { splits?: { date: Date; splitRatio: string }[] } };
    const chart: Chart | null = await (yf.chart(meta.ticker, { period1: new Date("2015-01-01"), period2: new Date(Date.now() + 2 * 86_400_000), interval: "1d", events: "div|split" } as never) as unknown as Promise<Chart>).catch((e: unknown) => {
      console.log(`${key}: yahoo error ${e instanceof Error ? e.message.slice(0, 80) : e}`);
      return null;
    });
    const y = new Map((chart?.quotes ?? []).map((q) => [istDate(q.date), q]));
    const splits = (chart?.events?.splits ?? []).map((s) => `${istDate(s.date)} ${s.splitRatio}`);
    for (const j of js) {
      const a = y.get(j.prevDate), b = y.get(j.date);
      const sPrev = stored.get(j.prevDate)?.close ?? null, sNow = stored.get(j.date)?.close ?? null;
      const rel = (x: number | null | undefined, z: number | null | undefined) => (x == null || z == null ? "n/a" : (((x / z) - 1) * 100).toFixed(1) + "%");
      const yRatio = a?.close && b?.close ? (b.close / a.close).toFixed(3) : "n/a";
      const prevIsAdjusted = a?.close != null && sPrev !== null && Math.abs(sPrev / a.close - 1) < 0.005;
      const openRatio = j.open / j.prevClose;
      const exact = FRACTIONS.filter(([, f]) => Math.abs(openRatio / f - 1) < 0.0006 || Math.abs(openRatio * f - 1) < 0.0006).map(([n]) => n);
      const verdict = a?.close == null ? "no Yahoo bar" : Math.abs((b!.close! / a.close) - 1) > JUMP ? "Yahoo shows the SAME jump: genuine move or unadjusted at source" : prevIsAdjusted ? "stored matches Yahoo" : "stored pre-event bars differ from Yahoo's current (adjusted) series: STORED HISTORY UNADJUSTED";
      const focus = ["TRENT", "TMPV", "POLICYBZR"].includes(key);
      if (focus || exact.length) console.log(`${key.padEnd(11)} ${j.date} ratio ${j.ratio.toFixed(3)} (~${j.fractions.join("|") || "no std fraction"}) vol x${j.volRatio?.toFixed(1) ?? "n/a"} | open/prevClose ${openRatio.toFixed(4)} ${exact.length ? "EXACT " + exact.join("|") : "not a clean fraction"} | stored prev ${sPrev?.toFixed(2)} now ${sNow?.toFixed(2)} | yahoo prev ${a?.close?.toFixed(2) ?? "n/a"} (adj ${a?.adjclose?.toFixed(2) ?? "n/a"}) now ${b?.close?.toFixed(2) ?? "n/a"} yahooRatio ${yRatio} stored-vs-yahoo prev ${rel(sPrev, a?.close)} | splits: ${splits.filter((s) => s.slice(0, 7) === j.date.slice(0, 7) || Math.abs(Date.parse(s.slice(0, 10)) - Date.parse(j.date)) < 7 * 86_400_000).join(",") || "none within a week"} => ${verdict}`);
      report.push({ ...j, openRatio, exactFractions: exact, storedPrev: sPrev, storedNow: sNow, yahooPrev: a?.close ?? null, yahooNow: b?.close ?? null, splitsOnRecord: splits, verdict });
    }
  }
  const out = process.argv.indexOf("--json");
  if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(report, null, 1));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
