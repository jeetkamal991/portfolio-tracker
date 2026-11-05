import { computeIndicators } from "../indicators";
import { swingLevels } from "../swing";
import type { StoredDay } from "@/lib/db/types";

/**
 * Stretches of stored history that are NOT on one price basis and for which no official adjustment factor is available.
 * They are never "fixed" with an invented factor: enhanced_v2 instead scores only the bars from the break onward
 * (indicators and swing levels recomputed on that segment, so ATR, EMAs, RSI, MACD and relative strength do not mix bases),
 * and every snapshot carries the note below. Revisit an entry only when an official NSE adjustment factor exists.
 */
export interface PriceBreak {
  /** First session on the new price basis. */
  date: string;
  kind: "demerger";
  note: string;
}

export const KNOWN_PRICE_BREAKS: Record<string, PriceBreak[]> = {
  TMPV: [
    {
      date: "2025-10-14",
      kind: "demerger",
      note: "Tata Motors demerger (ex-date 2025-10-14, price discovered in a special pre-open session): prices before and after are on different bases and no official adjustment factor is applied. Indicators, ATR and levels use only the sessions from 2025-10-14.",
    },
  ],
};

export interface DataQualityNote {
  kind: "price_break";
  date: string;
  note: string;
  /** Sessions on the new basis that the scores were computed from. */
  sessionsUsed: number;
}

/** The latest known break for the stock that has at least one bar on or after its date, else null. */
export function breakFor(key: string, days: { date: string }[]): PriceBreak | null {
  const list = (KNOWN_PRICE_BREAKS[key] ?? []).filter((b) => days.some((d) => d.date >= b.date) && days.some((d) => d.date < b.date));
  return list.length ? list[list.length - 1]! : null;
}

/**
 * Bars from the break onward with every indicator recomputed on that segment alone (the stored ones ran across the break),
 * and swing support/resistance recomputed from the same bars. Needs the Nifty closes for relative strength.
 */
export function segmentAtBreak(
  days: StoredDay[],
  brk: PriceBreak,
  niftyCloses: Map<string, number>,
): { days: StoredDay[]; support: number | null; resistance: number | null } {
  const seg = days.filter((d) => d.date >= brk.date && d.close !== null);
  const rows = computeIndicators(
    seg.map((d) => ({ date: d.date, open: d.open, high: d.high, low: d.low, close: d.close as number, volume: d.volume })),
    niftyCloses,
  );
  const merged = seg.map((d, i) => ({ ...d, ...rows[i]! }));
  const cmp = merged[merged.length - 1]?.close ?? null;
  const bars = seg.filter((d) => d.high !== null && d.low !== null).map((d) => ({ high: d.high as number, low: d.low as number }));
  const lv = cmp === null ? { support: null, resistance: null } : swingLevels(bars, cmp);
  return { days: merged, support: lv.support, resistance: lv.resistance };
}
