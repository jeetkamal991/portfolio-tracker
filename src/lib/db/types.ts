import type { AlertCondition, HoldingLevel } from "@/lib/calc/alerts";
import type { Trade } from "@/lib/calc/backtest/engine";
import type { Metrics } from "@/lib/calc/backtest/metrics";
import type { PatternHit } from "@/lib/calc/patterns";
import type { HoldingInput } from "@/lib/calc/portfolio";
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

/** What the alphas read: the date, OHLCV and the day's % change. */
export type OhlcvDay = Pick<StoredDay, "date" | "open" | "high" | "low" | "close" | "volume" | "pctChange" | "importedPct">;

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

export interface ReportRow {
  id: number;
  instrumentId: number;
  status: "pending" | "done" | "failed";
  requestedAt: string;
  completedAt: string | null;
  requestedVia: "site" | "chat";
  content: unknown;
  error: string | null;
}

export interface Levels {
  autoSupport: number | null;
  autoResistance: number | null;
  manualSupport: number | null;
  manualResistance: number | null;
}

/** A stored position joined with its instrument. */
export interface Holding extends HoldingInput {
  instrumentId: number;
  key: string;
  name: string;
  yahooTicker: string;
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

export interface AlertRule {
  id: number;
  instrumentId: number;
  key: string;
  name: string;
  yahooTicker: string;
  condition: AlertCondition;
  value: number | null;
  mode: "once" | "repeat";
  active: boolean;
  /** `holding` rules are derived from holdings by syncHoldingAlerts, never edited by hand. */
  source: "user" | "holding";
  lastState: boolean | null;
  lastLevel: HoldingLevel | null;
  lastFiredAt: string | null;
  createdAt: string;
}

export interface AlertEvent {
  id: number;
  alertId: number | null;
  instrumentId: number;
  key: string;
  name: string;
  firedAt: string;
  price: number | null;
  message: string;
  read: boolean;
  telegramStatus: string | null;
}

export type NewAlertRule = Pick<AlertRule, "instrumentId" | "condition" | "value" | "mode" | "source" | "lastState" | "lastLevel">;
export interface AlertStateUpdate {
  id: number;
  lastState: boolean | null;
  lastLevel: HoldingLevel | null;
  lastFiredAt?: string;
  active?: boolean;
  /** Holding rules only: the SL / target moved. */
  value?: number | null;
}
export type NewAlertEvent = Omit<AlertEvent, "id" | "key" | "name" | "read">;

/** Quarterly holding pattern. Percent numbers (48.1 = 48.1%), unlike the fractions used elsewhere. */
export interface ShareholdingRow {
  instrumentId: number;
  /** Quarter end date, e.g. "2026-09-30". */
  quarterEnd: string;
  fiiPct: number | null;
  diiPct: number | null;
  promoterPct: number | null;
  sourceUrl: string | null;
}

/** One backtest run as the command builds it. `equity` rows are [date, strategy, benchmark], both starting at the capital. */
export interface BacktestRunInput {
  name: string;
  strategy: { id: string; label: string; params: Record<string, string | number> };
  settings: { capital: number; maxPositions: number; holdSessions: number; stopPct: number | null; from: string; to: string };
  metrics: { strategy: Metrics; benchmark: Metrics };
  equity: [string, number, number][];
  trades: Trade[];
  dataThrough: string;
  universeNote: string;
}

/** The light columns, for the list. */
export interface BacktestRunSummary {
  id: number;
  createdAt: string;
  name: string;
  strategy: BacktestRunInput["strategy"];
  settings: BacktestRunInput["settings"];
  metrics: BacktestRunInput["metrics"];
  dataThrough: string;
}

export interface BacktestRun extends BacktestRunSummary {
  equity: BacktestRunInput["equity"];
  trades: Trade[];
  universeNote: string;
}

export type AssistantMessage =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      steps: { id: string; name: string; summary: string; ok: boolean; output: string }[];
      text: string;
      usage: { inputTokens: number; outputTokens: number; costUsd: number } | null;
      reports: number[];
      error?: string;
    };

export interface AssistantSessionSummary {
  id: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  cliSessionId: string | null;
}

export interface AssistantSession extends AssistantSessionSummary {
  messages: AssistantMessage[];
}
