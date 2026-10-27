import type { BacktestRun } from "@/lib/db/types";

const MINUS = "−";

/** A fraction as a signed one-decimal percent: 0.123 → "+12.3%", −0.05 → "−5.0%". */
export function fmtFrac(v: number | null): string {
  if (v === null) return "—";
  const s = (Math.abs(v) * 100).toFixed(1);
  return Number(s) === 0 ? "0.0%" : `${v < 0 ? MINUS : "+"}${s}%`;
}

export const fmtRatio = (v: number | null): string => (v === null ? "—" : `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(2)}`);

/** Both lines scaled so the first point is 100. */
export function rebase100(equity: [string, number, number][]): { time: string; strategy: number; benchmark: number }[] {
  if (equity.length === 0) return [];
  const [, s0, b0] = equity[0];
  return equity.map(([time, s, b]) => ({ time, strategy: (s * 100) / s0, benchmark: (b * 100) / b0 }));
}

/** False when the saved JSON lacks what the page reads, so one bad row shows a message instead of crashing. */
export function isDisplayable(run: BacktestRun): boolean {
  return !!run && !!run.strategy && !!run.settings && !!run.metrics?.strategy && !!run.metrics?.benchmark
    && Array.isArray(run.equity) && run.equity.length > 0 && Array.isArray(run.trades);
}
