import type { Repo } from "@/lib/db/repo";
import { cached } from "./server";

export interface PortfolioSide {
  nifty: { close: number | null; dayPct: number | null } | null;
  /** Day % per sector, best first. */
  sectors: { name: string; d1: number | null }[];
}

/** Read-only context for the Portfolio tab's right column. Market numbers are memoised. */
export async function loadPortfolioSide(repo: Repo): Promise<PortfolioSide> {
  return cached("portfolio-side-market", async () => {
    const insts = await repo.listInstruments({ types: ["index", "sector"] });
    const recent = await repo.getRecentDays(insts.map((i) => i.id), 4, 10);
    const last = (id: number) => [...(recent.get(id) ?? [])].reverse().find((d) => d.close !== null) ?? null;
    const pct = (d: ReturnType<typeof last>) => (d ? (d.pctChange ?? d.importedPct ?? null) : null);
    const nifty = insts.find((i) => i.key === "NIFTY50");
    const niftyDay = nifty ? last(nifty.id) : null;
    const sectors = insts.filter((i) => i.type === "sector").map((i) => ({ name: i.name.replace(/^Nifty /, ""), d1: pct(last(i.id)) }));
    sectors.sort((a, b) => (b.d1 ?? -Infinity) - (a.d1 ?? -Infinity));
    return { nifty: niftyDay ? { close: niftyDay.close, dayPct: pct(niftyDay) } : null, sectors };
  });
}
