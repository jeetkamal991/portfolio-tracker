import { loadMarket } from "@/lib/api/market";
import type { Repo } from "@/lib/db/repo";
import { istDate } from "@/lib/time/ist";
import { fmtPct } from "@/lib/view/dashboard";

export async function screenersTool(repo: Repo): Promise<string> {
  const m = await loadMarket(repo, istDate(new Date()));
  if (!m.session || m.screeners.length === 0) return "No screener data (no universe or session yet).";
  const out = [`Screeners for ${m.session}`];
  for (const s of m.screeners) {
    out.push("", `${s.title} (${s.count} matches)`);
    for (const h of s.hits) out.push(`${h.key} | close ${h.close} | day ${fmtPct(h.dayPct)}${h.metric !== null ? ` | metric ${h.metric}` : ""}${h.flag ? ` | ${h.flag}` : ""}`);
  }
  return out.join("\n");
}
