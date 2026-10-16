export type Trend = "above_both" | "between" | "below_both";

export function trendTag(cmp: number, ema50: number | null, ema200: number | null): Trend | null {
  if (ema50 === null || ema200 === null) return null;
  if (cmp > ema50 && cmp > ema200) return "above_both";
  if (cmp < ema50 && cmp < ema200) return "below_both";
  return "between";
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
