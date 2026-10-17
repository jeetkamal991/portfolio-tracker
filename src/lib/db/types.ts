import type { PatternHit } from "@/lib/calc/patterns";
import type { ScoreComponents, ScoreLabel } from "@/lib/calc/score";

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
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  rsVsNifty: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  volAvg20: number | null;
  high52w: number | null;
  low52w: number | null;
  patterns: PatternHit[] | null;
  rsVsSector: number | null;
  score: number | null;
  scoreComponents: (ScoreComponents & { partial: boolean }) | null;
  scoreLabel: ScoreLabel | null;
  scoreConfidence: "High" | "Medium" | "Low" | null;
  scoreSignal: string | null;
}

export interface IndicatorRow {
  date: string;
  pctChange: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  rsVsNifty: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  volAvg20: number | null;
  high52w: number | null;
  low52w: number | null;
  patterns: PatternHit[] | null;
}

export interface ScoreRow {
  date: string;
  rsVsSector: number | null;
  score: number;
  scoreComponents: ScoreComponents & { partial: boolean };
  scoreLabel: ScoreLabel;
  scoreConfidence: "High" | "Medium" | "Low";
  scoreSignal: string;
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
  open: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}
