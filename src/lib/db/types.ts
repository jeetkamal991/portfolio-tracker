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

export type JobStatus = "ok" | "partial" | "no_session" | "failed";

export interface JobRun {
  job: string;
  startedAt: string;
  finishedAt: string;
  status: JobStatus;
  message: string;
}
