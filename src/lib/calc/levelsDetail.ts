/**
 * How well-tested a support/resistance level is. Bars carry no close, so "above vs
 * below" uses the last bar's midpoint: a level above it counts bars whose HIGH is
 * within `tol` (relative to the level); otherwise bars whose LOW is. Strong at >= 3.
 */
export function levelStrength(
  bars: { high: number; low: number }[],
  level: number | null,
  tol = 0.01,
  lookback = 60,
): { touches: number; strength: "Strong" | "Weak" | null } {
  if (level === null || bars.length === 0) return { touches: 0, strength: null };
  const last = bars[bars.length - 1];
  const above = level > (last.high + last.low) / 2;
  const touches = bars
    .slice(-lookback)
    .filter((x) => Math.abs((above ? x.high : x.low) - level) / level <= tol).length;
  return { touches, strength: touches >= 3 ? "Strong" : "Weak" };
}
