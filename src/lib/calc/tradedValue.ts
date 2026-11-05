export interface TvDay {
  date: string;
  close: number | null;
  volume: number | null;
}

export interface TradedValue {
  /** close x volume of the latest session (INR); null if either is missing or zero. */
  latest: number | null;
  /** Mean of the valid sessions in the window. */
  avg: number | null;
  /** Median of the valid sessions in the window: robust to one-off spikes, used for scoring. */
  median: number | null;
  /** Sessions in the window with a usable close x volume. */
  readings: number;
  window: number;
  /** Share of valid sessions trading at least `thinShare` x the median. */
  steadyShare: number | null;
  /** Dates of sessions whose traded value exceeds `spikeMultiple` x the median. */
  spikes: string[];
  /** Sessions in the window with no usable volume (null or 0): left out, never counted as zero. */
  missingVolume: number;
  /** Always true: derived from the day's close, not exchange turnover. Prefer actual turnover if a provider adds it. */
  estimated: true;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function tradedValue(days: TvDay[], opts: { window?: number; minReadings?: number; spikeMultiple?: number; thinShare?: number } = {}): TradedValue {
  const { window = 20, minReadings = 15, spikeMultiple = 20, thinShare = 0.5 } = opts;
  const w = days.slice(-window);
  const tv = w.map((d) => (d.close !== null && d.volume !== null && d.close > 0 && d.volume > 0 ? d.close * d.volume : null));
  const valid = tv.filter((x): x is number => x !== null);
  const missingVolume = w.length - valid.length;
  const latest = tv.length ? tv[tv.length - 1]! : null;
  if (valid.length < minReadings) {
    return { latest, avg: null, median: null, readings: valid.length, window, steadyShare: null, spikes: [], missingVolume, estimated: true };
  }
  const med = median(valid);
  return {
    latest,
    avg: valid.reduce((s, x) => s + x, 0) / valid.length,
    median: med,
    readings: valid.length,
    window,
    steadyShare: valid.filter((x) => x >= thinShare * med).length / valid.length,
    spikes: w.filter((_, i) => tv[i] !== null && tv[i]! > spikeMultiple * med).map((d) => d.date),
    missingVolume,
    estimated: true,
  };
}
