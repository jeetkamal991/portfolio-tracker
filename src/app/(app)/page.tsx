import { handleMovers, type MoversResponse } from "@/lib/api/movers";
import { loadHoldingsLatest } from "@/lib/api/portfolio";
import { cached, getRepo, quoteCache } from "@/lib/api/server";
import { istDate } from "@/lib/time/ist";
import { parseDailySummary } from "@/lib/content/claude";
import { buildDailyLog } from "@/lib/view/dailyLog";
import { buildSectorRows } from "@/lib/view/dashboard";
import { PriceChart } from "../components/chart/PriceChart";
import { TodayByClaudeCompact } from "../components/dashboard/TodayByClaudeCompact";
import { DailyLogTotals } from "../components/dashboard/DailyLogTotals";
import { MoversPanel } from "../components/dashboard/MoversPanel";
import { NiftyCard } from "../components/dashboard/NiftyCard";
import { SectorStrip } from "../components/dashboard/SectorStrip";
import { PortfolioSnapshot } from "../components/portfolio/PortfolioSnapshot";

export const dynamic = "force-dynamic";

/** The chart opens on 6 months and the card/log need at most a year; the full series loads on demand (/api/history). */
const DASH_BARS = 260;

export default async function Dashboard() {
  const repo = getRepo();
  const today = istDate(new Date());
  // History only changes at end of day, so it is memoised; movers and holdings stay live.
  const [history, [movers, portfolio]] = await Promise.all([
    cached("dashboard-history", async () => {
      const instruments = await repo.listInstruments({ types: ["index", "sector"] });
      const nifty = instruments.find((i) => i.key === "NIFTY50");
      const sectorInsts = instruments.filter((i) => i.type === "sector");
      // Two reads in all (one year of Nifty; 70 sessions of every sector together), not one per sector.
      const [niftyDays, recent] = await Promise.all([
        nifty ? repo.getDays(nifty.id, DASH_BARS) : Promise.resolve([]),
        repo.getRecentDays(sectorInsts.map((i) => i.id), 70),
      ]);
      const sectors = sectorInsts.map((i) => ({ key: i.key, name: i.name, days: recent.get(i.id) ?? [] }));
      return { niftyDays, sectors };
    }),
    Promise.all([
      handleMovers(repo, quoteCache, new Date()).catch((): MoversResponse => ({ state: "no_data", date: null })),
      loadHoldingsLatest(repo),
    ]),
  ]);
  const { niftyDays, sectors } = history;
  const niftyDates = niftyDays.filter((d) => d.close !== null).map((d) => d.date);

  // Claude's note for the newest session; a failed read just hides the text, not the page.
  const session = niftyDates.at(-1) ?? null;
  const summaryRow = session ? await repo.getDailySummary(session).catch(() => null) : null;
  const summary = summaryRow ? parseDailySummary(summaryRow) : null;

  // The Daily Sector Log's Total row: this month, or last month while this one has no sessions yet.
  const log = buildDailyLog({ NIFTY50: niftyDays, ...Object.fromEntries(sectors.map((x) => [x.key, x.days])) }, niftyDates, new Date(), 2);
  const logMonth = log[0]?.rows.length ? log[0] : (log[1] ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="xl:col-span-2">
          <NiftyCard days={niftyDays} />
        </div>
        <PriceChart days={niftyDays} title="NIFTY 50" height={520} signals historyKey="NIFTY50" moreHistory={niftyDays.length >= DASH_BARS} />
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
