import type { ScoreSnapshot } from "@/lib/db/types";
import type { ScoreCategory } from "@/lib/calc/scoreV2/technical";
import type { TradeLevels } from "@/lib/calc/scoreV2/tradeQuality";

export type DataStatus = "AVAILABLE" | "ESTIMATED" | "PROVISIONAL" | "NOT AVAILABLE" | "STALE DATA";
export type Tone = "good" | "caution" | "bad" | "missing";

export interface ScoreBlock {
  /** Normalised 0-100 over the points that could be scored; null when nothing could be. */
  score: number | null;
  earned: number;
  availablePoints: number;
  coverage: number;
  status: DataStatus;
  categories: ScoreCategory[];
}

export interface EvaluationView {
  scoringVersion: string;
  symbol: string;
  evaluationDate: string;
  dataTimestamp: string;
  technical: ScoreBlock;
  tradeQuality: ScoreBlock & { rankable: boolean; observation: string; levels: TradeLevels; flags: string[] };
  fundamental: { status: "NOT AVAILABLE"; note: string };
  confidence: { score: number; status: "OK" | "LOW CONFIDENCE"; stale: boolean; freshness: number; requiredInputs: number; history: number } | null;
  dataQuality: { kind: string; date: string; note: string; sessionsUsed: number }[];
  atr: { value: number | null; pct: number | null; candles: number } | null;
  liquidity: { medianCr: number | null; avgCr: number | null; latestCr: number | null; estimated: true } | null;
  metrics: Record<string, number | string | null>;
  /** Items that could not be scored, with the reason: shown instead of a silent zero. */
  missing: string[];
  /** Per-input labels such as "ESTIMATED" so a reader never mistakes a derived figure for an exchange figure. */
  notes: string[];
}

interface Cov {
  technical?: { coverage: number; available: number; earned: number; status: string; missing: string[] };
  tradeQuality?: { coverage: number; available: number; earned: number; status: string; rankable: boolean; observation: string; flags: string[]; missing: string[] };
  confidence?: { score: number; status: "OK" | "LOW CONFIDENCE"; stale: boolean; freshness: number; requiredInputs: number; history: number };
  dataQuality?: EvaluationView["dataQuality"];
  atr?: { value: number | null; pct: number | null; candles: number };
  liquidity?: { median: number | null; avg: number | null; latest: number | null };
  metrics?: EvaluationView["metrics"];
}
interface Breakdown { technical?: ScoreCategory[]; tradeQuality?: ScoreCategory[]; levels?: TradeLevels }

const status = (s: string | undefined, stale: boolean): DataStatus => (stale ? "STALE DATA" : s === "COMPLETE" ? "AVAILABLE" : s === "PROVISIONAL" ? "PROVISIONAL" : "NOT AVAILABLE");
const cr = (x: number | null | undefined) => (x === null || x === undefined ? null : x / 1e7);

export function buildEvaluationView(s: ScoreSnapshot): EvaluationView {
  const cov = (s.dataCoverage ?? {}) as Cov;
  const br = (s.categoryBreakdown ?? {}) as Breakdown;
  const stale = cov.confidence?.stale ?? false;
  const t = cov.technical, q = cov.tradeQuality;
  const emptyLevels: TradeLevels = { entry: null, stop: null, stopSource: null, target: null, targetSource: null, rewardRisk: null };
  return {
    scoringVersion: s.scoringVersion,
    symbol: s.symbol,
    evaluationDate: s.evaluationDate,
    dataTimestamp: s.dataTimestamp,
    technical: { score: s.technicalScore, earned: t?.earned ?? 0, availablePoints: t?.available ?? 0, coverage: t?.coverage ?? 0, status: status(t?.status, stale), categories: br.technical ?? [] },
    tradeQuality: {
      score: s.tradeQualityScore, earned: q?.earned ?? 0, availablePoints: q?.available ?? 0, coverage: q?.coverage ?? 0, status: status(q?.status, stale),
      categories: br.tradeQuality ?? [], rankable: q?.rankable ?? false, observation: q?.observation ?? "Insufficient data", levels: br.levels ?? emptyLevels, flags: q?.flags ?? [],
    },
    fundamental: { status: "NOT AVAILABLE", note: "No fundamental data provider is approved yet. This is not a zero score." },
    confidence: cov.confidence ? { ...cov.confidence } : null,
    dataQuality: cov.dataQuality ?? [],
    atr: cov.atr ?? null,
    liquidity: cov.liquidity ? { medianCr: cr(cov.liquidity.median), avgCr: cr(cov.liquidity.avg), latestCr: cr(cov.liquidity.latest), estimated: true } : null,
    metrics: cov.metrics ?? {},
    missing: [...(t?.missing ?? []), ...(q?.missing ?? [])],
    notes: ["Traded value is estimated as close x volume, not exchange turnover.", "Suggested entry, stop and target are technical reference levels, not guaranteed prices or advice."],
  };
}

/** Colour of an item or category: grey when it was not scored, else by the share of its maximum earned. */
export function tone(points: number, max: number, scored: boolean): Tone {
  if (!scored || max <= 0) return "missing";
  const r = points / max;
  return r >= 0.6 ? "good" : r >= 0.4 ? "caution" : "bad";
}
