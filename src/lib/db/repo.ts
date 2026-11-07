import type { Candle } from "@/lib/provider/types";
import type { HoldingInput } from "@/lib/calc/portfolio";
import type { AlertCondition } from "@/lib/calc/alerts";
import type { AlertEvent, AlertRule, AlertStateUpdate, DailySummary, DeliveryRow, Holding, NewAlertEvent, NewAlertRule, Instrument, InstrumentType, IndicatorRow, JobRun, JobRunResult, Levels, PriceBar, ReportRow, ReportWithStock, ScoreRow, ScoreRun, ScoreSnapshot, ShareholdingRow, StoredDay } from "./types";

export interface Repo {
  listInstruments(f?: { types?: InstrumentType[]; activeOnly?: boolean }): Promise<Instrument[]>;
  getInstrumentByKey(key: string): Promise<Instrument | null>;
  /** Stocks only; key or name ILIKE. */
  /** Stocks matching key or name; `includeIndices` also matches indices and sectors. */
  searchInstruments(q: string, limit: number, opts?: { includeIndices?: boolean }): Promise<Instrument[]>;
  /** Conflict on key. */
  upsertInstruments(rows: Omit<Instrument, "id">[]): Promise<void>;
  /** Writes date + OHLCV only. */
  upsertCandles(instrumentId: number, candles: Candle[]): Promise<void>;
  /** Newest `limit` days, returned ascending. Limits above 1000 return everything up to `limit`. */
  getDays(instrumentId: number, limit: number): Promise<StoredDay[]>;
  /** Same rows and ordering as getDays, but reads only date, open, high, low, close, volume. */
  getPriceBars(instrumentId: number, limit: number): Promise<PriceBar[]>;
  /** Writes indicator columns + pctChange only. */
  upsertIndicators(instrumentId: number, rows: IndicatorRow[]): Promise<void>;
  /** Writes only the score columns + rsVsSector on (instrument, date). */
  upsertScore(instrumentId: number, row: ScoreRow): Promise<void>;
  /** Deletes then inserts the membership of one index. */
  replaceConstituents(indexKey: string, instrumentIds: number[]): Promise<void>;
  listConstituents(indexKey: string): Promise<Instrument[]>;
  listMemberships(): Promise<{ indexKey: string; instrumentId: number }[]>;
  /** Rows on exactly `date` for the given ids, keyed by instrument id; ids with no row are absent. */
  getDaysOn(instrumentIds: number[], date: string): Promise<Map<number, StoredDay>>;
  /** Rows with fromDate <= date <= toDate for the given ids, ascending per instrument; ids with no rows are absent. */
  getDaysRange(instrumentIds: number[], fromDate: string, toDate: string): Promise<Map<number, StoredDay[]>>;
  /** Newest row with a non-null close. */
  getLatestDay(instrumentId: number): Promise<StoredDay | null>;
  /** Writes importedPct only (creates the row if absent). */
  upsertImportedPct(rows: { instrumentId: number; date: string; importedPct: number }[]): Promise<void>;
  listWatchlist(): Promise<Instrument[]>;
  addToWatchlist(instrumentId: number): Promise<void>;
  removeFromWatchlist(instrumentId: number): Promise<void>;
  listHoldings(): Promise<Holding[]>;
  getHolding(instrumentId: number): Promise<Holding | null>;
  /** Insert or replace the position for one instrument; sets updated_at. */
  upsertHolding(instrumentId: number, h: HoldingInput): Promise<void>;
  deleteHolding(instrumentId: number): Promise<void>;
  /** Manually entered next results dates (YYYY-MM-DD) by instrument id; ids with no date are absent. */
  getResultsDates(instrumentIds: number[]): Promise<Map<number, string>>;
  /** Sets or (with null) clears the results date; never touches the levels. */
  setResultsDate(instrumentId: number, date: string | null): Promise<void>;
  /** All-null if no row. */
  getLevels(instrumentId: number): Promise<Levels>;
  /** Never touches manual_*. */
  setAutoLevels(instrumentId: number, support: number | null, resistance: number | null): Promise<void>;
  /** Never touches auto_*. */
  setManualLevels(instrumentId: number, support: number | null, resistance: number | null): Promise<void>;
  logJobRun(run: JobRun): Promise<void>;
  /** Inserts a `running` row (finished_at null) and returns its id. */
  startJobRun(job: string, startedAt: string): Promise<number>;
  /** Sets finished_at, status and message on the row created by startJobRun. */
  finishJobRun(id: number, result: JobRunResult): Promise<void>;
  /** Latest row by started_at, including a `running` one. */
  lastJobRun(job: string): Promise<JobRun | null>;
  /** Inserts a `pending` report with requested_via 'site'. */
  requestReport(instrumentId: number): Promise<ReportRow>;
  /** Newest first. */
  listReports(instrumentId: number): Promise<ReportRow[]>;
  /** Every report of every stock, newest first. */
  listAllReports(): Promise<ReportWithStock[]>;
  deleteReport(id: number): Promise<void>;
  upsertDelivery(rows: DeliveryRow[]): Promise<void>;
  /** All stored delivery rows dated on or after `sinceDate`. */
  listDelivery(sinceDate: string): Promise<DeliveryRow[]>;
  getDailySummary(date: string): Promise<DailySummary | null>;
  /** Ordered by id. */
  listAlertRules(f?: { activeOnly?: boolean; conditions?: AlertCondition[] }): Promise<AlertRule[]>;
  /** Throws on a second `holding` rule for the same instrument and condition. */
  createAlertRule(r: NewAlertRule): Promise<AlertRule>;
  setAlertActive(id: number, active: boolean): Promise<void>;
  deleteAlertRule(id: number): Promise<void>;
  /** One batched write; fields left out of an update are unchanged. */
  saveAlertStates(updates: AlertStateUpdate[]): Promise<void>;
  insertAlertEvents(events: NewAlertEvent[]): Promise<void>;
  /** Unread first, then newest. */
  listAlertEvents(limit: number): Promise<AlertEvent[]>;
  unreadAlertCount(): Promise<number>;
  markAlertsRead(ids: number[] | "all"): Promise<void>;
  /** Rows for the given quarter ends (any order). */
  listShareholding(quarterEnds: string[], instrumentIds?: number[]): Promise<ShareholdingRow[]>;
  /** Newest quarter end with at least one row, or null. */
  latestShareholdingQuarter(): Promise<string | null>;
  /** Insert or replace on (instrument, quarter). The app only reads; Claude writes in SQL — this serves tests and sample data. */
  upsertShareholding(rows: ShareholdingRow[]): Promise<void>;
  /** Idempotent on (instrument, evaluation date, scoring version): re-running a batch rewrites the same rows. */
  upsertSnapshots(rows: ScoreSnapshot[]): Promise<void>;
  /** The version is required on purpose: rankings must never mix scoring versions. */
  listSnapshots(f: { version: string; date: string }): Promise<ScoreSnapshot[]>;
  getScoreRun(runDate: string, version: string): Promise<ScoreRun | null>;
  /** Creates the run if absent (never resets an existing one) and returns it. */
  ensureScoreRun(runDate: string, version: string, total: number, maxBatches: number): Promise<ScoreRun>;
  /**
   * Takes the lease on a pending/running run: claimed is false when another invocation holds it, the run is finished,
   * or it has used its batch allowance. On success the run is running, batches is incremented and lockedUntil is now + leaseMs.
   */
  claimScoreRun(runDate: string, version: string, now: Date, leaseMs: number): Promise<{ claimed: boolean; run: ScoreRun | null }>;
  /** Writes progress and releases the lease (lockedUntil null). */
  saveScoreRun(run: ScoreRun): Promise<void>;
  /** Newest evaluation date stored for a scoring version, or null. */
  latestSnapshotDate(version: string): Promise<string | null>;
  /** A stock's newest snapshot of one scoring version (or the one on `date`). */
  getSnapshot(instrumentId: number, version: string, date?: string): Promise<ScoreSnapshot | null>;
  /** Snapshots of one version with fromDate <= evaluation date <= toDate, ascending by date: the input of forward-return studies. */
  listSnapshotsRange(version: string, fromDate: string, toDate: string): Promise<ScoreSnapshot[]>;
  /**
   * The newest `perInstrument` priced rows of many instruments in ONE read (instead of one query each). Supabase bounds the
   * scan to a calendar window (default 1.5 x perInstrument + 10 days, or `windowDays`), so an instrument idle for longer returns fewer rows.
   */
  getRecentDays(instrumentIds: number[], perInstrument: number, windowDays?: number): Promise<Map<number, StoredDay[]>>;
  /** Newest `limit` rows with only the columns the price chart draws (date, OHLCV, EMAs, Bollinger, RSI, MACD), ascending. */
  getChartDays(instrumentId: number, limit: number): Promise<StoredDay[]>;
  /** Levels of many instruments in one read; ids with no row get the empty levels. */
  getLevelsMany(instrumentIds: number[]): Promise<Map<number, Levels>>;
  /** Members of several indices in one read, keyed by index key (every key present, possibly empty). */
  listConstituentsMany(indexKeys: string[]): Promise<Map<string, Instrument[]>>;
  /**
   * Snapshots of one version and date WITHOUT the large per-item breakdown: scores, confidence and a compact
   * dataCoverage (coverage, status, rankability, observation, metrics, category shares). For rankings.
   */
  listSnapshotSummaries(f: { version: string; date: string }): Promise<ScoreSnapshot[]>;
}
