import { loadMarket } from "@/lib/api/market";
import { loadSectorAnalysis } from "@/lib/api/sectors";
import type { Repo } from "@/lib/db/repo";
import { istDate } from "@/lib/time/ist";
import { fmtPct } from "@/lib/view/dashboard";

export async function marketTool(repo: Repo): Promise<string> {
  const m = await loadMarket(repo, istDate(new Date()));
  if (!m.session) return "No market data yet.";
  const out = [`Market, session ${m.session}`];
  const nifty = await repo.getInstrumentByKey("NIFTY50");
  const day = nifty ? await repo.getLatestDay(nifty.id) : null;
  if (day) out.push(`Nifty 50 close ${day.close}, day ${fmtPct(day.pctChange ?? day.importedPct)}${day.scoreLabel ? `, score ${day.scoreLabel}` : ""}`);
  const b = m.breadth;
  if (b) {
    out.push(`India VIX ${b.vix.close ?? "—"} (${fmtPct(b.vix.dayPct)})`);
    out.push(`Breadth: ${b.advances} up, ${b.declines} down, ${b.unchanged} flat; ${b.aboveEma200 === null ? "—" : `${(b.aboveEma200 * 100).toFixed(0)}%`} above EMA 200`);
  }
  try {
    const s = await loadSectorAnalysis(repo);
    const ranked = s.rotation.filter((r) => r.rank !== null).sort((a, c) => (a.rank as number) - (c.rank as number));
    if (ranked.length) out.push("Sector rotation (RS rank, 1 = strongest): top " + ranked.slice(0, 3).map((r) => r.name).join(", ") + "; bottom " + ranked.slice(-3).map((r) => r.name).join(", "));
  } catch {
    out.push("Sector rotation unavailable");
  }
  if (m.summary) out.push("", `Daily summary (${m.summary.date}): ${m.summary.summary}`);
  return out.join("\n");
}
