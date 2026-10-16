import { periodReturn, PERIODS } from "@/lib/calc/returns";
import {
  distanceToResistance,
  distanceToSupport,
  effectiveLevel,
  isNearLevel,
  pctFrom,
  trendTag,
  type Trend,
} from "@/lib/calc/levels";
import type { JobRun, Levels, StoredDay } from "@/lib/db/types";
import { SECTOR_KEYS } from "@/lib/instruments";

export type HeatPeriod = "d1" | "w1" | "m1" | "m3";

export interface SectorRow {
  key: string;
  name: string;
  d1: number | null;
  w1: number | null;
  m1: number | null;
  m3: number | null;
  trend: Trend | null;
}

/**
 * Day % of the LATEST row (by date), falling back to the owner-imported value when the
 * provider has no pct yet, so imported history and new data read as one record.
 */
export function buildTodaySummary(days: StoredDay[]): number | null {
  const last = latest(days);
  return last ? (last.pctChange ?? last.importedPct) : null;
}

function latest(days: StoredDay[]): StoredDay | undefined {
  return days.reduce<StoredDay | undefined>((a, d) => (!a || d.date > a.date ? d : a), undefined);
}

export function buildSectorRows(series: { key: string; name: string; days: StoredDay[] }[]): SectorRow[] {
  return SECTOR_KEYS.map((key) => {
    const s = series.find((x) => x.key === key);
    const empty: SectorRow = { key, name: s?.name ?? key, d1: null, w1: null, m1: null, m3: null, trend: null };
    if (!s) return empty;
    const priced = [...s.days].sort((a, b) => a.date.localeCompare(b.date)).filter((d) => d.close !== null);
    const closes = priced.map((d) => d.close as number);
    const last = priced[priced.length - 1];
    return {
      ...empty,
      d1: buildTodaySummary(s.days),
      w1: periodReturn(closes, PERIODS.w1),
      m1: periodReturn(closes, PERIODS.m1),
      m3: periodReturn(closes, PERIODS.m3),
      trend: last ? trendTag(last.close as number, last.ema50, last.ema200) : null,
    };
  });
}

const SATURATION: Record<HeatPeriod, number> = { d1: 0.02, w1: 0.05, m1: 0.1, m3: 0.15 };

/** Diverging green/red background; null or exactly zero is neutral grey. */
export function heatColor(value: number | null, period: HeatPeriod): string {
  const grey = "rgba(128, 128, 128, 0.15)";
  if (value === null || !Number.isFinite(value) || value === 0) return grey;
  const t = Math.min(Math.abs(value) / SATURATION[period], 1);
  const alpha = (0.18 + 0.62 * t).toFixed(3);
  return value > 0 ? `rgba(22, 163, 74, ${alpha})` : `rgba(220, 38, 38, ${alpha})`;
}

export function buildAsOf(
  latestNiftyDate: string | null,
  lastRun: JobRun | null,
): { date: string | null; stale: boolean } {
  return { date: latestNiftyDate, stale: lastRun?.status === "failed" || lastRun?.status === "partial" };
}

export function latestPctDate(days: StoredDay[]): string | null {
  return days.reduce<string | null>(
    (a, d) => ((d.pctChange ?? d.importedPct) !== null && (!a || d.date > a) ? d.date : a),
    null,
  );
}

export const fmtPct = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "-" : ""}${(Math.abs(v) * 100).toFixed(2)}%`;

export const fmtPrice = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${String(d).padStart(2, "0")} ${mon} ${y}`;
}

export const pctTone = (v: number | null): string =>
  v === null || v === 0 ? "text-neutral-500" : v > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";

export interface WatchlistRow {
  key: string;
  name: string;
  cmp: number;
  dayPct: number | null;
  ema50: number | null;
  ema200: number | null;
  fromEma50: number | null;
  fromEma200: number | null;
  trend: Trend | null;
  support: number | null;
  resistance: number | null;
  supportIsManual: boolean;
  resistanceIsManual: boolean;
  toSupport: number | null;
  toResistance: number | null;
  nearLevel: boolean;
  notEnoughHistory: boolean;
}

/** `cmp` is the live price when available, else the last close; `liveChangePct` is the live day change (fraction). */
export function buildWatchlistRow(
  input: { key: string; name: string; lastDay: StoredDay; levels: Levels },
  cmp: number,
  liveChangePct?: number | null,
): WatchlistRow {
  const { lastDay: d, levels: l } = input;
  const support = effectiveLevel(l.autoSupport, l.manualSupport);
  const resistance = effectiveLevel(l.autoResistance, l.manualResistance);
  return {
    key: input.key,
    name: input.name,
    cmp,
    dayPct: liveChangePct ?? d.pctChange ?? d.importedPct,
    ema50: d.ema50,
    ema200: d.ema200,
    fromEma50: d.ema50 === null ? null : pctFrom(cmp, d.ema50),
    fromEma200: d.ema200 === null ? null : pctFrom(cmp, d.ema200),
    trend: trendTag(cmp, d.ema50, d.ema200),
    support,
    resistance,
    supportIsManual: l.manualSupport !== null,
    resistanceIsManual: l.manualResistance !== null,
    toSupport: support === null ? null : distanceToSupport(cmp, support),
    toResistance: resistance === null ? null : distanceToResistance(cmp, resistance),
    nearLevel: isNearLevel(cmp, support) || isNearLevel(cmp, resistance),
    notEnoughHistory: d.ema200 === null,
  };
}

/** Inline level input: empty clears the override (null); otherwise a positive finite number. */
export function parseLevelInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const t = raw.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false };
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? { ok: true, value: n } : { ok: false };
}
