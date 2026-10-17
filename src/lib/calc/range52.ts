/** Rolling max high / min low over the last `window` bars including today (close where high/low is null). */
export function range52Series(
  bars: { high: number | null; low: number | null; close: number }[],
  window = 252,
): { high: number[]; low: number[] } {
  const high: number[] = [];
  const low: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const b = bars[j]!;
      hi = Math.max(hi, b.high ?? b.close);
      lo = Math.min(lo, b.low ?? b.close);
    }
    high.push(hi);
    low.push(lo);
  }
  return { high, low };
}
