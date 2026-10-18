export interface Bar {
  high: number;
  low: number;
}

function cluster(prices: number[], tol: number): number[] {
  const sorted = [...prices].sort((a, b) => a - b);
  const out: number[] = [];
  let sum = 0;
  let n = 0;
  for (const p of sorted) {
    if (n > 0 && (p - sum / n) / (sum / n) <= tol) {
      sum += p;
      n++;
    } else {
      if (n > 0) out.push(sum / n);
      sum = p;
      n = 1;
    }
  }
  if (n > 0) out.push(sum / n);
  return out;
}

/** All merged swing lows below cmp (supports) and swing highs above cmp (resistances), nearest first. */
export function swingLevelList(
  bars: Bar[],
  cmp: number,
  opts: { lookback?: number; side?: number; mergeTol?: number } = {},
): { supports: number[]; resistances: number[] } {
  const { lookback = 60, side = 5, mergeTol = 0.01 } = opts;
  const w = bars.slice(-lookback);
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = side; i < w.length - side; i++) {
    let hiOk = true, hiStrict = false, loOk = true, loStrict = false;
    for (let j = i - side; j <= i + side; j++) {
      if (j === i) continue;
      if (w[j]!.high > w[i]!.high) hiOk = false;
      if (w[j]!.high < w[i]!.high) hiStrict = true;
      if (w[j]!.low < w[i]!.low) loOk = false;
      if (w[j]!.low > w[i]!.low) loStrict = true;
    }
    if (hiOk && hiStrict) highs.push(w[i]!.high);
    if (loOk && loStrict) lows.push(w[i]!.low);
  }
  return {
    supports: cluster(lows, mergeTol).filter((p) => p < cmp).sort((a, b) => b - a),
    resistances: cluster(highs, mergeTol).filter((p) => p > cmp).sort((a, b) => a - b),
  };
}

/** Nearest merged swing low below cmp (support) and swing high above cmp (resistance). */
export function swingLevels(
  bars: Bar[],
  cmp: number,
  opts: { lookback?: number; side?: number; mergeTol?: number } = {},
): { support: number | null; resistance: number | null } {
  const { supports, resistances } = swingLevelList(bars, cmp, opts);
  return { support: supports[0] ?? null, resistance: resistances[0] ?? null };
}
