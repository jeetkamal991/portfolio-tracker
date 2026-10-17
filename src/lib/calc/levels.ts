export type Trend = "above_both" | "between" | "below_both";

export function trendTag(cmp: number, ema50: number | null, ema200: number | null): Trend | null {
  if (ema50 === null || ema200 === null) return null;
  if (cmp > ema50 && cmp > ema200) return "above_both";
  if (cmp < ema50 && cmp < ema200) return "below_both";
  return "between";
}

export type EmaTrend = "above_all" | "mixed" | "below_all";

/** Price vs EMA 20/50/200: above (>=) all three, below all three, mixed otherwise; null when any EMA is missing. */
export function emaTrend(cmp: number, ema20: number | null, ema50: number | null, ema200: number | null): EmaTrend | null {
  if (ema20 === null || ema50 === null || ema200 === null) return null;
  const above = [ema20, ema50, ema200].map((e) => cmp >= e);
  return above.every(Boolean) ? "above_all" : above.some(Boolean) ? "mixed" : "below_all";
}

/** Manual level overrides the auto-detected one. */
export function effectiveLevel(auto: number | null, manual: number | null): number | null {
  return manual ?? auto;
}

export const pctFrom = (cmp: number, ref: number): number => (cmp - ref) / ref;
export const distanceToSupport = (cmp: number, s: number): number => (cmp - s) / cmp;
export const distanceToResistance = (cmp: number, r: number): number => (r - cmp) / cmp;

export function isNearLevel(cmp: number, level: number | null, tol = 0.01): boolean {
  return level !== null && Math.abs(cmp - level) / cmp <= tol;
}
