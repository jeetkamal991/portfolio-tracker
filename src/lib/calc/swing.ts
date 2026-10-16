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

/** Nearest merged swing low below cmp (support) and swing high above cmp (resistance). */
export function swingLevels(
  bars: Bar[],
  cmp: number,
  opts: { lookback?: number; side?: number; mergeTol?: number } = {},
): { support: number | null; resistance: number | null } {
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
  const below = cluster(lows, mergeTol).filter((p) => p < cmp);
  const above = cluster(highs, mergeTol).filter((p) => p > cmp);
  return {
    support: below.length ? Math.max(...below) : null,
    resistance: above.length ? Math.min(...above) : null,
  };
}
