import { swingLevels } from "./swing";

export interface KeyLevels {
  pdh: number | null;
  pdl: number | null;
  high52: number | null;
  support: number | null;
  resistance: number | null;
}

type Bar = { date: string; high: number | null; low: number | null; close: number | null };

const WEEKS_52 = 252;

/**
 * Levels the chart draws, from the stored bars: the previous session's high/low (the bar before the newest), the highest high
 * of the last 252 sessions, and the nearest swing low below / swing high above the latest close (the same swing rule the
 * Portfolio form's suggested levels use).
 */
export function keyLevels(days: Bar[]): KeyLevels {
  const bars = days
    .filter((d): d is Bar & { high: number; low: number; close: number } => d.high !== null && d.low !== null && d.close !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = bars[bars.length - 1];
  if (!last) return { pdh: null, pdl: null, high52: null, support: null, resistance: null };
  const prev = bars[bars.length - 2];
  const { support, resistance } = swingLevels(bars, last.close);
  return {
    pdh: prev?.high ?? null,
    pdl: prev?.low ?? null,
    high52: Math.max(...bars.slice(-WEEKS_52).map((b) => b.high)),
    support,
    resistance,
  };
}
