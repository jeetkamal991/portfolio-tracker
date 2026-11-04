import { handleMovers, type MoversResponse } from "@/lib/api/movers";
import { loadHoldingsLatest } from "@/lib/api/portfolio";
import { cached, getRepo, quoteCache } from "@/lib/api/server";
import { buildDelivery, WINDOWS } from "@/lib/calc/delivery";
import { addDays, istDate } from "@/lib/time/ist";
import { eventMarkers, KIND_COLOR } from "@/lib/view/alerts";
import { buildSectorRows } from "@/lib/view/dashboard";
import { PriceChart, type ChartMarker } from "../components/chart/PriceChart";
import { DashboardTimeline } from "../components/dashboard/DashboardTimeline";
import { DeliveryMini } from "../components/dashboard/DeliveryMini";
import { MoversPanel } from "../components/dashboard/MoversPanel";
import { NiftyCard } from "../components/dashboard/NiftyCard";
import { SectorStrip } from "../components/dashboard/SectorStrip";
import { PortfolioSnapshot } from "../components/portfolio/PortfolioSnapshot";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const repo = getRepo();
  const today = istDate(new Date());
  // History only changes at end of day, so it is memoised; movers, holdings, alerts and delivery stay live.
  const [history, [movers, portfolio], events, deliveryRows, stockNames] = await Promise.all([
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
    repo.listDelivery(addDays(today, -45)).catch(() => []),
    cached("stock-names", async () => new Map((await repo.listInstruments({ types: ["stock"] })).map((i) => [i.key, i.name])), 600_000),
  ]);
  const { niftyDays, sectors } = history;
  const niftyDates = niftyDays.filter((d) => d.close !== null).map((d) => d.date);

  // Your alert events, pinned on the chart at the session they fired.
  const markers: ChartMarker[] = eventMarkers(events, niftyDates).map((m) => ({ time: m.time, text: m.key, color: KIND_COLOR[m.kind] }));

  const longest = WINDOWS[WINDOWS.length - 1]!;
  const hits = buildDelivery(deliveryRows).shortlists.find((s) => s.days === longest.days)?.hits.slice(0, 3) ?? [];
  const names: Record<string, string> = {};
  for (const h of hits) {
    const n = stockNames.get(h.symbol);
    if (n) names[h.symbol] = n;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <NiftyCard days={niftyDays} />
        <DashboardTimeline events={events} />
        <PriceChart days={niftyDays} title="NIFTY 50" height={520} markers={markers} />
        <MoversPanel initial={movers} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectorStrip rows={buildSectorRows(sectors, niftyDates.slice(-70))} />
        <PortfolioSnapshot holdings={portfolio.holdings} latest={portfolio.latest} today={today} />
        <DeliveryMini hits={hits} days={longest.days} names={names} />
      </div>
    </div>
  );
}
