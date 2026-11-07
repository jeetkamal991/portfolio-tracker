import { loadMarket } from "@/lib/api/market";
import { cached, getRepo } from "@/lib/api/server";
import { buildDelivery } from "@/lib/calc/delivery";
import { addDays, istDate } from "@/lib/time/ist";
import { parseView } from "@/lib/view/marketViews";
import { TodayByClaudeCompact } from "../../components/dashboard/TodayByClaudeCompact";
import { BreadthPanel } from "../../components/market/BreadthPanel";
import { ClaudeSummaryCard } from "../../components/market/ClaudeSummaryCard";
import { RepeatDeliveryCard, TodayDeliveryCard } from "../../components/market/DeliveryCards";
import { MarketBoard, ViewLink } from "../../components/market/MarketBoard";
import { ScreenerGrid } from "../../components/market/ScreenerGrid";
import { SignalsSummary } from "../../components/market/SignalsSummary";
import { StakeCard } from "../../components/market/StakeScreeners";
import { WatchSignalsPanel } from "../../components/market/WatchSignalsPanel";
import { Panel } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  const repo = getRepo();
  const today = istDate(new Date());
  const [m, deliveryRows, stockNames] = await Promise.all([
    loadMarket(repo, today, { memo: cached }),
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

  const signalCount = m.watchSignals.crosses.length + m.watchSignals.formations.length;
  const flows = (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <TodayDeliveryCard view={delivery} names={names} />
      <RepeatDeliveryCard view={delivery} names={names} />
      {m.hasUniverse && m.stakes ? (
        <>
          <StakeCard s={m.stakes.fii} />
          <StakeCard s={m.stakes.dii} />
        </>
      ) : (
        <Panel title="STAKE CHANGES · NIFTY 200 · QUARTERLY" className="md:col-span-2">
          <p className="text-sm text-[var(--muted)]">Shareholding data appears after the quarterly update runs.</p>
        </Panel>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <TodayByClaudeCompact summary={m.summary} session={m.session} details={<ViewLink view="today">Full details →</ViewLink>} />
        </div>
        <BreadthPanel breadth={m.breadth} hasUniverse={m.hasUniverse} />
        <SignalsSummary signals={m.watchSignals} hasWatchStocks={m.hasWatchStocks} />
      </div>
      <MarketBoard
        initial={parseView(v)}
        counts={{ screeners: m.screeners.length, you: signalCount }}
        views={{
          today: <ClaudeSummaryCard summary={m.summary} session={m.session} />,
          screeners: <ScreenerGrid screeners={m.screeners} session={m.session} hasUniverse={m.hasUniverse} />,
          flows,
          you: <WatchSignalsPanel signals={m.watchSignals} hasWatchStocks={m.hasWatchStocks} />,
        }}
      />
    </div>
  );
}
