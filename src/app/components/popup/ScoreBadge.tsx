import type { ScoreLabel } from "@/lib/calc/score";
import { Label } from "../ui";

/** Spec §3 score colours: emerald / green / slate / orange / rose. */
export const SCORE_TONE: Record<ScoreLabel, string> = {
  "Strong Bullish": "text-emerald-400 border-emerald-400/40 bg-emerald-400/15",
  Bullish: "text-green-400 border-green-400/40 bg-green-400/15",
  Neutral: "text-slate-400 border-slate-400/40 bg-slate-400/15",
  Bearish: "text-orange-400 border-orange-400/40 bg-orange-400/15",
  "Strong Bearish": "text-rose-400 border-rose-400/40 bg-rose-400/15",
};
const SCORE_TEXT: Record<ScoreLabel, string> = {
  "Strong Bullish": "text-emerald-400",
  Bullish: "text-green-400",
  Neutral: "text-slate-400",
  Bearish: "text-orange-400",
  "Strong Bearish": "text-rose-400",
};

/** Label chip in the spec colours; with `score`, reads "72 · Bullish". */
export function ScoreLabelChip({ label, score, title }: { label: ScoreLabel; score?: number; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums ${SCORE_TONE[label]}`}
    >
      {score !== undefined && `${Math.round(score)} · `}
      {label}
    </span>
  );
}

export function ScoreBadge({
  score,
  label,
  partial,
  size = "md",
}: {
  score: number | null;
  label: ScoreLabel | null;
  partial: boolean;
  size?: "sm" | "md";
}) {
  const has = score !== null && label !== null;
  const big = size === "sm" ? "text-xl" : "text-3xl";
  return (
    <div
      className="inline-flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2"
      aria-label={has ? `Technical score ${Math.round(score)} of 100, ${label}` : "Technical score not available"}
    >
      <Label>AI TECHNICAL SCORE</Label>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`font-mono font-extrabold tabular-nums ${big} ${has ? SCORE_TEXT[label] : "text-[var(--muted)]"}`}>
          {has ? Math.round(score) : "—"}
          {has && <span className="text-sm font-semibold text-[var(--muted)]">/100</span>}
        </span>
        {has && <ScoreLabelChip label={label} />}
      </div>
      {has && partial && <span className="font-mono text-[10px] text-[var(--warn)]">partial data</span>}
    </div>
  );
}
