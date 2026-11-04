import type { DeliveryRow } from "@/lib/db/types";

/** Rows kept per day (top by traded value); everything else in NSE's file is dropped. */
export const STORE_TOP = 100;
/** "Most active": rank within the top N by traded value that day. */
export const ACTIVE_TOP = 30;
/** "High delivery": at least this percent of traded shares were delivered. */
export const MIN_PCT = 60;
/** Monitoring windows in sessions, and how many of those sessions a stock must qualify on. */
export const WINDOWS = [
  { days: 10, minDays: 5 },
  { days: 20, minDays: 8 },
] as const;
const TODAY_LIMIT = 25;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "03-Nov-2026" -> "2026-11-03"; null when it isn't that shape. */
function isoDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  const mo = m ? MONTHS.indexOf(m[2]!.toLowerCase()) : -1;
  return m && mo >= 0 ? `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
}

const num = (s: string | undefined) => {
  const n = s === undefined || s === "" || s === "-" ? NaN : Number(s);
  return Number.isFinite(n) ? n : null;
};

/** NSE's sec_bhavdata_full CSV -> the STORE_TOP most traded EQ-series rows, ranked. Throws if the header is unrecognised. */
export function parseBhavcopy(csv: string): DeliveryRow[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines[0] ?? "").split(",").map((h) => h.trim().toUpperCase());
  const col = (n: string) => header.indexOf(n);
  const [iSym, iSeries, iDate, iClose, iQty, iTurn, iDq, iDp] = ["SYMBOL", "SERIES", "DATE1", "CLOSE_PRICE", "TTL_TRD_QNTY", "TURNOVER_LACS", "DELIV_QTY", "DELIV_PER"].map(col) as number[];
  if ([iSym, iSeries, iDate, iClose, iQty, iTurn, iDq, iDp].some((i) => i === undefined || i < 0)) throw new Error("bhavcopy: unexpected columns");

  const rows: Omit<DeliveryRow, "turnoverRank">[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split(",").map((v) => v.trim());
    if (f[iSeries!] !== "EQ") continue;
    const date = isoDate(f[iDate!] ?? "");
    const turnover = num(f[iTurn!]);
    const per = num(f[iDp!]);
    if (!date || turnover === null || per === null) continue;
    rows.push({ symbol: f[iSym!]!, date, turnoverLacs: turnover, tradedQty: num(f[iQty!]), delivQty: num(f[iDq!]), delivPer: per, close: num(f[iClose!]) });
  }
  rows.sort((a, b) => b.turnoverLacs - a.turnoverLacs || a.symbol.localeCompare(b.symbol));
  return rows.slice(0, STORE_TOP).map((r, i) => ({ ...r, turnoverRank: i + 1 }));
}

export interface DeliveryHit { symbol: string; days: number; avgPer: number; latestPer: number | null }
export interface TodayHit { symbol: string; delivPer: number; rank: number; turnoverCr: number }
export interface DeliveryView {
  /** Newest session with data, or null before the first import. */
  session: string | null;
  sessions: number;
  today: TodayHit[];
  /** One entry per WINDOWS item, same order. */
  shortlists: { days: number; minDays: number; available: number; hits: DeliveryHit[] }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** `rows` may span any dates; the newest `window` distinct dates are used. */
export function buildDelivery(rows: DeliveryRow[]): DeliveryView {
  const dates = [...new Set(rows.map((r) => r.date))].sort().reverse();
  const session = dates[0] ?? null;
  const today = rows
    .filter((r) => r.date === session && r.delivPer >= MIN_PCT)
    .sort((a, b) => b.delivPer - a.delivPer || a.turnoverRank - b.turnoverRank)
    .slice(0, TODAY_LIMIT)
    .map((r) => ({ symbol: r.symbol, delivPer: round1(r.delivPer), rank: r.turnoverRank, turnoverCr: Math.round(r.turnoverLacs / 100) }));

  const shortlists = WINDOWS.map(({ days, minDays }) => {
    const inWindow = new Set(dates.slice(0, days));
    const by = new Map<string, DeliveryRow[]>();
    for (const r of rows) if (inWindow.has(r.date)) by.set(r.symbol, [...(by.get(r.symbol) ?? []), r]);
    const hits: DeliveryHit[] = [];
    for (const [symbol, rs] of by) {
      const q = rs.filter((r) => r.turnoverRank <= ACTIVE_TOP && r.delivPer >= MIN_PCT);
      if (q.length < minDays) continue;
      const latest = rs.find((r) => r.date === session);
      hits.push({ symbol, days: q.length, avgPer: round1(q.reduce((s, r) => s + r.delivPer, 0) / q.length), latestPer: latest ? round1(latest.delivPer) : null });
    }
    hits.sort((a, b) => b.days - a.days || b.avgPer - a.avgPer || a.symbol.localeCompare(b.symbol));
    return { days, minDays, available: inWindow.size, hits };
  });
  return { session, sessions: dates.length, today, shortlists };
}
