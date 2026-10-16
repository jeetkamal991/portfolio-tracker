import { signOut } from "@/app/login/actions";
import { getRepo } from "@/lib/api/server";
import { STRIP_KEYS } from "@/lib/instruments";
import { isMarketOpen, istDate } from "@/lib/time/ist";
import { buildAsOf, buildSectorRows, buildTodaySummary, latestPctDate } from "@/lib/view/dashboard";
import { AsOfBadge } from "./components/AsOfBadge";
import { ClaudeCard } from "./components/ClaudeCard";
import { AddStock } from "./components/AddStock";
import { QuotesProvider } from "./components/QuotesProvider";
import { WatchlistTable, type WatchItem } from "./components/WatchlistTable";
import { LiveStrip, type StripItem } from "./components/LiveStrip";
import { SectorHeatmap } from "./components/SectorHeatmap";
import { TodaySummary } from "./components/TodaySummary";

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

  const [stripDays, sectors, niftyDays, lastRun, summary] = await Promise.all([
    Promise.all(STRIP_KEYS.map((k) => daysOf(k, 10))),
    Promise.all(
      instruments
        .filter((i) => i.type === "sector")
        .map(async (i) => ({ key: i.key, name: i.name, days: await repo.getDays(i.id, 70) })),
    ),
    daysOf("NIFTY50", 10),
    repo.lastJobRun("eod"),
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

  const stripItems: StripItem[] = STRIP_KEYS.map((k, n) => {
    const days = stripDays[n];
    const lastPriced = [...days].reverse().find((d) => d.close !== null);
    return {
      ticker: byKey.get(k)?.yahooTicker ?? k,
      name: byKey.get(k)?.name ?? k,
      close: lastPriced?.close ?? null,
      pct: buildTodaySummary(days),
    };
  });
  const watchStrip: StripItem[] = watchItems.map((w) => ({
    ticker: w.ticker,
    name: w.name,
    close: w.lastDay.close,
    pct: w.lastDay.pctChange ?? w.lastDay.importedPct,
  }));
  const bankDays = stripDays[STRIP_KEYS.indexOf("NIFTY_BANK")];
  const asOf = buildAsOf(latestPctDate(niftyDays), lastRun);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Nifty Dashboard</h1>
        <div className="flex items-center gap-3">
          <AsOfBadge date={asOf.date} stale={asOf.stale} />
          <form action={signOut}>
            <button type="submit" className="text-sm text-neutral-500 underline-offset-4 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <QuotesProvider initialOpen={isMarketOpen(now)}>
        <LiveStrip items={[...stripItems, ...watchStrip]} />
        <ClaudeCard summary={summary} />
        <TodaySummary nifty={buildTodaySummary(niftyDays)} bankNifty={buildTodaySummary(bankDays)} />
        <SectorHeatmap rows={buildSectorRows(sectors)} />
        <AddStock />
        <WatchlistTable items={watchItems} />
      </QuotesProvider>
    </main>
  );
}
