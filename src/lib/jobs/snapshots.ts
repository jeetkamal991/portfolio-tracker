import type { Repo } from "@/lib/db/repo";
import type { FailedSymbol, Instrument, ScoreRun, ScoreSnapshot, StoredDay } from "@/lib/db/types";
import { effectiveLevel, emaTrend } from "@/lib/calc/levels";
import { breakFor, segmentAtBreak, type DataQualityNote } from "@/lib/calc/scoreV2/dataQuality";
import { sessionCalendar, type SessionCalendar } from "@/lib/calc/returns";
import { dataConfidence } from "@/lib/calc/scoreV2/confidence";
import { SCORING_VERSION } from "@/lib/calc/scoreV2/config";
import { scoreTechnicalV2 } from "@/lib/calc/scoreV2/technical";
import { scoreTradeQuality } from "@/lib/calc/scoreV2/tradeQuality";
import { previousQuarterEnd } from "@/lib/calc/shareholding";
import { buildBreadth } from "@/lib/view/breadth";
import { addDays, istDate } from "@/lib/time/ist";
import { primarySector } from "@/lib/universe/sectors";
import { listUniverseStocks } from "@/lib/universe/stocks";
import { pool } from "./pool";

const HISTORY_BARS = 300; // EMA200 and the 34-candle ATR need a long warm-up; 60-session relative strength needs 61
const CONCURRENCY = 8;
export const SNAPSHOT_DEFAULTS = {
  /** Symbols per invocation. 237 stocks take ~33 s with 8 workers, so this is a safety bound, not a speed limit. */
  batchSize: 80,
  /** Stop starting new work after this long; the cursor saves what is done. Vercel Hobby allows 300 s. */
  maxMs: 200_000,
  /** Lease on the run, longer than maxMs so a slow invocation cannot be double-claimed, short enough to recover from a crash. */
  leaseMs: 280_000,
  /** Invocations one run may use. Bounds chaining: a run that cannot finish in this many batches is marked failed. */
  maxBatches: 12,
  /** Attempts per symbol (the first try plus retries at the end of the run). */
  maxSymbolAttempts: 3,
} as const;

export interface SnapshotContext {
  repo: Repo;
  evaluationDate: string;
  cal: SessionCalendar;
  nifty: StoredDay[];
  sectorDays: Map<string, StoredDay[]>;
  keysOf: Map<number, string[]>;
  breadth: number | null;
  stakes: Map<number, { fii: number | null; dii: number | null }>;
  deliveryBy: Map<string, number[]>;
  held: Map<string, { stopLoss: number | null; target1: number | null }>;
}

const priced = (d: StoredDay[]) => d.filter((x) => x.close !== null);

/** The latest session on Nifty's stored calendar is the evaluation date: nothing is scored for a session that has no Nifty bar. */
export async function buildContext(repo: Repo, stocks: Instrument[]): Promise<SnapshotContext> {
  const idx = await repo.listInstruments({ types: ["index", "sector"], activeOnly: true });
  const niftyInst = idx.find((i) => i.key === "NIFTY50");
  if (!niftyInst) throw new Error("NIFTY50 is not stored");
  const nifty = priced(await repo.getDays(niftyInst.id, HISTORY_BARS));
  if (nifty.length === 0) throw new Error("NIFTY50 has no priced days");
  const evaluationDate = nifty[nifty.length - 1]!.date;
  const sectorDays = new Map<string, StoredDay[]>();
  for (const i of idx.filter((x) => x.type === "sector")) sectorDays.set(i.key, priced(await repo.getDays(i.id, HISTORY_BARS)));

  const keysOf = new Map<number, string[]>();
  for (const m of await repo.listMemberships()) keysOf.set(m.instrumentId, [...(keysOf.get(m.instrumentId) ?? []), m.indexKey]);

  const sessionRows = [...(await repo.getDaysOn(stocks.map((s) => s.id), evaluationDate)).values()];
  const breadth = buildBreadth(sessionRows, []).aboveEma200;

  const stakes = new Map<number, { fii: number | null; dii: number | null }>();
  const quarter = await repo.latestShareholdingQuarter();
  if (quarter) {
    const rows = await repo.listShareholding([quarter, previousQuarterEnd(quarter)]);
    const by = new Map(rows.map((r) => [`${r.instrumentId}|${r.quarterEnd}`, r]));
    const delta = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : Math.round((a - b) * 100) / 100);
    for (const r of rows) {
      if (r.quarterEnd !== quarter) continue;
      const before = by.get(`${r.instrumentId}|${previousQuarterEnd(quarter)}`);
      stakes.set(r.instrumentId, { fii: delta(r.fiiPct, before?.fiiPct), dii: delta(r.diiPct, before?.diiPct) });
    }
  }
  const deliveryBy = new Map<string, number[]>();
  for (const r of (await repo.listDelivery(addDays(istDate(new Date()), -14))).sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.date <= evaluationDate) deliveryBy.set(r.symbol, [...(deliveryBy.get(r.symbol) ?? []), r.delivPer].slice(-5));
  }
  const held = new Map((await repo.listHoldings()).map((h) => [h.key, { stopLoss: h.stopLoss, target1: h.target1 }]));
  return { repo, evaluationDate, cal: sessionCalendar(nifty.map((d) => d.date)), nifty, sectorDays, keysOf, breadth, stakes, deliveryBy, held };
}

/** Scores one stock. Throws on a data-layer failure; returns null when the stock has no priced day on or before the evaluation date. */
export async function evaluateStock(ctx: SnapshotContext, inst: Instrument): Promise<ScoreSnapshot | null> {
  let days = priced(await ctx.repo.getDays(inst.id, HISTORY_BARS)).filter((d) => d.date <= ctx.evaluationDate);
  const last = days[days.length - 1];
  if (!last) return null;
  const lv = await ctx.repo.getLevels(inst.id);
  let support = effectiveLevel(lv.autoSupport, lv.manualSupport);
  let resistance = effectiveLevel(lv.autoResistance, lv.manualResistance);
  // A known unadjustable price break (e.g. a demerger): score only the new basis, with indicators recomputed on it.
  const quality: DataQualityNote[] = [];
  const brk = breakFor(inst.key, days);
  if (brk) {
    const seg = segmentAtBreak(days, brk, new Map(ctx.nifty.map((d) => [d.date, d.close as number])));
    days = seg.days;
    support = lv.manualSupport ?? seg.support;
    resistance = lv.manualResistance ?? seg.resistance;
    quality.push({ kind: "price_break", date: brk.date, note: brk.note, sessionsUsed: days.length });
  }
  const sec = primarySector(ctx.keysOf.get(inst.id) ?? []);
  const tech = scoreTechnicalV2({
    days, nifty: ctx.nifty, sector: sec ? (ctx.sectorDays.get(sec) ?? null) : null, breadthAboveEma200: ctx.breadth,
    support, resistance, fiiDelta: ctx.stakes.get(inst.id)?.fii ?? null, diiDelta: ctx.stakes.get(inst.id)?.dii ?? null,
    delivery: ctx.deliveryBy.get(inst.key) ?? [],
  });
  const h = ctx.held.get(inst.key);
  const trade = scoreTradeQuality({ days, support, resistance, manualStop: h?.stopLoss ?? null, manualTarget1: h?.target1 ?? null, technicalScore: tech.score });
  const conf = dataConfidence({ lastBarDate: last.date, cal: ctx.cal, bars: days.length, tech, trade });
  return {
    instrumentId: inst.id,
    symbol: inst.key,
    evaluationDate: ctx.evaluationDate,
    scoringVersion: SCORING_VERSION,
    technicalScore: tech.score,
    tradeQualityScore: trade.normalised,
    fundamentalScore: null,
    dataConfidence: conf.score,
    categoryBreakdown: { technical: tech.categories, tradeQuality: trade.categories, levels: trade.levels },
    dataCoverage: {
      technical: { coverage: tech.coverage, available: tech.available, earned: tech.earned, status: tech.status, missing: tech.missing },
      tradeQuality: { coverage: trade.coverage, available: trade.available, earned: trade.earned, status: trade.status, rankable: trade.rankable, observation: trade.observation, flags: trade.flags, missing: trade.missing },
      confidence: conf,
      fundamental: "NOT AVAILABLE",
      dataQuality: quality,
      // Share of each technical category's scorable points earned (0-100): lets rankings avoid reading the large breakdown.
      categoryShares: Object.fromEntries(tech.categories.map((c) => [c.key, c.available > 0 ? Math.round((c.earned / c.available) * 10000) / 100 : null])),
      // Plain numbers for filtering (RSI range, relative volume, trend, liquidity); null when the input was unavailable.
      metrics: {
        close: last.close,
        dayPct: last.pctChange,
        rsi: last.rsi14,
        rvol: last.volume && last.volAvg20 ? last.volume / last.volAvg20 : null,
        atrPct: trade.atr.pct,
        tradedValueCr: trade.liquidity.median === null ? null : trade.liquidity.median / 1e7,
        trend: last.close === null ? null : emaTrend(last.close, last.ema20, last.ema50, last.ema200),
        sector: sec,
        rewardRisk: trade.levels.rewardRisk,
      },
      atr: trade.atr,
      liquidity: trade.liquidity,
    },
    // The session closes at 15:30 IST (10:00 UTC); the stamp is the end of the newest bar's session.
    dataTimestamp: `${last.date}T10:00:00.000Z`,
  };
}

/** Holdings and watchlist first, then the rest by id: if a run is cut short, the stocks the owner cares about are done. */
export async function orderedUniverse(repo: Repo): Promise<Instrument[]> {
  const stocks = await listUniverseStocks(repo);
  const priority = new Set<number>([...(await repo.listWatchlist()).map((i) => i.id)]);
  for (const h of await repo.listHoldings()) {
    const i = await repo.getInstrumentByKey(h.key);
    if (i) priority.add(i.id);
  }
  return [...stocks].sort((a, b) => Number(priority.has(b.id)) - Number(priority.has(a.id)) || a.id - b.id);
}

export interface BatchResult {
  status: ScoreRun["status"] | "not_claimed";
  runDate: string;
  processed: number;
  total: number;
  nextOffset: number;
  failed: FailedSymbol[];
  /** True while another invocation should follow. */
  more: boolean;
  message: string;
}

export interface BatchDeps {
  repo: Repo;
  now: Date;
  batchSize?: number;
  maxMs?: number;
  leaseMs?: number;
  maxBatches?: number;
  maxSymbolAttempts?: number;
  /** Test hook: evaluate a stock (default: evaluateStock). */
  evaluate?: (ctx: SnapshotContext, inst: Instrument) => Promise<ScoreSnapshot | null>;
  /** Test hook: clock. */
  clock?: () => number;
}

/**
 * One resumable chunk of the snapshot run for the latest session. Idempotent end to end: the run row is created once,
 * a lease stops concurrent invocations, the cursor only advances after the batch's snapshots are written, and the writes
 * themselves are upserts on (instrument, date, version). A crash between the write and the cursor update simply redoes
 * that batch. Symbols that throw are recorded and retried once the cursor reaches the end, up to maxSymbolAttempts each.
 */
export async function runSnapshotBatch(deps: BatchDeps): Promise<BatchResult> {
  const { repo } = deps;
  const o = {
    batchSize: deps.batchSize ?? SNAPSHOT_DEFAULTS.batchSize, maxMs: deps.maxMs ?? SNAPSHOT_DEFAULTS.maxMs, leaseMs: deps.leaseMs ?? SNAPSHOT_DEFAULTS.leaseMs,
    maxBatches: deps.maxBatches ?? SNAPSHOT_DEFAULTS.maxBatches, maxSymbolAttempts: deps.maxSymbolAttempts ?? SNAPSHOT_DEFAULTS.maxSymbolAttempts,
  };
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const evaluate = deps.evaluate ?? evaluateStock;

  const universe = await orderedUniverse(repo);
  const probe = await buildContext(repo, universe);
  const date = probe.evaluationDate;
  await repo.ensureScoreRun(date, SCORING_VERSION, universe.length, o.maxBatches);
  const claim = await repo.claimScoreRun(date, SCORING_VERSION, deps.now, o.leaseMs);
  const base = (run: ScoreRun | null, message: string, status: BatchResult["status"]): BatchResult => ({
    status, runDate: date, processed: run?.processed ?? 0, total: run?.total ?? universe.length, nextOffset: run?.nextOffset ?? 0,
    failed: run?.failed ?? [], more: false, message,
  });
  if (!claim.claimed || !claim.run) {
    const r = claim.run;
    if (r?.status === "completed") return base(r, "Run already completed", "completed");
    if (r?.status === "failed") return base(r, r.error ?? "Run failed", "failed");
    return base(r, "Another invocation holds the run", "not_claimed");
  }
  const run = claim.run;
  const failed = new Map<string, FailedSymbol>(run.failed.map((f) => [f.key, { ...f }]));
  const byKey = new Map(universe.map((u) => [u.key, u]));
  const rows: ScoreSnapshot[] = [];
  const fail = (key: string, e: unknown) => {
    const prev = failed.get(key);
    failed.set(key, { key, attempts: (prev?.attempts ?? 0) + 1, error: e instanceof Error ? e.message : String(e) });
  };
  const timeLeft = () => clock() - started < o.maxMs;

  let next = run.nextOffset;
  let processed = run.processed;
  if (next < universe.length) {
    const slice = universe.slice(next, next + o.batchSize);
    let done = 0;
    await pool(slice, CONCURRENCY, async (inst) => {
      if (!timeLeft()) return; // not started: stays beyond the cursor and is picked up by the next invocation
      try {
        const snap = await evaluate(probe, inst);
        if (snap) rows.push(snap);
        failed.delete(inst.key);
      } catch (e) {
        fail(inst.key, e);
      }
      done++;
    });
    // The cursor can only advance over a contiguous prefix of finished symbols; with a time cut we conservatively
    // advance by the number actually attempted, and symbols skipped by the cut are re-visited because slice order is stable
    // and the unprocessed ones are exactly the tail. (pool starts items in order.)
    await repo.upsertSnapshots(rows);
    next += done;
    processed += rows.length;
  }

  // End of the universe: one retry pass over symbols that failed, bounded per symbol.
  if (next >= universe.length) {
    const retry = [...failed.values()].filter((f) => f.attempts < o.maxSymbolAttempts && byKey.has(f.key));
    const retried: ScoreSnapshot[] = [];
    await pool(retry, CONCURRENCY, async (f) => {
      if (!timeLeft()) return;
      try {
        const snap = await evaluate(probe, byKey.get(f.key)!);
        if (snap) retried.push(snap);
        failed.delete(f.key);
      } catch (e) {
        fail(f.key, e);
      }
    });
    await repo.upsertSnapshots(retried);
    processed += retried.length;
  }

  const open = [...failed.values()].filter((f) => f.attempts < o.maxSymbolAttempts);
  const finished = next >= universe.length && open.length === 0;
  const saved: ScoreRun = {
    ...run,
    nextOffset: Math.min(next, universe.length),
    processed,
    failed: [...failed.values()],
    total: universe.length,
    status: finished ? "completed" : "running",
    lastSuccessAt: rows.length > 0 || finished ? deps.now.toISOString() : run.lastSuccessAt,
    finishedAt: finished ? deps.now.toISOString() : null,
    error: null,
  };
  await repo.saveScoreRun(saved);
  return {
    status: saved.status, runDate: date, processed, total: universe.length, nextOffset: saved.nextOffset,
    failed: saved.failed, more: !finished,
    message: finished
      ? `Completed: ${processed} snapshots, ${saved.failed.length} symbol(s) failed after ${o.maxSymbolAttempts} attempts`
      : `Batch ${run.batches} done: cursor ${saved.nextOffset}/${universe.length}, ${open.length} symbol(s) awaiting retry`,
  };
}
