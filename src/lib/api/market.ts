import type { Repo } from "@/lib/db/repo";
import { runScreeners, type ScreenerResult } from "@/lib/calc/screeners";
import { runWatchSignals, type WatchSignals } from "@/lib/calc/watchSignals";
import { previousQuarterEnd, rankStakeIncreases, type StakeScreener } from "@/lib/calc/shareholding";
import { parseDailySummary, type ParsedSummary } from "@/lib/content/claude";
import type { StoredDay } from "@/lib/db/types";
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

/** How long the universe-wide part of the Market page is reused. Prices change once a day (after the close), so a minute is safe. */
export const MARKET_UNIVERSE_TTL_MS = 60_000;

type Memo = <T>(key: string, fn: () => Promise<T>, ttlMs?: number) => Promise<T>;
/** No caching: the default, so tests and scripts always read fresh data. The page passes the real memo. */
const NO_MEMO: Memo = (_key, fn) => fn();

interface UniverseResult {
  summary: ParsedSummary | null;
  screeners: ScreenerResult[];
  breadth: Breadth;
  stakes: MarketData["stakes"];
  /** The stored rows of every universe stock for the screener window, kept so watch signals need no second read for them. */
  range: Map<number, StoredDay[]>;
  fromDate: string;
}

/**
 * The session is NIFTY50's latest priced date, so a weekend shows Friday's data and summary;
 * `today` is accepted for the page's signature but does not pick the session.
 *
 * Only the universe-wide computation (screeners, breadth, stakes, summary) goes through `opts.memo`: it is public market
 * data, identical for every user, and changes once a day. Watchlist and holdings (private, user-edited) are always read live.
 */
export async function loadMarket(repo: Repo, today: string, opts: { memo?: Memo } = {}): Promise<MarketData> {
  void today;
  const memo = opts.memo ?? NO_MEMO;
  const [nifty, vix, constituents, watchlist, holdings] = await Promise.all([
    repo.getInstrumentByKey("NIFTY50"),
    repo.getInstrumentByKey("INDIAVIX"),
    repo.listConstituents("NIFTY200"),
    repo.listWatchlist(),
    repo.listHoldings(),
  ]);
  const hasUniverse = constituents.length > 0;
  // watchlist first, then holdings not already on it
  const watch = new Map<number, { key: string; name: string }>();
  for (const w of watchlist) watch.set(w.id, { key: w.key, name: w.name });
  for (const h of holdings) if (!watch.has(h.instrumentId)) watch.set(h.instrumentId, { key: h.key, name: h.name });
  const hasWatchStocks = watch.size > 0;

  // started now, awaited at the end, so its two round trips overlap the session lookups below
  const stakesP = hasUniverse ? loadStakes(repo, constituents) : Promise.resolve(null);
  stakesP.catch(() => {}); // an early return below must not leave it rejected unhandled

  const latest = nifty ? await repo.getLatestDay(nifty.id) : null;
  if (!nifty || !latest) {
    const stakes = await stakesP;
    return { session: null, summary: null, screeners: [], breadth: null, hasUniverse, watchSignals: NO_SIGNALS, hasWatchStocks, stakes };
  }
  const session = latest.date;

  if (!hasUniverse && !hasWatchStocks) {
    const [vixDays, summaryRow] = await Promise.all([vix ? repo.getDays(vix.id, 25) : Promise.resolve([]), repo.getDailySummary(session)]);
    return { session, summary: summaryRow ? parseDailySummary(summaryRow) : null, screeners: [], breadth: buildBreadth([], vixDays), hasUniverse, watchSignals: NO_SIGNALS, hasWatchStocks, stakes: await stakesP };
  }

  const universe = await memo<UniverseResult>(`market-universe:${session}:${constituents.length}:${constituents[0]?.id ?? 0}`, async () => {
    const [niftyDays, vixDays, summaryRow] = await Promise.all([
      repo.getDays(nifty.id, 16), // spare rows for unpriced days
      vix ? repo.getDays(vix.id, 25) : Promise.resolve([]),
      repo.getDailySummary(session),
    ]);
    // Newer or unpriced rows must not shrink the windows: keep priced sessions up to `session`.
    // Screeners need indicators for the last 6 sessions.
    const priced = niftyDays.filter((d) => d.close !== null && d.date <= session);
    const fromDate = priced.slice(-6)[0]?.date ?? session;
    const [range, stakes] = await Promise.all([
      repo.getDaysRange(constituents.map((c) => c.id), fromDate, session),
      stakesP,
    ]);
    const stocks = constituents.map((c) => ({ key: c.key, name: c.name, days: range.get(c.id) ?? [] }));
    const sessionRows = stocks.flatMap((s) => s.days.filter((d) => d.date === session));
    return {
      summary: summaryRow ? parseDailySummary(summaryRow) : null,
      screeners: hasUniverse ? runScreeners(stocks, session) : [],
      breadth: buildBreadth(sessionRows, vixDays),
      stakes,
      range,
      fromDate,
    };
  }, MARKET_UNIVERSE_TTL_MS);

  // Private, user-edited state: always live. Stocks already in the universe reuse its rows; only the rest need a read.
  const missing = [...watch.keys()].filter((id) => !universe.range.has(id));
  const extra = missing.length ? await repo.getDaysRange(missing, universe.fromDate, session) : new Map<number, StoredDay[]>();
  const watchStocks = [...watch].map(([id, w]) => ({ ...w, days: universe.range.get(id) ?? extra.get(id) ?? [] }));
  return {
    session,
    summary: universe.summary,
    screeners: universe.screeners,
    breadth: universe.breadth,
    hasUniverse,
    watchSignals: runWatchSignals(watchStocks, session),
    hasWatchStocks,
    stakes: universe.stakes,
  };
}
