import { getRepo } from "@/lib/api/server";
import { AddStock } from "../../components/AddStock";
import { WatchlistTable, type WatchItem } from "../../components/WatchlistTable";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const repo = getRepo();
  const watchInstruments = await repo.listWatchlist();
  const watchItems: WatchItem[] = (
    await Promise.all(
      watchInstruments.map(async (i) => {
        const [days, levels] = await Promise.all([repo.getDays(i.id, 3), repo.getLevels(i.id)]);
        const lastDay = [...days].filter((d) => d.close !== null).sort((a, b) => b.date.localeCompare(a.date))[0];
        return lastDay ? { key: i.key, name: i.name, ticker: i.yahooTicker, lastDay, levels } : null;
      }),
    )
  ).flatMap((w) => w ?? []);

  return (
    <div className="flex flex-col gap-4">
      <AddStock />
      <WatchlistTable items={watchItems} />
    </div>
  );
}
