import type { Repo } from "@/lib/db/repo";
import { cached } from "./server";

export interface PortfolioSide {
  nifty: { close: number | null; dayPct: number | null } | null;
  /** Day % per sector, best first. */
  sectors: { name: string; d1: number | null }[];
  unreadCount: number;
  unread: { id: number; key: string; message: string }[];
}

const SHOWN = 3;

/** Read-only context for the Portfolio tab's right column. Market numbers are memoised; alerts are always live. */
export async function loadPortfolioSide(repo: Repo): Promise<PortfolioSide> {
  const [market, events] = await Promise.all([
    cached("portfolio-side-market", async () => {
      const insts = await repo.listInstruments({ types: ["index", "sector"] });
      const last = async (id: number) => [...(await repo.getDays(id, 4))].reverse().find((d) => d.close !== null) ?? null;
      const pct = (d: Awaited<ReturnType<typeof last>>) => (d ? (d.pctChange ?? d.importedPct ?? null) : null);
      const nifty = insts.find((i) => i.key === "NIFTY50");
      const niftyDay = nifty ? await last(nifty.id) : null;
      const sectors = await Promise.all(
        insts.filter((i) => i.type === "sector").map(async (i) => ({ name: i.name.replace(/^Nifty /, ""), d1: pct(await last(i.id)) })),
      );
      sectors.sort((a, b) => (b.d1 ?? -Infinity) - (a.d1 ?? -Infinity));
      return { nifty: niftyDay ? { close: niftyDay.close, dayPct: pct(niftyDay) } : null, sectors };
    }),
    repo.listAlertEvents(50),
  ]);
  const unread = events.filter((e) => !e.read);
  return {
    ...market,
    unreadCount: unread.length,
    unread: unread.slice(0, SHOWN).map((e) => ({ id: e.id, key: e.key, message: e.message })),
  };
}
