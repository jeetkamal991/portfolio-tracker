import type { Repo } from "@/lib/db/repo";
import type { Instrument, JobRun, JobStatus } from "@/lib/db/types";
import type { MarketDataProvider } from "@/lib/provider/types";
import { computeIndicators } from "@/lib/calc/indicators";
import { swingLevels } from "@/lib/calc/swing";
import { addDays, istDate } from "@/lib/time/ist";

export interface EodDeps {
  repo: Repo;
  provider: MarketDataProvider;
  now: Date;
  concurrency?: number;
}

const NIFTY_KEY = "NIFTY50";
const FULL_HISTORY = 100_000;
const INDICATOR_TAIL = 10;

/** date -> close over an instrument's full stored series (null-close days skipped). */
export async function loadCloses(repo: Repo, instrumentId: number): Promise<Map<string, number>> {
  const days = await repo.getDays(instrumentId, FULL_HISTORY);
  const m = new Map<string, number>();
  for (const d of days) if (d.close !== null) m.set(d.date, d.close);
  return m;
}

/**
 * Recompute indicators over the instrument's full stored history (so values are identical whichever
 * job wrote them), persist the last 10 rows, and refresh auto levels for stocks.
 * Also used by back-fill / add-stock.
 */
export async function recomputeInstrument(
  repo: Repo,
  inst: Instrument,
  niftyCloses: Map<string, number>,
): Promise<void> {
  const stored = await repo.getDays(inst.id, FULL_HISTORY);
  const priced: { date: string; close: number }[] = [];
  for (const d of stored) if (d.close !== null) priced.push({ date: d.date, close: d.close });
  if (priced.length === 0) return;

  const rows = computeIndicators(priced, niftyCloses);
  await repo.upsertIndicators(inst.id, rows.slice(-INDICATOR_TAIL));

  if (inst.type === "stock") {
    const bars: { high: number; low: number }[] = [];
    for (const d of stored) if (d.high !== null && d.low !== null && d.close !== null) bars.push({ high: d.high, low: d.low });
    const cmp = priced[priced.length - 1]!.close;
    const { support, resistance } = swingLevels(bars, cmp);
    await repo.setAutoLevels(inst.id, support, resistance);
  }
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

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

export async function runEod(deps: EodDeps): Promise<JobRun> {
  const startedAt = new Date().toISOString();
  const { repo } = deps;
  const failed: string[] = [];
  let updated = 0;
  let noSession = 0;
  let status: JobStatus;
  let message = "";

  try {
    const [core, watch] = await Promise.all([
      repo.listInstruments({ types: ["index", "sector"], activeOnly: true }),
      repo.listWatchlist(),
    ]);
    const seen = new Set<number>();
    const targets = [...core, ...watch.filter((w) => w.active)].filter((i) => !seen.has(i.id) && !!seen.add(i.id));

    const record = (r: "updated" | "no_session") => {
      if (r === "updated") updated++;
      else noSession++;
    };
    const fail = (key: string, e: unknown) =>
      failed.push(`${key} (${e instanceof Error ? e.message : String(e)})`);

    // NIFTY50 first: its stored closes feed RS for everything else.
    let niftyCloses = new Map<string, number>();
    const nifty = targets.find((i) => i.key === NIFTY_KEY);
    if (nifty) {
      try {
        const r = await ingest(deps, nifty);
        niftyCloses = await loadCloses(repo, nifty.id);
        await recomputeInstrument(repo, nifty, niftyCloses);
        record(r);
      } catch (e) {
        fail(nifty.key, e);
        // Fall back to whatever Nifty history is already stored, if readable.
        try { niftyCloses = await loadCloses(repo, nifty.id); } catch { /* RS stays null */ }
      }
    }

    await pool(
      targets.filter((i) => i !== nifty),
      deps.concurrency ?? 5,
      async (inst) => {
        try {
          record(await refreshInstrument(deps, inst, niftyCloses));
        } catch (e) {
          fail(inst.key, e);
        }
      },
    );

    if (targets.length > 0 && failed.length === targets.length) status = "failed";
    else if (failed.length > 0) status = "partial";
    else if (targets.length > 0 && noSession === targets.length) status = "no_session";
    else status = "ok";
    message = `updated ${updated}, no_session ${noSession}, failed ${failed.length}` +
      (failed.length ? `: ${failed.join("; ")}` : "");
  } catch (e) {
    status = "failed";
    message = `EOD job error: ${e instanceof Error ? e.message : String(e)}`;
  }

  const run: JobRun = { job: "eod", startedAt, finishedAt: new Date().toISOString(), status, message };
  await repo.logJobRun(run);
  return run;
}
