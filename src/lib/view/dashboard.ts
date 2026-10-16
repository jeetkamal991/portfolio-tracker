import { periodReturn, PERIODS } from "@/lib/calc/returns";
import { trendTag, type Trend } from "@/lib/calc/levels";
import type { JobRun, StoredDay } from "@/lib/db/types";
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
