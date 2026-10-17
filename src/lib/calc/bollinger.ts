/** Bollinger bands: SMA(period) ± mult × population standard deviation. */
export function bollingerSeries(closes: number[], period = 20, mult = 2) {
  const upper: (number | null)[] = closes.map(() => null);
  const middle: (number | null)[] = closes.map(() => null);
  const lower: (number | null)[] = closes.map(() => null);
  for (let i = period - 1; i < closes.length; i++) {
    const w = closes.slice(i - period + 1, i + 1);
    const mean = w.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    middle[i] = mean;
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}
