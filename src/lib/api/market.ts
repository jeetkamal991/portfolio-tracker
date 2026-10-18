import type { Repo } from "@/lib/db/repo";
import { runScreeners, type ScreenerResult } from "@/lib/calc/screeners";
import { parseDailySummary, type ParsedSummary } from "@/lib/content/claude";
import { buildBreadth, type Breadth } from "@/lib/view/breadth";

export interface MarketData {
  session: string | null;
  summary: ParsedSummary | null;
  screeners: ScreenerResult[];
  breadth: Breadth | null;
  hasUniverse: boolean;
}

/**
 * The session is NIFTY50's latest priced date, so a weekend shows Friday's data and summary;
 * `today` is accepted for the page's signature but does not pick the session.
 */
export async function loadMarket(repo: Repo, today: string): Promise<MarketData> {
  void today;
  const [nifty, vix, constituents] = await Promise.all([
    repo.getInstrumentByKey("NIFTY50"),
    repo.getInstrumentByKey("INDIAVIX"),
    repo.listConstituents("NIFTY200"),
  ]);
  const hasUniverse = constituents.length > 0;
  const latest = nifty ? await repo.getLatestDay(nifty.id) : null;
  if (!nifty || !latest) return { session: null, summary: null, screeners: [], breadth: null, hasUniverse };

  const session = latest.date;
  const [niftyDays, vixDays, summaryRow] = await Promise.all([
    repo.getDays(nifty.id, 12),
    vix ? repo.getDays(vix.id, 25) : Promise.resolve([]),
    repo.getDailySummary(session),
  ]);
  const summary = summaryRow ? parseDailySummary(summaryRow) : null;
  if (!hasUniverse) {
    return { session, summary, screeners: [], breadth: buildBreadth([], vixDays), hasUniverse };
  }

  // Newer or unpriced rows must not shrink the window: keep priced sessions up to `session`, then the last 6.
  const window = niftyDays.filter((d) => d.close !== null && d.date <= session).slice(-6);
  const fromDate = window[0]?.date ?? session;
  const range = await repo.getDaysRange(constituents.map((c) => c.id), fromDate, session);
  const stocks = constituents.map((c) => ({ key: c.key, name: c.name, days: range.get(c.id) ?? [] }));
  const sessionRows = stocks.flatMap((s) => s.days.filter((d) => d.date === session));
  return {
    session, summary,
    screeners: runScreeners(stocks, session),
    breadth: buildBreadth(sessionRows, vixDays),
    hasUniverse,
  };
}
