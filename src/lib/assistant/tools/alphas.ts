import { loadMarket } from "@/lib/api/market";
import type { Repo } from "@/lib/db/repo";
import { istDate } from "@/lib/time/ist";

export async function alphasTool(repo: Repo, args: string[]): Promise<string> {
  const i = args.indexOf("--alpha");
  const only = i >= 0 ? args[i + 1] : null;
  const m = await loadMarket(repo, istDate(new Date()));
  const list = m.alphas.filter((a) => !only || a.id === only);
  if (!m.session || list.length === 0) return "No alpha data (needs a universe and enough history).";
  const out = [`Alphas for ${m.session} (alphas #1 and #54 tie: they rank the same stocks)`];
  for (const a of list) {
    out.push("", `${a.title} [${a.id}] · ${a.status === "ok" ? `${a.count} scored` : "unavailable"}`);
    if (a.status !== "ok") continue;
    out.push("Top: " + a.top.map((h) => `${h.key} ${h.score.toFixed(3)}`).join(", ") + (a.topTied ? ` (+${a.topTied} tied)` : ""));
    out.push("Bottom: " + a.bottom.map((h) => `${h.key} ${h.score.toFixed(3)}`).join(", ") + (a.bottomTied ? ` (+${a.bottomTied} tied)` : ""));
  }
  return out.join("\n");
}
