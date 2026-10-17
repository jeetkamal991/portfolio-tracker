/** Mean volume of the `period` sessions before each bar (today excluded); null if any is missing. */
export function volAvgPrev(volumes: (number | null)[], period = 20): (number | null)[] {
  return volumes.map((_, i) => {
    if (i < period) return null;
    let sum = 0;
    for (let j = i - period; j < i; j++) {
      const v = volumes[j];
      if (v === null || v === undefined) return null;
      sum += v;
    }
    return sum / period;
  });
}
