import type { Repo } from "@/lib/db/repo";
import type { AlertRule } from "@/lib/db/types";
import { STRIP_KEYS } from "@/lib/instruments";
import { INTRADAY_CONDITIONS, runAlerts } from "@/lib/jobs/alerts";
import type { Sender } from "@/lib/notify/telegram";
import type { Quote } from "@/lib/provider/types";
import { isMarketOpen } from "@/lib/time/ist";

const INTRADAY_EVERY_MS = 60_000;
/** Per server instance: the intraday alert pass runs at most once a minute. */
let lastIntradayRun = 0;
export const _resetIntradayClock = () => { lastIntradayRun = 0; };

/**
 * Live quotes for the strip, watchlist and holdings. During market hours (and with `alerts`), at most once a
 * minute it also evaluates the price and holding alert rules on the same quotes, fetching quotes for the rules'
 * stocks too. An alert-pass problem is logged and never stops the quotes.
 */
export async function handleQuotes(
  repo: Repo,
  cache: { get(tickers: string[]): Promise<Quote[]> },
  now: Date = new Date(),
  alerts?: { send: Sender },
): Promise<{ quotes: Quote[]; marketOpen: boolean }> {
  const marketOpen = isMarketOpen(now);
  const due = !!alerts && marketOpen && now.getTime() - lastIntradayRun >= INTRADAY_EVERY_MS;
  let rules: AlertRule[] = [];
  if (due) {
    lastIntradayRun = now.getTime();
    try {
      rules = await repo.listAlertRules({ activeOnly: true, conditions: INTRADAY_CONDITIONS });
    } catch (e) {
      console.error("intraday alerts: rules", e);
    }
  }

  const strip = (await Promise.all(STRIP_KEYS.map((k) => repo.getInstrumentByKey(k)))).flatMap((i) => i ?? []);
  const watch = await repo.listWatchlist();
  const held = await repo.listHoldings();
  const tickers = [...new Set([...strip, ...watch, ...held, ...rules].map((i) => i.yahooTicker))];
  const quotes = await cache.get(tickers);

  if (alerts && rules.length > 0) {
    try {
      await runAlerts({ repo, send: alerts.send, now, mode: "intraday", rules, quotes: Object.fromEntries(quotes.map((q) => [q.ticker, q])) });
    } catch (e) {
      console.error("intraday alerts", e);
    }
  }
  return { quotes, marketOpen };
}
