import { Suspense, type ReactNode } from "react";
import { cached, getRepo } from "@/lib/api/server";
import { STRIP_KEYS } from "@/lib/instruments";
import { isMarketOpen } from "@/lib/time/ist";
import { buildAsOf, buildTodaySummary, latestPctDate } from "@/lib/view/dashboard";
import { QuotesProvider } from "../components/QuotesProvider";
import { StockModal } from "../components/popup/StockModal";
import { TopBar } from "../components/shell/TopBar";
import { StatusStrip, type StripItem } from "../components/shell/StatusStrip";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const repo = getRepo();
  const now = new Date();
  const { insts, lastRun, stripDays } = await cached("layout-strip", async () => {
    const [insts, lastRun] = await Promise.all([
      Promise.all(STRIP_KEYS.map((k) => repo.getInstrumentByKey(k))),
      repo.lastJobRun("eod"),
    ]);
    const stripDays = await Promise.all(insts.map((i) => (i ? repo.getDays(i.id, 10) : Promise.resolve([]))));
    return { insts, lastRun, stripDays };
  });

  const items: StripItem[] = STRIP_KEYS.map((k, n) => {
    const days = stripDays[n];
    const lastPriced = [...days].reverse().find((d) => d.close !== null);
    return {
      ticker: insts[n]?.yahooTicker ?? k,
      name: insts[n]?.name ?? k,
      close: lastPriced?.close ?? null,
      pct: buildTodaySummary(days),
    };
  });
  // NIFTY50 is the first strip key; its last 10 rows are enough to find the latest dated %.
  const asOf = buildAsOf(latestPctDate(stripDays[STRIP_KEYS.indexOf("NIFTY50")]), lastRun, now);

  return (
    <>
      <TopBar />
      <QuotesProvider initialOpen={isMarketOpen(now)}>
        <StatusStrip items={items} asOf={asOf} initialNow={now.toISOString()} />
        <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">{children}</main>
        <Suspense fallback={null}>
          <StockModal />
        </Suspense>
      </QuotesProvider>
    </>
  );
}
