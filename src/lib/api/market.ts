import type { Repo } from "@/lib/db/repo";
import { runScreeners, type ScreenerResult } from "@/lib/calc/screeners";
import { runWatchSignals, type WatchSignals } from "@/lib/calc/watchSignals";
import { previousQuarterEnd, rankStakeIncreases, type StakeScreener } from "@/lib/calc/shareholding";
import { parseDailySummary, type ParsedSummary } from "@/lib/content/claude";
import { buildBreadth, type Breadth } from "@/lib/view/breadth";

export interface MarketData {
  session: string | null;
  summary: ParsedSummary | null;
  screeners: ScreenerResult[];
  breadth: Breadth | null;
  hasUniverse: boolean;
  /** Crosses and candle patterns on watchlist + portfolio stocks over the last 5 sessions. */
  watchSignals: WatchSignals;
  hasWatchStocks: boolean;
  /** Quarterly FII / DII stake increases; null until shareholding data exists. */
  stakes: { fii: StakeScreener; dii: StakeScreener } | null;
}

const NO_SIGNALS: WatchSignals = { crosses: [], formations: [] };

async function loadStakes(repo: Repo, members: { id: number; key: string; name: string }[]): Promise<MarketData["stakes"]> {
  const latest = await repo.latestShareholdingQuarter();
  if (!latest) return null;
  const rows = await repo.listShareholding([latest, previousQuarterEnd(latest)]);
  return { fii: rankStakeIncreases("FII", members, rows, latest), dii: rankStakeIncreases("DII", members, rows, latest) };
}

/**
 * The session is NIFTY50's latest priced date, so a weekend shows Friday's data and summary;
 * `today` is accepted for the page's signature but does not pick the session.
 */
export async function loadMarket(repo: Repo, today: string): Promise<MarketData> {
  void today;
  const [nifty, vix, constituents, watchlist, holdings] = await Promise.all([
    repo.getInstrumentByKey("NIFTY50"),
    repo.getInstrumentByKey("INDIAVIX"),
    repo.listConstituents("NIFTY200"),
    repo.listWatchlist(),
    repo.listHoldings(),
  ]);
  const hasUniverse = constituents.length > 0;
  const stakes = hasUniverse ? await loadStakes(repo, constituents) : null;
  // watchlist first, then holdings not already on it
  const watch = new Map<number, { key: string; name: string }>();
  for (const w of watchlist) watch.set(w.id, { key: w.key, name: w.name });
  for (const h of holdings) if (!watch.has(h.instrumentId)) watch.set(h.instrumentId, { key: h.key, name: h.name });
  const hasWatchStocks = watch.size > 0;

  const latest = nifty ? await repo.getLatestDay(nifty.id) : null;
  if (!nifty || !latest) {
    return { session: null, summary: null, screeners: [], breadth: null, hasUniverse, watchSignals: NO_SIGNALS, hasWatchStocks, stakes };
  }

  const session = latest.date;
  const [niftyDays, vixDays, summaryRow] = await Promise.all([
    repo.getDays(nifty.id, 12),
    vix ? repo.getDays(vix.id, 25) : Promise.resolve([]),
    repo.getDailySummary(session),
  ]);
  const summary = summaryRow ? parseDailySummary(summaryRow) : null;
  if (!hasUniverse && !hasWatchStocks) {
    return { session, summary, screeners: [], breadth: buildBreadth([], vixDays), hasUniverse, watchSignals: NO_SIGNALS, hasWatchStocks, stakes };
  }

  // Newer or unpriced rows must not shrink the window: keep priced sessions up to `session`, then the last 6.
  const window = niftyDays.filter((d) => d.close !== null && d.date <= session).slice(-6);
  const fromDate = window[0]?.date ?? session;
  const ids = [...new Set([...constituents.map((c) => c.id), ...watch.keys()])];
  const range = await repo.getDaysRange(ids, fromDate, session);
  const stocks = constituents.map((c) => ({ key: c.key, name: c.name, days: range.get(c.id) ?? [] }));
  const watchStocks = [...watch].map(([id, w]) => ({ ...w, days: range.get(id) ?? [] }));
  const sessionRows = stocks.flatMap((s) => s.days.filter((d) => d.date === session));
  return {
    session, summary,
    screeners: hasUniverse ? runScreeners(stocks, session) : [],
    breadth: buildBreadth(sessionRows, vixDays),
    hasUniverse,
    watchSignals: runWatchSignals(watchStocks, session),
    hasWatchStocks,
    stakes,
  };
}
