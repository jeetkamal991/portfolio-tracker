import { loadMarket } from "@/lib/api/market";
import { getRepo } from "@/lib/api/server";
import { istDate } from "@/lib/time/ist";
import { BreadthPanel } from "../../components/market/BreadthPanel";
import { ClaudeSummaryCard } from "../../components/market/ClaudeSummaryCard";
import { ScreenerGrid } from "../../components/market/ScreenerGrid";
import { WatchSignalsPanel } from "../../components/market/WatchSignalsPanel";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const m = await loadMarket(getRepo(), istDate(new Date()));
  return (
    <div className="flex flex-col gap-6">
      <ClaudeSummaryCard summary={m.summary} session={m.session} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <WatchSignalsPanel signals={m.watchSignals} hasWatchStocks={m.hasWatchStocks} />
          <ScreenerGrid screeners={m.screeners} session={m.session} hasUniverse={m.hasUniverse} />
        </div>
        <div className="min-w-0">
          <BreadthPanel breadth={m.breadth} hasUniverse={m.hasUniverse} />
        </div>
      </div>
    </div>
  );
}
