import { emaSeries } from "./ema";

/** MACD: EMA(fast) - EMA(slow); signal = EMA(signal) of macd seeded with the SMA of its first non-null values. */
export function macdSeries(closes: number[], fast = 12, slow = 26, signal = 9) {
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const macd = closes.map((_, i) =>
    f[i] === null || s[i] === null ? null : f[i]! - s[i]!,
  );
  const start = macd.findIndex((v) => v !== null);
  const sig: (number | null)[] = closes.map(() => null);
  if (start >= 0) {
    const tail = emaSeries(macd.slice(start) as number[], signal);
    tail.forEach((v, j) => {
      sig[start + j] = v;
    });
  }
  const hist = macd.map((m, i) => (m === null || sig[i] === null ? null : m - sig[i]!));
  return { macd, signal: sig, hist };
}
