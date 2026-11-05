import { getRepo } from "@/lib/api/server";
import { buildWatchSignals, type WatchInput } from "@/lib/view/watchlist";
import { AddStock } from "../../components/AddStock";
import { WatchlistTiles } from "../../components/WatchlistTiles";

export const dynamic = "force-dynamic";

// ~21 sessions for the 1-month sparkline plus a few spare for missed days.
const DAYS = 25;

export default async function WatchlistPage() {
  const repo = getRepo();
  const watchInstruments = await repo.listWatchlist();
  const ids = watchInstruments.map((i) => i.id);
  // two reads for the whole list, not two per stock
  const [recent, levels] = await Promise.all([repo.getRecentDays(ids, DAYS), repo.getLevelsMany(ids)]);
  const inputs: WatchInput[] = watchInstruments.map((i) => ({
    key: i.key, name: i.name, ticker: i.yahooTicker, days: recent.get(i.id) ?? [], levels: levels.get(i.id)!,
  }));

  return (
    <div className="flex flex-col gap-4">
      <AddStock />
      <WatchlistTiles inputs={inputs} signals={buildWatchSignals(inputs)} />
    </div>
  );
}
