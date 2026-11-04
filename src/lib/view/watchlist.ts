import {
  distanceToResistance,
  distanceToSupport,
  effectiveLevel,
  emaTrend,
  isNearLevel,
  type EmaTrend,
} from "@/lib/calc/levels";
import { runScreeners } from "@/lib/calc/screeners";
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
  /** Latest volume over its 20-day average; null without both. */
  volRatio: number | null;
  /** Price against the 52-week high as a fraction (-0.12 = 12% below); null without a high. */
  fromHigh: number | null;
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
    volRatio: last.volume && last.volAvg20 ? last.volume / last.volAvg20 : null,
    fromHigh: last.high52w && last.high52w > 0 ? cmp / last.high52w - 1 : null,
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

export type WatchTab = "all" | "top" | "weak" | "golden" | "death" | "breakout" | "rsi" | "volume";

export const WATCH_TABS: { id: WatchTab; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every stock on your watchlist." },
  { id: "top", label: "Top scores", hint: "The 5 highest Technical Scores on your list." },
  { id: "weak", label: "Weakest", hint: "The 5 lowest Technical Scores on your list." },
  { id: "golden", label: "Golden cross", hint: "EMA 50 crossed above EMA 200 in the last 5 sessions." },
  { id: "death", label: "Death cross", hint: "EMA 50 crossed below EMA 200 in the last 5 sessions." },
  { id: "breakout", label: "Breakouts", hint: "At a new 52-week high or within 3% of it." },
  { id: "rsi", label: "RSI extremes", hint: "RSI above 70 (overbought) or below 30 (oversold)." },
  { id: "volume", label: "Volume shockers", hint: "Today's volume at least twice its 20-day average, up or down." },
];

/** Keys of the stocks that match each signal tab, from the same rules as the Market tab's screeners. */
export type WatchSignals = Record<"golden" | "death" | "breakout" | "rsi" | "volume", string[]>;

export function buildWatchSignals(stocks: { key: string; name: string; days: StoredDay[] }[]): WatchSignals {
  const session = stocks.map((s) => s.days[s.days.length - 1]?.date ?? "").sort().pop() ?? "";
  const results = runScreeners(stocks, session, stocks.length || 1);
  const keys = (id: string) => results.find((r) => r.id === id)?.hits.map((h) => h.key) ?? [];
  return {
    golden: keys("golden"),
    death: keys("death"),
    breakout: keys("breakout"),
    rsi: [...keys("rsi_high"), ...keys("rsi_low")],
    volume: [...keys("vol_up"), ...keys("vol_down")],
  };
}

const TOP_N = 5;

/** The rows a tab shows, keeping the order of `rows`. Top and weakest need a score and take 5. */
export function tabRows(rows: WatchRow[], tab: WatchTab, sig: WatchSignals): WatchRow[] {
  if (tab === "all") return rows;
  if (tab === "top" || tab === "weak") {
    const scored = rows.filter((r) => r.score !== null).sort((a, b) => (tab === "top" ? b.score! - a.score! : a.score! - b.score!) || a.key.localeCompare(b.key));
    const keep = new Set(scored.slice(0, TOP_N).map((r) => r.key));
    return rows.filter((r) => keep.has(r.key));
  }
  const keep = new Set(sig[tab]);
  return rows.filter((r) => keep.has(r.key));
}

/** The one chip a tile shows: the most important signal on the stock, or null. */
export function signalChip(key: string, sig: WatchSignals): { label: string; tone: "up" | "down" | "warn" } | null {
  if (sig.death.includes(key)) return { label: "death cross", tone: "down" };
  if (sig.golden.includes(key)) return { label: "golden cross", tone: "up" };
  if (sig.breakout.includes(key)) return { label: "breakout", tone: "up" };
  if (sig.rsi.includes(key)) return { label: "RSI extreme", tone: "warn" };
  if (sig.volume.includes(key)) return { label: "volume shock", tone: "warn" };
  return null;
}
