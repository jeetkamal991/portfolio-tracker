import type { Repo } from "@/lib/db/repo";
import type { Instrument } from "@/lib/db/types";
import type { MarketDataProvider } from "@/lib/provider/types";
import { addDays, istDate } from "@/lib/time/ist";
import { isUnknownSymbolError } from "@/lib/provider/errors";
import { loadCloses, recomputeInstrument } from "./eod";
import { pool } from "./pool";
import { scorePass } from "./score";
import { listUniverseStocks } from "@/lib/universe/stocks";

export interface BackfillDeps {
  repo: Repo;
  provider: MarketDataProvider;
  now: Date;
}

const NIFTY_KEY = "NIFTY50";
const STOCK_HISTORY_DAYS = 730;

async function niftyClosesFor(repo: Repo, inst: Instrument): Promise<Map<string, number>> {
  const nifty = inst.key === NIFTY_KEY ? inst : await repo.getInstrumentByKey(NIFTY_KEY);
  return nifty ? loadCloses(repo, nifty.id) : new Map();
}

/** Store already-fetched candles, then recompute and persist indicators for every stored day. */
async function store(deps: BackfillDeps, inst: Instrument, candles: Awaited<ReturnType<MarketDataProvider["getDailyHistory"]>>): Promise<void> {
  await deps.repo.upsertCandles(inst.id, candles);
  const niftyCloses = await niftyClosesFor(deps.repo, inst);
  await recomputeInstrument(deps.repo, inst, niftyCloses, { upsertAll: true });
}

/** Fetch history from `fromDate` to today, store it, recompute indicators for all days. Returns candles stored. */
export async function backfillInstrument(deps: BackfillDeps, inst: Instrument, fromDate: string): Promise<number> {
  const candles = await deps.provider.getDailyHistory(inst.yahooTicker, fromDate, istDate(deps.now));
  if (candles.length === 0) return 0;
  await store(deps, inst, candles);
  return candles.length;
}

export type AddStockResult = { ok: true } | { ok: false; error: "unknown_symbol" | "no_data" | "already_added" };

export async function addStock(deps: BackfillDeps, key: string): Promise<AddStockResult> {
  const inst = await deps.repo.getInstrumentByKey(key);
  if (!inst || inst.type !== "stock") return { ok: false, error: "unknown_symbol" };
  if ((await deps.repo.listWatchlist()).some((w) => w.id === inst.id)) return { ok: false, error: "already_added" };

  const today = istDate(deps.now);
  let candles;
  try {
    candles = await deps.provider.getDailyHistory(inst.yahooTicker, addDays(today, -STOCK_HISTORY_DAYS), today);
  } catch {
    return { ok: false, error: "no_data" };
  }
  if (candles.length === 0) return { ok: false, error: "no_data" };

  await store(deps, inst, candles);
  await deps.repo.addToWatchlist(inst.id);
  // The stock is stored and watchlisted; a scoring hiccup only delays its score to the next EOD run.
  try {
    await scorePass(deps.repo, { onlyIds: new Set([inst.id]) });
  } catch {
    /* scored by the next EOD run */
  }
  return { ok: true };
}

const UNIVERSE_CONCURRENCY = 4;

export interface BackfillUniverseResult {
  done: number;
  /** Transient errors (network, rate limit): retried by the next run. */
  failed: string[];
  /** Symbols Yahoo has no data for: deactivated so EOD stops retrying them. */
  unknown: string[];
  /** "KEY (error)" for instruments the final score pass could not score. */
  scoreFailed: string[];
}

/** Back-fill the stock universe (Nifty 200, sector constituents, watchlist) from `from`, then score once. */
export async function backfillUniverse(
  deps: BackfillDeps,
  opts: { from: string; onProgress?: (key: string, n: number) => void },
): Promise<BackfillUniverseResult> {
  const stocks = await listUniverseStocks(deps.repo);
  const failed: string[] = [];
  const unknown: Instrument[] = [];
  let done = 0;
  await pool(stocks, UNIVERSE_CONCURRENCY, async (inst) => {
    try {
      const n = await backfillInstrument(deps, inst, opts.from);
      if (n === 0) { unknown.push(inst); return; }
      done++;
      opts.onProgress?.(inst.key, n);
    } catch (e) {
      if (isUnknownSymbolError(e)) unknown.push(inst);
      else failed.push(inst.key);
    }
  });
  if (unknown.length > 0) {
    await deps.repo.upsertInstruments(unknown.map((i) => ({ key: i.key, name: i.name, type: i.type, yahooTicker: i.yahooTicker, active: false })));
  }
  let scoreFailed: string[];
  try {
    scoreFailed = (await scorePass(deps.repo)).failed;
  } catch (e) {
    scoreFailed = [`score pass (${e instanceof Error ? e.message : String(e)})`];
  }
  return { done, failed: failed.sort(), unknown: unknown.map((i) => i.key).sort(), scoreFailed };
}
