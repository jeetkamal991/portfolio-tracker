import { handleInstrumentGet } from "@/lib/api/instrument";
import { loadMarket } from "@/lib/api/market";
import type { Repo } from "@/lib/db/repo";
import { istDate } from "@/lib/time/ist";
import { fmtPct, fmtPrice } from "@/lib/view/dashboard";
import type { PopupData } from "@/lib/view/popup";

/** Everything about one stock. Deliberately never prints the owner's position (`data.holding`). */
export async function stockTool(repo: Repo, args: string[]): Promise<string> {
  const key = args[0]?.trim().toUpperCase();
  if (!key) return "Usage: stock <KEY>";
  const r = await handleInstrumentGet(repo, key);
  if (r.status !== 200) return `Not found: ${key}. Try: find <text>`;
  const d = r.body as PopupData;
  const out: string[] = [`${d.instrument.key} · ${d.instrument.name}${d.instrument.sectorName ? ` · ${d.instrument.sectorName}` : ""}`];
  if (d.latest) out.push(`Latest ${d.latest.date}: close ${fmtPrice(d.latest.close)}, day ${fmtPct(d.latest.pctChange ?? d.latest.importedPct)}`);
  if (d.score) out.push(`Technical Score ${d.score.value.toFixed(0)} (${d.score.label}, ${d.score.confidence} confidence): ${d.score.signal}`);
  out.push(...d.indicatorTable.map((i) => `${i.label}: ${i.value}`));
  out.push(`Support ${fmtPrice(d.levels.support)}, resistance ${fmtPrice(d.levels.resistance)}`);
  out.push(`Market: ${d.tailwinds.niftyLine}${d.tailwinds.sectorLine ? `; ${d.tailwinds.sectorLine}` : ""}`);
  if (d.patterns.length) out.push("Patterns (last 10 sessions): " + d.patterns.map((p) => `${p.date} ${p.name} (${p.bias})`).join(", "));

  // Alpha placement comes from the same cross-sectional run as the Market tab, so only top/bottom lists are known.
  try {
    const m = await loadMarket(repo, istDate(new Date()));
    const lines = m.alphas.flatMap((a) => {
      if (a.status !== "ok") return [];
      const t = a.top.findIndex((h) => h.key === key);
      const b = a.bottom.findIndex((h) => h.key === key);
      return t >= 0 ? [`${a.title}: top ${t + 1} of ${a.count}`] : b >= 0 ? [`${a.title}: bottom ${b + 1} of ${a.count}`] : [];
    });
    out.push(lines.length ? "Alphas: " + lines.join("; ") : "Alphas: not in any top/bottom 10 today");
  } catch {
    out.push("Alphas: unavailable");
  }

  out.push("", "Last 10 sessions (date open high low close volume):");
  for (const b of d.days.filter((x) => x.close !== null).slice(-10)) out.push(`${b.date} ${b.open} ${b.high} ${b.low} ${b.close} ${b.volume}`);

  const rep = d.reports.find((x) => x.parsed.ok);
  if (rep && rep.parsed.ok && rep.parsed.value.summary) out.push("", `Latest stored Claude report (${rep.completedAt ?? rep.requestedAt}): ${rep.parsed.value.summary}`);
  return out.join("\n");
}
