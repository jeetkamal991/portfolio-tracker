import type { Repo } from "@/lib/db/repo";
import type { Instrument, JobRun, JobRunResult, PriceBar } from "@/lib/db/types";
import type { MarketDataProvider } from "@/lib/provider/types";
import { computeIndicators } from "@/lib/calc/indicators";
import { swingLevels } from "@/lib/calc/swing";
import { createTelegramSender, type Sender } from "@/lib/notify/telegram";
import { addDays, istDate } from "@/lib/time/ist";
import { latestDaySnapshots, runAlerts, syncHoldingAlerts } from "./alerts";
import { pool } from "./pool";
import { scorePass } from "./score";
import { listUniverseStocks } from "@/lib/universe/stocks";

export interface EodDeps {
  repo: Repo;
  provider: MarketDataProvider;
  now: Date;
  concurrency?: number;
  /** Telegram delivery for the alert pass; without it events are saved as `not_configured`. */
  send?: Sender;
}

const NIFTY_KEY = "NIFTY50";
const FULL_HISTORY = 100_000;
const INDICATOR_TAIL = 10;

/** date -> close over a stored series (null-close days skipped). */
function closesOf(bars: PriceBar[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of bars) if (d.close !== null) m.set(d.date, d.close);
  return m;
}

/** date -> close over an instrument's full stored series (null-close days skipped). */
export async function loadCloses(repo: Repo, instrumentId: number): Promise<Map<string, number>> {
  return closesOf(await repo.getPriceBars(instrumentId, FULL_HISTORY));
}

/** Recompute from already-loaded bars (the instrument's full stored history, ascending). */
async function recomputeFromBars(
  repo: Repo,
  inst: Instrument,
  stored: PriceBar[],
  niftyCloses: Map<string, number>,
  opts: { upsertAll?: boolean },
): Promise<void> {
  const priced: Parameters<typeof computeIndicators>[0] = [];
  for (const d of stored) {
    if (d.close !== null) {
      priced.push({ date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume });
    }
  }
  if (priced.length === 0) return;

  const rows = computeIndicators(priced, niftyCloses);
  await repo.upsertIndicators(inst.id, opts.upsertAll ? rows : rows.slice(-INDICATOR_TAIL));

  if (inst.type === "stock") {
    const bars: { high: number; low: number }[] = [];
    for (const d of stored) if (d.high !== null && d.low !== null && d.close !== null) bars.push({ high: d.high, low: d.low });
    const cmp = priced[priced.length - 1]!.close;
    const { support, resistance } = swingLevels(bars, cmp);
    await repo.setAutoLevels(inst.id, support, resistance);
  }
}

/**
 * Recompute indicators over the instrument's full stored history (so values are identical whichever
 * job wrote them), persist the last 10 rows (every row with `upsertAll`), and refresh auto levels
 * for stocks. Reads only date/close/high/low.
 * Also used by back-fill / add-stock.
 */
export async function recomputeInstrument(
  repo: Repo,
  inst: Instrument,
  niftyCloses: Map<string, number>,
  opts: { upsertAll?: boolean } = {},
): Promise<void> {
  await recomputeFromBars(repo, inst, await repo.getPriceBars(inst.id, FULL_HISTORY), niftyCloses, opts);
}

/** Fetch the last ~10 days, store them, report whether today's session is present. */
async function ingest(deps: EodDeps, inst: Instrument): Promise<"updated" | "no_session"> {
  const today = istDate(deps.now);
  const candles = await deps.provider.getDailyHistory(inst.yahooTicker, addDays(today, -10), today);
  if (candles.length > 0) await deps.repo.upsertCandles(inst.id, candles);
  const newest = candles.length ? candles[candles.length - 1]!.date : null;
  return newest === today ? "updated" : "no_session";
}

export async function refreshInstrument(
  deps: EodDeps,
  inst: Instrument,
  niftyCloses: Map<string, number>,
): Promise<"updated" | "no_session"> {
  const result = await ingest(deps, inst);
  await recomputeInstrument(deps.repo, inst, niftyCloses);
  return result;
}

export { pool };

async function work(deps: EodDeps): Promise<Omit<JobRunResult, "finishedAt">> {
  const { repo } = deps;
  const failed: string[] = [];
  let updated = 0;
  let noSession = 0;

  const [core, stocks, constituents] = await Promise.all([
    repo.listInstruments({ types: ["index", "sector"], activeOnly: true }),
    listUniverseStocks(repo),
    // Only for the run message's Nifty 200 count.
    repo.listConstituents("NIFTY200"),
  ]);
  const seen = new Set<number>();
  const targets = [...core, ...stocks].filter((i) => !seen.has(i.id) && !!seen.add(i.id));

  const record = (r: "updated" | "no_session") => {
    if (r === "updated") updated++;
    else noSession++;
  };
  const fail = (key: string, e: unknown) =>
    failed.push(`${key} (${e instanceof Error ? e.message : String(e)})`);

  // NIFTY50 first: its stored closes feed RS (and the trading calendar) for everything else.
  // Its history is read once and reused for both its own recompute and the closes map.
  let niftyCloses = new Map<string, number>();
  const nifty = targets.find((i) => i.key === NIFTY_KEY);
  if (nifty) {
    try {
      const r = await ingest(deps, nifty);
      const bars = await repo.getPriceBars(nifty.id, FULL_HISTORY);
      niftyCloses = closesOf(bars);
      await recomputeFromBars(repo, nifty, bars, niftyCloses, {});
      record(r);
    } catch (e) {
      fail(nifty.key, e);
      // Fall back to whatever Nifty history is already stored, if readable.
      if (niftyCloses.size === 0) {
        try { niftyCloses = await loadCloses(repo, nifty.id); } catch { /* RS stays null */ }
      }
    }
  }

  await pool(
    targets.filter((i) => i !== nifty),
    deps.concurrency ?? 8,
    async (inst) => {
      try {
        record(await refreshInstrument(deps, inst, niftyCloses));
      } catch (e) {
        fail(inst.key, e);
      }
    },
  );

  // A score-pass problem never undoes the ingests above: it downgrades the run to partial.
  let skipped: string[] = [];
  let scoreFailed: string[] = [];
  let scoreError: string | null = null;
  try {
    ({ skipped, failed: scoreFailed } = await scorePass(repo));
  } catch (e) {
    scoreError = e instanceof Error ? e.message : String(e);
  }

  // Alerts after scores (they read the new score rows). Holding rules are synced first so a holding added
  // before alerts existed gets its SL/target rules. A problem here also only downgrades the run to partial.
  let alerts: Awaited<ReturnType<typeof runAlerts>> | null = null;
  let alertError: string | null = null;
  try {
    await syncHoldingAlerts(repo, latestDaySnapshots(repo, deps.now));
    alerts = await runAlerts({ repo, send: deps.send ?? createTelegramSender({}), now: deps.now, mode: "eod" });
  } catch (e) {
    alertError = e instanceof Error ? e.message : String(e);
  }

  let status: JobRunResult["status"];
  if (targets.length > 0 && failed.length === targets.length) status = "failed";
  else if (failed.length > 0 || scoreFailed.length > 0 || scoreError || alertError) status = "partial";
  else if (targets.length > 0 && noSession === targets.length) status = "no_session";
  else status = "ok";
  const notes = [
    failed.length ? failed.join("; ") : "",
    skipped.length ? `skipped: ${skipped.join(", ")}` : "",
    scoreFailed.length ? `score failed: ${scoreFailed.join("; ")}` : "",
    scoreError ? `score pass error: ${scoreError}` : "",
    alertError ? `alert pass error: ${alertError}` : "",
  ].filter(Boolean);
  const message =
    `updated ${updated}, no_session ${noSession}, failed ${failed.length}, skipped ${skipped.length}, ` +
    `constituents ${constituents.length}` +
    (alerts ? `, alerts fired ${alerts.fired}, telegram failed ${alerts.telegramFailed}` : "") + (notes.length ? `: ${notes.join(" | ")}` : "");
  return { status, message };
}

/**
 * Writes a `running` job_runs row first and finishes it at the end, so a run that dies
 * (e.g. a function timeout) still leaves a trace the dashboard can flag.
 */
export async function runEod(deps: EodDeps): Promise<JobRun> {
  const startedAt = new Date().toISOString();
  const id = await deps.repo.startJobRun("eod", startedAt);

  let outcome: Omit<JobRunResult, "finishedAt">;
  try {
    outcome = await work(deps);
  } catch (e) {
    outcome = { status: "failed", message: `EOD job error: ${e instanceof Error ? e.message : String(e)}` };
  }

  const result: JobRunResult = { ...outcome, finishedAt: new Date().toISOString() };
  await deps.repo.finishJobRun(id, result);
  return { job: "eod", startedAt, ...result };
}
