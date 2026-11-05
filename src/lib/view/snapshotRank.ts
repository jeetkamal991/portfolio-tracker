import type { ScoreSnapshot } from "@/lib/db/types";
import { MIN_COVERAGE_FOR_RANKING } from "@/lib/calc/scoreV2/config";
import { MIN_TRADE_COVERAGE_FOR_RANKING } from "@/lib/calc/scoreV2/tradeConfig";
import type { ScoreCategory } from "@/lib/calc/scoreV2/technical";

/**
 * technical / tradeQuality: the two scores, ranked independently.
 * combined: mean of the two, only for stocks eligible in BOTH rankings.
 * relativeStrength / volume: the share of that category's scorable points, for stocks eligible in the technical ranking.
 */
export type RankKind = "technical" | "tradeQuality" | "combined" | "relativeStrength" | "volume";
export interface Ranked { symbol: string; score: number; coverage: number; dataConfidence: number | null }
export interface Excluded { symbol: string; reason: string }
export interface Ranking { version: string; date: string; kind: RankKind; ranked: Ranked[]; excluded: Excluded[] }

export interface Metrics { close?: number | null; dayPct?: number | null; rsi?: number | null; rvol?: number | null; atrPct?: number | null; tradedValueCr?: number | null; trend?: string | null; sector?: string | null; rewardRisk?: number | null }
interface Cov { technical?: { coverage?: number }; tradeQuality?: { coverage?: number; rankable?: boolean; observation?: string }; confidence?: { status?: string }; metrics?: Metrics; categoryShares?: Record<string, number | null> }

export const metricsOf = (r: ScoreSnapshot): Metrics => ((r.dataCoverage ?? {}) as Cov).metrics ?? {};

function technicalReason(r: ScoreSnapshot, c: Cov): string | null {
  const cov = c.technical?.coverage ?? 0;
  if (r.technicalScore === null) return "Technical score not available";
  if (cov < MIN_COVERAGE_FOR_RANKING) return `Technical coverage ${(cov * 100).toFixed(0)}% is below ${MIN_COVERAGE_FOR_RANKING * 100}%`;
  if (c.confidence?.status === "LOW CONFIDENCE") return "Low data confidence";
  return null;
}
function tradeReason(r: ScoreSnapshot, c: Cov): string | null {
  const t = c.tradeQuality, cov = t?.coverage ?? 0;
  if (r.tradeQualityScore === null) return "Trade quality not available";
  if (!t?.rankable) return cov < MIN_TRADE_COVERAGE_FOR_RANKING ? `Trade quality coverage ${(cov * 100).toFixed(0)}% is below ${MIN_TRADE_COVERAGE_FOR_RANKING * 100}%` : "No valid reward-to-risk (no valid target or stop)";
  if (c.confidence?.status === "LOW CONFIDENCE") return "Low data confidence";
  return null;
}
function categoryShare(r: ScoreSnapshot, key: string): number | null {
  const stored = ((r.dataCoverage ?? {}) as Cov).categoryShares;
  if (stored && key in stored) return stored[key] ?? null;
  const cats = ((r.categoryBreakdown ?? {}) as { technical?: ScoreCategory[] }).technical ?? [];
  const c = cats.find((x) => x.key === key);
  return c && c.available > 0 ? (c.earned / c.available) * 100 : null;
}

/**
 * Ranks one thing for one scoring version on one date. The version is a required argument and rows of any other version
 * (or another date) are rejected, so versions can never be mixed. A stock that cannot be ranked is listed with its reason
 * instead of being silently dropped or ranked as if it were fully verified.
 */
export function rankSnapshots(rows: ScoreSnapshot[], opts: { version: string; kind: RankKind }): Ranking {
  const bad = rows.find((r) => r.scoringVersion !== opts.version);
  if (bad) throw new Error(`rankSnapshots: row ${bad.symbol} has version ${bad.scoringVersion}, expected ${opts.version}`);
  const dates = new Set(rows.map((r) => r.evaluationDate));
  if (dates.size > 1) throw new Error("rankSnapshots: rows span several evaluation dates");
  const ranked: Ranked[] = [];
  const excluded: Excluded[] = [];
  for (const r of rows) {
    const c = (r.dataCoverage ?? {}) as Cov;
    const tech = technicalReason(r, c), trade = tradeReason(r, c);
    const cov = opts.kind === "tradeQuality" ? (c.tradeQuality?.coverage ?? 0) : (c.technical?.coverage ?? 0);
    let reason: string | null = null;
    let score = 0;
    switch (opts.kind) {
      case "technical": reason = tech; score = r.technicalScore ?? 0; break;
      case "tradeQuality": reason = trade; score = r.tradeQualityScore ?? 0; break;
      case "combined": reason = tech ? `Technical: ${tech}` : trade ? `Trade quality: ${trade}` : null; score = ((r.technicalScore ?? 0) + (r.tradeQualityScore ?? 0)) / 2; break;
      default: {
        const share = categoryShare(r, opts.kind);
        reason = tech ?? (share === null ? "Category not scorable (inputs missing)" : null);
        score = share ?? 0;
      }
    }
    if (reason) excluded.push({ symbol: r.symbol, reason });
    else ranked.push({ symbol: r.symbol, score, coverage: cov, dataConfidence: r.dataConfidence });
  }
  ranked.sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.symbol.localeCompare(b.symbol));
  return { version: opts.version, date: [...dates][0] ?? "", kind: opts.kind, ranked, excluded };
}

export interface RankFilters {
  minTechnical?: number;
  minTrade?: number;
  minConfidence?: number;
  sector?: string;
  rsiMin?: number;
  rsiMax?: number;
  minRvol?: number;
  minTradedCr?: number;
  trend?: "above_all" | "mixed" | "below_all";
}

/** Keeps rows meeting every filter given. A row whose filtered value is unknown fails that filter (it is not guessed). */
export function filterSnapshots(rows: ScoreSnapshot[], f: RankFilters): ScoreSnapshot[] {
  const ge = (v: number | null | undefined, min: number | undefined) => min === undefined || (v !== null && v !== undefined && v >= min);
  return rows.filter((r) => {
    const m = metricsOf(r);
    return (
      ge(r.technicalScore, f.minTechnical) &&
      ge(r.tradeQualityScore, f.minTrade) &&
      ge(r.dataConfidence, f.minConfidence) &&
      (f.sector === undefined || m.sector === f.sector) &&
      ge(m.rsi, f.rsiMin) &&
      (f.rsiMax === undefined || (m.rsi !== null && m.rsi !== undefined && m.rsi <= f.rsiMax)) &&
      ge(m.rvol, f.minRvol) &&
      ge(m.tradedValueCr, f.minTradedCr) &&
      (f.trend === undefined || m.trend === f.trend)
    );
  });
}
