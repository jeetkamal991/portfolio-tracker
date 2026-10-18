import { holdingMetrics, portfolioTotals, type HoldingMetrics, type HoldingStatus } from "@/lib/calc/portfolio";
import type { ScoreLabel } from "@/lib/calc/score";
import type { Holding, StoredDay } from "@/lib/db/types";

export interface PortfolioRow extends Holding, HoldingMetrics {
  cmp: number | null;
  dayPct: number | null;
  score: number | null;
  scoreLabel: ScoreLabel | null;
}

export interface PortfolioWarning {
  key: string;
  name: string;
  status: HoldingStatus;
  cmp: number;
  level: number;
}

const WARNING_ORDER: HoldingStatus[] = ["SL_HIT", "TARGET_HIT", "NEAR_SL", "NEAR_TARGET"];

/** Joins holdings with prices. CMP and day % prefer the live quote (keyed by Yahoo ticker), then the latest stored day. */
export function buildPortfolioView(
  holdings: Holding[],
  latest: Map<number, StoredDay | null>,
  quotes: Record<string, { price: number; changePct: number }>,
  today: string,
) {
  const rows: PortfolioRow[] = holdings.map((h) => {
    const day = latest.get(h.instrumentId) ?? null;
    const q = quotes[h.yahooTicker];
    const cmp = q ? q.price : (day?.close ?? null);
    const dayPct = q ? q.changePct : day ? (day.pctChange ?? day.importedPct) : null;
    return { ...h, ...holdingMetrics(h, cmp, dayPct, today), cmp, dayPct, score: day?.score ?? null, scoreLabel: day?.scoreLabel ?? null };
  });
  const totals = portfolioTotals(rows.map((r) => ({ ...r, hasPrice: r.cmp !== null })));

  const warnings: PortfolioWarning[] = [];
  for (const r of rows) {
    if (r.status === null || r.status === "OK" || r.cmp === null) continue;
    const level = r.status === "SL_HIT" || r.status === "NEAR_SL" ? r.stopLoss : r.target1;
    if (level === null) continue;
    warnings.push({ key: r.key, name: r.name, status: r.status, cmp: r.cmp, level });
  }
  warnings.sort((a, b) => WARNING_ORDER.indexOf(a.status) - WARNING_ORDER.indexOf(b.status) || a.key.localeCompare(b.key));
  return { rows, totals, warnings };
}

export type PortfolioSortKey = "name" | "qty" | "avgPrice" | "cmp" | "invested" | "value" | "pnl" | "pnlPct" | "dayPnl" | "score";

/** Nulls always last; ties by key. */
export function sortPortfolioRows(rows: PortfolioRow[], key: PortfolioSortKey = "value", dir: "asc" | "desc" = "desc"): PortfolioRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null && y === null) return a.key.localeCompare(b.key);
    if (x === null) return 1;
    if (y === null) return -1;
    const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
    return c !== 0 ? sign * c : a.key.localeCompare(b.key);
  });
}

const MINUS = "−";
const rounds0 = (v: number, dp: number) => Number(Math.abs(v).toFixed(dp)) === 0;

/** ₹ with Indian digit grouping; negatives get a U+2212 minus before the ₹. */
export function fmtInr(v: number | null, dp = 2): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(Math.abs(v));
  return `${v < 0 && !rounds0(v, dp) ? MINUS : ""}₹${s}`;
}

/** Always signed: +₹2,340, −₹1,120, ₹0 for zero. */
export function fmtSignedInr(v: number | null, dp = 0): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const body = fmtInr(Math.abs(v), dp);
  if (rounds0(v, dp)) return body;
  return `${v < 0 ? MINUS : "+"}${body}`;
}
