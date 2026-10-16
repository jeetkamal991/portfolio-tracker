import type { Candle } from "@/lib/provider/types";
import type { Instrument, InstrumentType, IndicatorRow, JobRun, Levels, StoredDay } from "./types";

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
  lastJobRun(job: string): Promise<JobRun | null>;
}
