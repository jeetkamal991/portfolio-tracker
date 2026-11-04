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
  const inputs: WatchInput[] = await Promise.all(
    watchInstruments.map(async (i) => {
      const [days, levels] = await Promise.all([repo.getDays(i.id, DAYS), repo.getLevels(i.id)]);
      return { key: i.key, name: i.name, ticker: i.yahooTicker, days, levels };
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <AddStock />
      <WatchlistTiles inputs={inputs} signals={buildWatchSignals(inputs)} />
    </div>
  );
}
