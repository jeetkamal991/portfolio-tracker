/** Fractional change from prev to close (-0.0088 = -0.88%). */
export function pctChange(prev: number, close: number): number {
  return (close - prev) / prev;
}
