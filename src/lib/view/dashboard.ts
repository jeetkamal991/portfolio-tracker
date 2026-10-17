import { calendarReturn, periodReturn, PERIODS, sessionCalendar } from "@/lib/calc/returns";
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
import { latestExpectedSession } from "@/lib/time/ist";

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

/**
 * `niftyDates` (NIFTY50's stored session dates; ~70 recent ones suffice) is the trading calendar:
 * w1/m1/m3 look 5/21/63 Nifty sessions back from the latest priced row and are null if the sector
 * has no close on that session. With no Nifty dates, they fall back to the sector's own bars.
 */
export function buildSectorRows(
  series: { key: string; name: string; days: StoredDay[] }[],
  niftyDates: string[],
): SectorRow[] {
  const cal = sessionCalendar(niftyDates);
  return SECTOR_KEYS.map((key) => {
    const s = series.find((x) => x.key === key);
    const empty: SectorRow = { key, name: s?.name ?? key, d1: null, w1: null, m1: null, m3: null, trend: null };
    if (!s) return empty;
    const priced = [...s.days].sort((a, b) => a.date.localeCompare(b.date)).filter((d) => d.close !== null);
    const last = priced[priced.length - 1];
    let ret: (bars: number) => number | null;
    if (cal.dates.length === 0) {
      const closes = priced.map((d) => d.close as number);
      ret = (bars) => periodReturn(closes, bars);
    } else {
      const closeOn = new Map(priced.map((d) => [d.date, d.close as number]));
      ret = (bars) => (last ? calendarReturn(closeOn, cal, last.date, bars) : null);
    }
    return {
      ...empty,
      d1: buildTodaySummary(s.days),
      w1: ret(PERIODS.w1),
      m1: ret(PERIODS.m1),
      m3: ret(PERIODS.m3),
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

const RUNNING_STALE_MS = 15 * 60_000;

/**
 * Stale (amber) when the last EOD run failed or was partial, when a run has been `running` for
 * over 15 minutes (it most likely timed out), or when the newest data is older than the latest
 * weekday whose 17:30 IST has passed (cron never fired, no job row, or a null close). NSE holidays
 * are not modelled, so the day after one can read amber. `no_session` alone is not stale.
 */
export function buildAsOf(
  latestNiftyDate: string | null,
  lastRun: JobRun | null,
  now: Date,
): { date: string | null; stale: boolean } {
  const runBad = lastRun?.status === "failed" || lastRun?.status === "partial";
  const runStuck =
    lastRun?.status === "running" && now.getTime() - Date.parse(lastRun.startedAt) > RUNNING_STALE_MS;
  const dataOld = latestNiftyDate !== null && latestNiftyDate < latestExpectedSession(now);
  return { date: latestNiftyDate, stale: runBad || runStuck || dataOld };
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
  v === null || v === 0 ? "text-[var(--muted)]" : v > 0 ? "text-[var(--up)]" : "text-[var(--down)]";

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
