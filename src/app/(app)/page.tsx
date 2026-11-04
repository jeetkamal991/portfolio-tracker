import { handleMovers, type MoversResponse } from "@/lib/api/movers";
import { loadHoldingsLatest } from "@/lib/api/portfolio";
import { cached, getRepo, quoteCache } from "@/lib/api/server";
import { istDate } from "@/lib/time/ist";
import { parseDailySummary } from "@/lib/content/claude";
import { eventMarkers, KIND_COLOR } from "@/lib/view/alerts";
import { buildDailyLog } from "@/lib/view/dailyLog";
import { buildSectorRows } from "@/lib/view/dashboard";
import { PriceChart, type ChartMarker } from "../components/chart/PriceChart";
import { TodayByClaudeCompact } from "../components/dashboard/TodayByClaudeCompact";
import { DashboardTimeline } from "../components/dashboard/DashboardTimeline";
import { DailyLogTotals } from "../components/dashboard/DailyLogTotals";
import { MoversPanel } from "../components/dashboard/MoversPanel";
import { NiftyCard } from "../components/dashboard/NiftyCard";
import { SectorStrip } from "../components/dashboard/SectorStrip";
import { PortfolioSnapshot } from "../components/portfolio/PortfolioSnapshot";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const repo = getRepo();
  const today = istDate(new Date());
  // History only changes at end of day, so it is memoised; movers, holdings and alerts stay live.
  const [history, [movers, portfolio], events] = await Promise.all([
    cached("dashboard-history", async () => {
      const instruments = await repo.listInstruments({ types: ["index", "sector"] });
      const nifty = instruments.find((i) => i.key === "NIFTY50");
      const [niftyDays, sectors] = await Promise.all([
        // Full history for the chart's ALL range (~2,700 sessions since 2015).
        nifty ? repo.getDays(nifty.id, 5000) : Promise.resolve([]),
        Promise.all(
          instruments
            .filter((i) => i.type === "sector")
            .map(async (i) => ({ key: i.key, name: i.name, days: await repo.getDays(i.id, 70) })),
        ),
      ]);
      return { niftyDays, sectors };
    }),
    Promise.all([
      handleMovers(repo, quoteCache, new Date()).catch((): MoversResponse => ({ state: "no_data", date: null })),
      loadHoldingsLatest(repo),
    ]),
    repo.listAlertEvents(50).catch(() => []),
  ]);
  const { niftyDays, sectors } = history;
  const niftyDates = niftyDays.filter((d) => d.close !== null).map((d) => d.date);

  // Claude's note for the newest session; a failed read just hides the text, not the page.
  const session = niftyDates.at(-1) ?? null;
  const summaryRow = session ? await repo.getDailySummary(session).catch(() => null) : null;
  const summary = summaryRow ? parseDailySummary(summaryRow) : null;

  // Your alert events, pinned on the chart at the session they fired.
  const markers: ChartMarker[] = eventMarkers(events, niftyDates).map((m) => ({ time: m.time, text: m.key, color: KIND_COLOR[m.kind] }));

  // The Daily Sector Log's Total row: this month, or last month while this one has no sessions yet.
  const log = buildDailyLog({ NIFTY50: niftyDays, ...Object.fromEntries(sectors.map((x) => [x.key, x.days])) }, niftyDates, new Date(), 2);
  const logMonth = log[0]?.rows.length ? log[0] : (log[1] ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <NiftyCard days={niftyDays} />
        <DashboardTimeline events={events} />
        <PriceChart days={niftyDays} title="NIFTY 50" height={520} markers={markers} />
        <MoversPanel initial={movers} />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <TodayByClaudeCompact summary={summary} session={session} />
        <SectorStrip rows={buildSectorRows(sectors, niftyDates.slice(-70))} />
        <PortfolioSnapshot holdings={portfolio.holdings} latest={portfolio.latest} today={today} />
        <DailyLogTotals month={logMonth} />
      </div>
    </div>
  );
}
