// READ-ONLY. For every universe stock, takes Yahoo's recorded splits/bonuses and checks whether the STORED series is
// continuous across each event date (adjusted) or shows the raw price step (unadjusted).
import YahooFinance from "yahoo-finance2";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";
import { pool } from "@/lib/jobs/pool";
import { listUniverseStocks } from "@/lib/universe/stocks";
import { istDate } from "@/lib/time/ist";

interface Finding { key: string; date: string; ratio: string; expectedStep: number; observedStep: number | null; status: string }

async function main() {
  process.loadEnvFile(".env.local");
  const repo = createSupabaseRepo(createAdminClient());
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
  const stocks = await listUniverseStocks(repo);
  const findings: Finding[] = [];
  const errors: string[] = [];
  let withSplits = 0;
  await pool(stocks, 6, async (s) => {
    try {
      const ch = (await yf.chart(s.yahooTicker, { period1: new Date("2019-01-01"), period2: new Date(Date.now() + 2 * 86_400_000), interval: "1d", events: "split" } as never)) as unknown as {
        events?: { splits?: { date: Date; numerator: number; denominator: number; splitRatio: string }[] };
      };
      const splits = ch.events?.splits ?? [];
      if (!splits.length) return;
      withSplits++;
      const days = (await repo.getDays(s.id, 5000)).filter((d) => d.close !== null);
      for (const sp of splits) {
        const date = istDate(sp.date);
        const i = days.findIndex((d) => d.date >= date);
        if (i < 1) { findings.push({ key: s.key, date, ratio: sp.splitRatio, expectedStep: sp.denominator / sp.numerator, observedStep: null, status: "outside stored history" }); continue; }
        // Misplaced adjustment boundary (the TRENT case): the raw split step appears on the wrong date, with the
        // open sitting at the exact reference price (prev close x ratio) rather than a market-driven level.
        const exp0 = sp.denominator / sp.numerator;
        if (Math.abs(exp0 - 1) >= 0.05) {
          for (let k = 1; k < days.length; k++) {
            if (Math.abs(k - i) < 1) continue;
            const o = days[k]!.open ?? days[k]!.close!;
            if (Math.abs(o / days[k - 1]!.close! / exp0 - 1) < 0.0008) findings.push({ key: s.key, date: days[k]!.date, ratio: sp.splitRatio, expectedStep: exp0, observedStep: o / days[k - 1]!.close!, status: `MISPLACED STEP: open at exact split reference, ${Math.round((Date.parse(days[k]!.date) - Date.parse(date)) / 86_400_000)} days from the recorded ex-date ${date}` });
          }
        }
        const prev = days[i - 1]!, ex = days[i]!;
        const expected = sp.denominator / sp.numerator; // raw price step an UNADJUSTED series would show at the ex-date
        const observed = (ex.open ?? ex.close!) / prev.close!;
        const nearExpected = Math.abs(observed / expected - 1) < 0.06;
        const flat = Math.abs(observed - 1) < 0.06;
        // A tiny expected step (e.g. 11:10) cannot be told apart from a flat open by a 6% band: say so.
        const status = Math.abs(expected - 1) < 0.1 ? "indeterminate (step too small to tell)" : flat ? "adjusted/continuous" : nearExpected ? "UNADJUSTED STEP AT EX-DATE" : "step present but not the split ratio (check)";
        findings.push({ key: s.key, date, ratio: sp.splitRatio, expectedStep: expected, observedStep: observed, status });
      }
    } catch (e) { errors.push(`${s.key}: ${e instanceof Error ? e.message : e}`); }
  });
  console.log(`Universe ${stocks.length}; stocks with a Yahoo split/bonus record since 2019: ${withSplits}; events ${findings.length}; fetch errors ${errors.length}`);
  const by = new Map<string, number>();
  for (const f of findings) by.set(f.status, (by.get(f.status) ?? 0) + 1);
  console.log("By status:", [...by.entries()].map(([k, n]) => `${k}: ${n}`).join(" | "));
  for (const f of findings.filter((f) => !f.status.startsWith("adjusted") && !f.status.startsWith("indeterminate") && !f.status.startsWith("outside")).sort((a, b) => a.key.localeCompare(b.key))) {
    console.log(`  ${f.key.padEnd(11)} ${f.date} Yahoo ${f.ratio}: expected raw step x${f.expectedStep.toFixed(3)}, stored open/prevClose x${f.observedStep?.toFixed(3)} => ${f.status}`);
  }
  for (const e of errors.slice(0, 5)) console.log("  error", e);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
