import type { Candle } from "@/lib/provider/types";
import type { HoldingInput } from "@/lib/calc/portfolio";
import type { DailySummary, Holding, Instrument, InstrumentType, IndicatorRow, JobRun, JobRunResult, Levels, PriceBar, ReportRow, ScoreRow, StoredDay } from "./types";

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
  getDailySummary(date: string): Promise<DailySummary | null>;
}
