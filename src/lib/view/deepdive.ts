import type { ScoreLabel } from "@/lib/calc/score";
import type { ReportWithStock } from "@/lib/db/types";

/** A report tile: the report plus its stock's Technical Score today (null until the stock has one). */
export interface ReportTile extends ReportWithStock {
  score: number | null;
  scoreLabel: ScoreLabel | null;
}

export interface DeepDiveStats {
  total: number;
  done: number;
  pending: number;
  failed: number;
  /** Mean of each researched stock's score, counted once per stock; null when none has a score. */
  avgScore: number | null;
}

export function deepDiveStats(tiles: ReportTile[]): DeepDiveStats {
  const byStock = new Map<string, number>();
  for (const t of tiles) if (t.score !== null && !byStock.has(t.key)) byStock.set(t.key, t.score);
  const scores = [...byStock.values()];
  return {
    total: tiles.length,
    done: tiles.filter((t) => t.status === "done").length,
    pending: tiles.filter((t) => t.status === "pending").length,
    failed: tiles.filter((t) => t.status === "failed").length,
    avgScore: scores.length === 0 ? null : Math.round(scores.reduce((a, s) => a + s, 0) / scores.length),
  };
}

/** Green from 60, amber from 45, red below, grey without a score. */
export function scoreTone(score: number | null): "up" | "warn" | "down" | "muted" {
  if (score === null) return "muted";
  return score >= 60 ? "up" : score >= 45 ? "warn" : "down";
}
