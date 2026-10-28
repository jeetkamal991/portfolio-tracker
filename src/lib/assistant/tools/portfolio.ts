import { loadHoldingsLatest } from "@/lib/api/portfolio";
import type { Repo } from "@/lib/db/repo";
import { istDate } from "@/lib/time/ist";
import { fmtPct } from "@/lib/view/dashboard";
import { buildPortfolioView, fmtInr } from "@/lib/view/portfolio";

/** Holdings mode only: the one tool that prints the owner's positions. */
export async function portfolioTool(repo: Repo): Promise<string> {
  const { holdings, latest } = await loadHoldingsLatest(repo);
  if (holdings.length === 0) return "No holdings.";
  const v = buildPortfolioView(holdings, new Map(latest), {}, istDate(new Date()));
  const out = ["KEY | QTY | AVG | CMP | VALUE | P/L | P/L % | SCORE"];
  for (const r of v.rows) out.push(`${r.key} | ${r.qty} | ${fmtInr(r.avgPrice)} | ${fmtInr(r.cmp)} | ${fmtInr(r.value)} | ${fmtInr(r.pnl)} | ${fmtPct(r.pnlPct)} | ${r.score ?? "—"}`);
  for (const w of v.warnings) out.push(`WARNING ${w.key}: ${w.status} (cmp ${w.cmp}, level ${w.level})`);
  return out.join("\n");
}
