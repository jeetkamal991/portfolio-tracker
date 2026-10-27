import type { AlphaResult } from "@/lib/calc/alpha/run";
import type { ScreenerHit, ScreenerId } from "@/lib/calc/screeners";

const MINUS = "−";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-14" → "14 Oct"; anything else is returned unchanged. */
export function fmtShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${Number(m[3])} ${mon}` : iso;
}

/** Signed one-decimal percent from a fraction: −0.018 → "−1.8%", 0.02 → "+2.0%". */
function signedPct1(v: number): string {
  const s = (Math.abs(v) * 100).toFixed(1);
  if (Number(s) === 0) return "0.0%";
  return `${v < 0 ? MINUS : "+"}${s}%`;
}

const has = (v: number | null): v is number => v !== null && Number.isFinite(v);

/** The per-screener metric text; null when the hit carries nothing to show (score ids render a chip instead). */
export function metricText(id: ScreenerId, hit: Pick<ScreenerHit, "metric" | "date">): string | null {
  const { metric, date } = hit;
  switch (id) {
    case "vol_up":
    case "vol_down":
      return has(metric) ? `${metric.toFixed(1)}×` : null;
    case "breakout":
      return has(metric) ? `${signedPct1(metric)} from high` : null;
    case "breakdown":
      return has(metric) ? `${signedPct1(metric)} from low` : null;
    case "golden":
    case "death":
      return date ? `Crossed ${fmtShortDate(date)}` : null;
    case "rsi_high":
    case "rsi_low":
      return has(metric) ? `RSI ${metric.toFixed(1)}` : null;
    default:
      return null;
  }
}

/** Rows visible before "Show all". */
export const COLLAPSED_ROWS = 5;

/** Combined card: the mean rank as 0-100. An alpha card: the raw value to 3 significant digits. */
export function fmtAlphaScore(id: AlphaResult["id"], score: number): string {
  if (id === "combined") return String(Math.round(score * 100));
  const abs = Math.abs(score);
  // 3 significant digits, but whole numbers from 1000 up so toPrecision never switches to exponent form
  const text = Number(abs.toPrecision(3)) >= 1000 ? String(Math.round(abs)) : abs.toPrecision(3);
  return score < 0 ? `${MINUS}${text}` : text;
}
