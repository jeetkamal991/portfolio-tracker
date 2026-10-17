import { getRepo } from "@/lib/api/server";
import { STRIP_KEYS } from "@/lib/instruments";
import { istDate } from "@/lib/time/ist";
import { buildSectorRows, buildTodaySummary } from "@/lib/view/dashboard";
import { ClaudeCard } from "../components/ClaudeCard";
import { AddStock } from "../components/AddStock";
import { WatchlistTable, type WatchItem } from "../components/WatchlistTable";
import { SectorHeatmap } from "../components/SectorHeatmap";
import { TodaySummary } from "../components/TodaySummary";

export const dynamic = "force-dynamic";

export default async function Home() {
  const repo = getRepo();
  const now = new Date();
  const instruments = await repo.listInstruments({ types: ["index", "sector"] });
  const byKey = new Map(instruments.map((i) => [i.key, i]));
  const daysOf = async (key: string, limit: number) => {
    const inst = byKey.get(key);
    return inst ? repo.getDays(inst.id, limit) : [];
  };

  const [stripDays, sectors, niftyDays, summary] = await Promise.all([
    Promise.all(STRIP_KEYS.map((k) => daysOf(k, 10))),
    Promise.all(
      instruments
        .filter((i) => i.type === "sector")
        .map(async (i) => ({ key: i.key, name: i.name, days: await repo.getDays(i.id, 70) })),
    ),
    // ~70 sessions: the trading calendar for the heatmap's 5/21/63-session returns.
    daysOf("NIFTY50", 70),
    repo.getDailySummary(istDate(now)),
  ]);

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

  const bankDays = stripDays[STRIP_KEYS.indexOf("NIFTY_BANK")];
  const niftyDates = niftyDays.filter((d) => d.close !== null).map((d) => d.date);

  return (
    <div className="flex flex-col gap-5">
      <ClaudeCard summary={summary} />
      <TodaySummary nifty={buildTodaySummary(niftyDays)} bankNifty={buildTodaySummary(bankDays)} />
      <SectorHeatmap rows={buildSectorRows(sectors, niftyDates)} />
      <AddStock />
      <WatchlistTable items={watchItems} />
    </div>
  );
}
