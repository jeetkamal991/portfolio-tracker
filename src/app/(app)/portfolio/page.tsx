import { getRepo } from "@/lib/api/server";
import type { StoredDay } from "@/lib/db/types";
import { istDate } from "@/lib/time/ist";
import { PortfolioView } from "../../components/portfolio/PortfolioView";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const repo = getRepo();
  const holdings = await repo.listHoldings();

  // Latest stored day per holding: the latest Nifty session first (one query), then each straggler's own latest.
  const nifty = await repo.getInstrumentByKey("NIFTY50");
  const niftyDay = nifty ? await repo.getLatestDay(nifty.id) : null;
  const ids = holdings.map((h) => h.instrumentId);
  const onSession = niftyDay && ids.length > 0 ? await repo.getDaysOn(ids, niftyDay.date) : new Map<number, StoredDay>();
  const latest: [number, StoredDay | null][] = await Promise.all(
    ids.map(async (id): Promise<[number, StoredDay | null]> => [id, onSession.get(id) ?? (await repo.getLatestDay(id))]),
  );

  return <PortfolioView holdings={holdings} latest={latest} today={istDate(new Date())} />;
}
