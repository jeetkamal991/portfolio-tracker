export type InstrumentType = "index" | "sector" | "stock";

export interface Instrument {
  id: number;
  key: string;
  name: string;
  type: InstrumentType;
  yahooTicker: string;
  active: boolean;
}

export interface StoredDay {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  pctChange: number | null;
  importedPct: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  rsVsNifty: number | null;
}

export interface IndicatorRow {
  date: string;
  pctChange: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  rsVsNifty: number | null;
}

export interface Levels {
  autoSupport: number | null;
  autoResistance: number | null;
  manualSupport: number | null;
  manualResistance: number | null;
}

export interface DailySummary {
  date: string;
  summary: string;
  marketEvents: unknown[];
  watchlistNews: unknown[];
}

/** `running`: started and not yet finished (or died before it could, e.g. a function timeout). */
export type JobStatus = "running" | "ok" | "partial" | "no_session" | "failed";

export interface JobRun {
  job: string;
  startedAt: string;
  /** Null while the run is still `running`. */
  finishedAt: string | null;
  status: JobStatus;
  message: string;
}

/** What a finished run writes onto its job_runs row. */
export type JobRunResult = { finishedAt: string; status: Exclude<JobStatus, "running">; message: string };

/** The only daily_prices columns the indicator/levels recompute needs. */
export interface PriceBar {
  date: string;
  close: number | null;
  high: number | null;
  low: number | null;
}
