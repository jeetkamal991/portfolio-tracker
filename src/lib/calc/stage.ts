import type { StoredDay } from "@/lib/db/types";

// Weinstein stage analysis on weekly bars built from stored daily candles. Every threshold lives here.
export const SLOPE_FLAT = 0.01; // |MA30 change over SLOPE_WEEKS| at or below this counts as flat
export const MA_WEEKS = 30;
export const SLOPE_WEEKS = 4;
export const DECLINE_LOOKBACK_WEEKS = 26; // flat MA: stage 1 if MA30 is below its value this many weeks ago, else stage 3
export const MIN_WEEKS = MA_WEEKS + SLOPE_WEEKS;
export const BREAKOUT_WINDOW_WEEKS = 4;
export const BASE_MIN_WEEKS = 8;
export const BASE_MAX_WEEKS = 26;
export const BASE_MAX_RANGE = 0.25; // (high - low) / low of the base
export const BREAKOUT_VOLUME_MULT = 2;
export const BREAKOUT_MAX_EXTENSION = 0.08; // close at most this far above the base high

export type StageDay = Pick<StoredDay, "date" | "high" | "low" | "close" | "volume">;
export type StageNumber = 1 | 2 | 3 | 4;
export interface StageResult {
  stage: StageNumber | null;
  freshBreakout: boolean;
  ma30: number | null;
  /** MA30 now / MA30 SLOPE_WEEKS ago - 1. */
  slope: number | null;
  baseHigh?: number;
  weeksInStage: number;
}

interface Week { key: string; lastDate: string; high: number; low: number; close: number; volume: number }

const NONE: StageResult = { stage: null, freshBreakout: false, ma30: null, slope: null, weeksInStage: 0 };

/** Monday of the week containing `date` (YYYY-MM-DD). */
function weekKey(date: string): string {
  const t = Date.parse(date);
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

function weeklyBars(days: StageDay[]): Week[] {
  const weeks = new Map<string, Week>();
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (d.close === null) continue;
    const key = weekKey(d.date);
    const w = weeks.get(key);
    const high = d.high ?? d.close, low = d.low ?? d.close, volume = d.volume ?? 0;
    if (!w) weeks.set(key, { key, lastDate: d.date, high, low, close: d.close, volume });
    else { w.lastDate = d.date; w.high = Math.max(w.high, high); w.low = Math.min(w.low, low); w.close = d.close; w.volume += volume; }
  }
  return [...weeks.values()];
}

/**
 * A week is complete once a later week has started (`asOf` is the IST date) or its last stored session is a Friday.
 * shortcut: no holiday calendar, so a week ending on a Thursday before a Friday holiday counts only from the next week; add one if that matters.
 */
function completedWeeks(days: StageDay[], asOf: string): Week[] {
  const weeks = weeklyBars(days);
  const last = weeks[weeks.length - 1];
  if (last && last.key >= weekKey(asOf) && new Date(Date.parse(last.lastDate)).getUTCDay() !== 5) weeks.pop();
  return weeks;
}

/** Stage of week i; needs the MA30 series and the previous week's stage (a flat MA above its price level can still be a stage 2 start). */
function stageAt(i: number, closes: number[], ma: (number | null)[], prev: StageNumber | null): StageNumber {
  const now = ma[i]!, slope = now / ma[i - SLOPE_WEEKS]! - 1;
  const rising = slope > SLOPE_FLAT, falling = slope < -SLOPE_FLAT;
  const above = closes[i] > now;
  if (above && (rising || (!falling && prev === 1))) return 2;
  if (closes[i] < now && falling) return 4;
  // shortcut: with under 56 weeks the 26-week-ago MA does not exist, so the oldest MA30 is used; revisit if early calls look wrong
  const ref = ma[Math.max(MA_WEEKS - 1, i - DECLINE_LOOKBACK_WEEKS)]!;
  return now < ref ? 1 : 3;
}

/** The newest week (within the window) that closed above a tight base on heavy volume, or null. */
function findBreakout(weeks: Week[]): number | null {
  const n = weeks.length;
  for (let j = n - 1; j >= Math.max(n - BREAKOUT_WINDOW_WEEKS, 0); j--) {
    // bases ending the week before j, longest first
    for (let len = Math.min(BASE_MAX_WEEKS, j); len >= BASE_MIN_WEEKS; len--) {
      const base = weeks.slice(j - len, j);
      const high = Math.max(...base.map((w) => w.high)), low = Math.min(...base.map((w) => w.low));
      if (low <= 0 || (high - low) / low > BASE_MAX_RANGE) continue;
      const avgVol = base.reduce((s, w) => s + w.volume, 0) / len;
      const c = weeks[j].close;
      if (c > high && c <= high * (1 + BREAKOUT_MAX_EXTENSION) && weeks[j].volume >= BREAKOUT_VOLUME_MULT * avgVol) return high;
    }
  }
  return null;
}

/** Pure: stage of the newest completed week. `asOf` is today's IST date (YYYY-MM-DD). */
export function computeStage(days: StageDay[], asOf: string): StageResult {
  const weeks = completedWeeks(days, asOf);
  const n = weeks.length;
  if (n < MIN_WEEKS) return NONE;
  const closes = weeks.map((w) => w.close);
  const ma: (number | null)[] = closes.map((_, i) => (i < MA_WEEKS - 1 ? null : closes.slice(i - MA_WEEKS + 1, i + 1).reduce((a, b) => a + b, 0) / MA_WEEKS));
  const stages: StageNumber[] = [];
  for (let i = MIN_WEEKS - 1; i < n; i++) stages.push(stageAt(i, closes, ma, stages[stages.length - 1] ?? null));
  const stage = stages[stages.length - 1];
  let weeksInStage = 0;
  while (weeksInStage < stages.length && stages[stages.length - 1 - weeksInStage] === stage) weeksInStage++;
  const baseHigh = stage === 2 ? findBreakout(weeks) : null;
  return {
    stage, freshBreakout: baseHigh !== null, ma30: ma[n - 1]!, slope: ma[n - 1]! / ma[n - 1 - SLOPE_WEEKS]! - 1, weeksInStage,
    ...(baseHigh !== null && { baseHigh }),
  };
}
