import {
  distanceToResistance,
  distanceToSupport,
  effectiveLevel,
  emaTrend,
  isNearLevel,
  type EmaTrend,
} from "@/lib/calc/levels";
import type { ScoreLabel } from "@/lib/calc/score";
import type { Levels, StoredDay } from "@/lib/db/types";

/** `days` ascending, up to ~25 recent rows. */
export interface WatchInput {
  key: string;
  name: string;
  ticker: string;
  days: StoredDay[];
  levels: Levels;
}

export interface WatchRow {
  key: string;
  name: string;
  cmp: number;
  dayPct: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  above20: boolean | null;
  above50: boolean | null;
  above200: boolean | null;
  trend: EmaTrend | null;
  rsi: number | null;
  support: number | null;
  resistance: number | null;
  supportIsManual: boolean;
  resistanceIsManual: boolean;
  toSupport: number | null;
  toResistance: number | null;
  nearLevel: boolean;
  score: number | null;
  scoreLabel: ScoreLabel | null;
  scorePartial: boolean;
  /** Last ≤ 21 priced closes, ascending; the live price replaces the last point when live. */
  spark: number[];
  /** EMA 200 not available yet. */
  notEnoughHistory: boolean;
}

const SPARK_POINTS = 21;

/**
 * Indicators, levels and score from the latest priced day. CMP and day % prefer the live quote,
 * then the stored provider %, then the owner-imported %. Null when the stock has no priced day.
 */
export function buildWatchRow(input: WatchInput, live?: { price: number; changePct: number } | null): WatchRow | null {
  const sorted = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const priced = sorted.filter((d) => d.close !== null);
  const last = priced[priced.length - 1];
  if (!last) return null;
  const lastRow = sorted[sorted.length - 1]!;

  const cmp = live ? live.price : (last.close as number);
  const dayPct = live ? live.changePct : (lastRow.pctChange ?? lastRow.importedPct);
  const spark = priced.slice(-SPARK_POINTS).map((d) => d.close as number);
  if (live) spark[spark.length - 1] = live.price;

  const above = (ema: number | null) => (ema === null ? null : cmp >= ema);
  const l = input.levels;
  const support = effectiveLevel(l.autoSupport, l.manualSupport);
  const resistance = effectiveLevel(l.autoResistance, l.manualResistance);

  return {
    key: input.key,
    name: input.name,
    cmp,
    dayPct,
    ema20: last.ema20,
    ema50: last.ema50,
    ema200: last.ema200,
    above20: above(last.ema20),
    above50: above(last.ema50),
    above200: above(last.ema200),
    trend: emaTrend(cmp, last.ema20, last.ema50, last.ema200),
    rsi: last.rsi14,
    support,
    resistance,
    supportIsManual: l.manualSupport !== null,
    resistanceIsManual: l.manualResistance !== null,
    toSupport: support === null ? null : distanceToSupport(cmp, support),
    toResistance: resistance === null ? null : distanceToResistance(cmp, resistance),
    nearLevel: isNearLevel(cmp, support) || isNearLevel(cmp, resistance),
    score: last.score,
    scoreLabel: last.scoreLabel,
    scorePartial: last.scoreComponents?.partial ?? false,
    spark,
    notEnoughHistory: last.ema200 === null,
  };
}

export type WatchSortKey = "name" | "cmp" | "dayPct" | "ema20" | "ema50" | "ema200" | "rsi" | "toSupport" | "toResistance" | "score";

const sortValue = (r: WatchRow, key: WatchSortKey): string | number | null => (key === "name" ? r.key : r[key]);

/** Nulls always last whatever the direction; ties by stock key ascending. Returns a new array. */
export function sortWatchRows(rows: WatchRow[], key: WatchSortKey, dir: "asc" | "desc"): WatchRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else if (va !== vb) {
      return (va < vb ? -1 : 1) * sign;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
