export interface AtrBar {
  high: number | null;
  low: number | null;
  close: number | null;
}

export interface AtrResult {
  /** ATR(period) on the latest bar; null if the final run of valid bars is too short. */
  atr: number | null;
  /** atr / latest close * 100 */
  atrPct: number | null;
  /** Valid, contiguous candles ending at the latest bar (what the ATR was built from). */
  candles: number;
  /** Same length as the input; null until the first ATR exists in a run. */
  series: (number | null)[];
  /** Indices of bars where |close / previous close - 1| exceeded `maxJump`: likely an unadjusted split/bonus. */
  jumps: number[];
  status: "OK" | "INSUFFICIENT_HISTORY";
}

/**
 * Wilder's ATR. TR = max(H-L, |H-prevC|, |L-prevC|); the first ATR is the simple mean of the first `period` TRs
 * of a run, then ATR = (prevATR * (period-1) + TR) / period.
 *
 * A run restarts (the state is dropped, never filled in) at a bar with a missing or inconsistent H/L/C, and at a
 * bar whose close is more than `maxJump` away from the previous close: price limits make that move impossible
 * on an ordinary day, so it is either an unadjusted split/bonus/demerger or an extreme event; the two cannot be told apart from prices alone, and an unadjusted one would poison the ATR for 14+ sessions. A real crash therefore makes ATR unavailable for ~34 sessions (shown as missing) rather than understating risk.
 * A missed session in the middle is not treated as a break: TR then covers the whole gap from the last stored
 * close, which is what a true range is.
 *
 * shortcut: prices are assumed split-adjusted as stored by the provider; the jump rule only catches the
 * unadjusted case, it cannot repair it. Upgrade when a corporate-actions feed exists.
 */
export function atrSeries(bars: AtrBar[], period = 14, maxJump = 0.3, minCandles = 34): AtrResult {
  const series: (number | null)[] = bars.map(() => null);
  const jumps: number[] = [];
  let prev: number | null = null;
  let atr: number | null = null;
  let seed: number[] = [];
  let run = 0;

  const reset = () => {
    prev = null; atr = null; seed = []; run = 0;
  };
  bars.forEach((b, i) => {
    const { high: h, low: l, close: c } = b;
    if (h === null || l === null || c === null || !(c > 0) || !(h >= l) || c > h * 1.0001 || c < l * 0.9999) {
      reset();
      return;
    }
    if (prev !== null && Math.abs(c / prev - 1) > maxJump) {
      jumps.push(i);
      reset();
    }
    run++;
    if (prev !== null) {
      const tr = Math.max(h - l, Math.abs(h - prev), Math.abs(l - prev));
      if (atr === null) {
        seed.push(tr);
        if (seed.length === period) atr = seed.reduce((s, x) => s + x, 0) / period;
      } else {
        atr = (atr * (period - 1) + tr) / period;
      }
    }
    prev = c;
    series[i] = atr;
  });

  const lastBar = bars[bars.length - 1];
  const latest = series[series.length - 1] ?? null;
  const ok = latest !== null && run >= minCandles && lastBar?.close != null;
  return {
    atr: ok ? latest : null,
    atrPct: ok ? (latest! / lastBar!.close!) * 100 : null,
    candles: run,
    series,
    jumps,
    status: ok ? "OK" : "INSUFFICIENT_HISTORY",
  };
}
