import type { Candle } from "@/lib/provider/types";
import type { DailySummary, Instrument, InstrumentType, IndicatorRow, JobRun, JobRunResult, Levels, PriceBar, StoredDay } from "./types";

export interface Repo {
  listInstruments(f?: { types?: InstrumentType[]; activeOnly?: boolean }): Promise<Instrument[]>;
  getInstrumentByKey(key: string): Promise<Instrument | null>;
  /** Stocks only; key or name ILIKE. */
  searchInstruments(q: string, limit: number): Promise<Instrument[]>;
  /** Conflict on key. */
  upsertInstruments(rows: Omit<Instrument, "id">[]): Promise<void>;
  /** Writes date + OHLCV only. */
  upsertCandles(instrumentId: number, candles: Candle[]): Promise<void>;
  /** Newest `limit` days, returned ascending. Limits above 1000 return everything up to `limit`. */
  getDays(instrumentId: number, limit: number): Promise<StoredDay[]>;
  /** Same rows and ordering as getDays, but reads only date, close, high, low. */
  getPriceBars(instrumentId: number, limit: number): Promise<PriceBar[]>;
  /** Writes indicator columns + pctChange only. */
  upsertIndicators(instrumentId: number, rows: IndicatorRow[]): Promise<void>;
  /** Writes importedPct only (creates the row if absent). */
  upsertImportedPct(rows: { instrumentId: number; date: string; importedPct: number }[]): Promise<void>;
  listWatchlist(): Promise<Instrument[]>;
  addToWatchlist(instrumentId: number): Promise<void>;
  removeFromWatchlist(instrumentId: number): Promise<void>;
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
  getDailySummary(date: string): Promise<DailySummary | null>;
}
