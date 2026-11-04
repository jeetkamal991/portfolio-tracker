import { loadMarket } from "@/lib/api/market";
import { cached, getRepo } from "@/lib/api/server";
import { buildDelivery } from "@/lib/calc/delivery";
import { addDays, istDate } from "@/lib/time/ist";
import { AlphaGrid } from "../../components/market/AlphaGrid";
import { BreadthPanel } from "../../components/market/BreadthPanel";
import { DeliveryPanel } from "../../components/market/DeliveryPanel";
import { ClaudeSummaryCard } from "../../components/market/ClaudeSummaryCard";
import { ScreenerGrid } from "../../components/market/ScreenerGrid";
import { StakeScreeners } from "../../components/market/StakeScreeners";
import { WatchSignalsPanel } from "../../components/market/WatchSignalsPanel";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const repo = getRepo();
  const today = istDate(new Date());
  const [m, deliveryRows, stockNames] = await Promise.all([
    loadMarket(repo, today),
    // 45 calendar days is more than the 20 sessions the longest window needs
    repo.listDelivery(addDays(today, -45)).catch((e) => { console.error("delivery load failed", e); return []; }),
    cached("stock-names", async () => new Map((await repo.listInstruments({ types: ["stock"] })).map((i) => [i.key, i.name])), 600_000),
  ]);
  const delivery = buildDelivery(deliveryRows);
  const names: Record<string, string> = {};
  for (const sym of new Set([...delivery.today.map((t) => t.symbol), ...delivery.shortlists.flatMap((s) => s.hits.map((h) => h.symbol))])) {
    const n = stockNames.get(sym);
    if (n) names[sym] = n;
  }
  return (
    <div className="flex flex-col gap-6">
      <ClaudeSummaryCard summary={m.summary} session={m.session} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <WatchSignalsPanel signals={m.watchSignals} hasWatchStocks={m.hasWatchStocks} />
          <ScreenerGrid screeners={m.screeners} session={m.session} hasUniverse={m.hasUniverse} />
          <AlphaGrid alphas={m.alphas} session={m.session} hasUniverse={m.hasUniverse} />
          <DeliveryPanel view={delivery} names={names} />
          {m.hasUniverse && <StakeScreeners stakes={m.stakes} />}
        </div>
        <div className="min-w-0">
          <BreadthPanel breadth={m.breadth} hasUniverse={m.hasUniverse} />
        </div>
      </div>
    </div>
  );
}
