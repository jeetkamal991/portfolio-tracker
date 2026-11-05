import type { SessionCalendar } from "../returns";
import type { TechnicalResult } from "./technical";
import type { TradeResult } from "./tradeQuality";

/** Weights from the specification. Configurable here, never inline. */
export const CONFIDENCE_CONFIG = {
  freshness: 0.4,
  required: 0.4,
  history: 0.2,
  /** Below this the evaluation is LOW CONFIDENCE. */
  lowBelow: 70,
  /** Full history = enough candles for EMA200 (and the 34-candle ATR). */
  fullHistoryBars: 201,
  /** Freshness by trading sessions behind the latest session: 0 behind = 1; 1 behind = 0.75; older than one trading day is stale. */
  freshnessBySessionsBehind: [1, 0.75] as readonly number[],
  /**
   * Items that are legitimately absent for many healthy stocks, so they must not drag confidence down:
   * delivery % exists only for the busiest ~100 stocks, FII/DII need two published quarters, 110 of 237 stocks belong
   * to no sector index, and a stock at a high has no resistance (breakout territory) or no support below it.
   */
  optionalKeys: ["delivery", "fii", "dii", "sectorTrend", "vsSector20", "vsSector60", "rewardRisk", "resistanceRoom", "supportHolding"] as readonly string[],
} as const;

export interface Confidence {
  /** 0-100 */
  score: number;
  freshness: number;
  requiredInputs: number;
  history: number;
  sessionsBehind: number | null;
  stale: boolean;
  status: "OK" | "LOW CONFIDENCE";
}

/** Whole trading sessions between the stock's last bar and the latest session on the Nifty calendar (null if unknown). */
export function sessionsBehind(lastBarDate: string | null, cal: SessionCalendar): number | null {
  if (!lastBarDate || cal.dates.length === 0) return null;
  const last = cal.index.get(lastBarDate);
  if (last === undefined) return lastBarDate > cal.dates[cal.dates.length - 1]! ? 0 : null;
  return cal.dates.length - 1 - last;
}

export function dataConfidence(input: { lastBarDate: string | null; cal: SessionCalendar; bars: number; tech: TechnicalResult; trade: TradeResult }): Confidence {
  const c = CONFIDENCE_CONFIG;
  const behind = sessionsBehind(input.lastBarDate, input.cal);
  const freshness = behind === null ? 0 : (c.freshnessBySessionsBehind[behind] ?? 0);
  const items = [...input.tech.categories, ...input.trade.categories].flatMap((cat) => cat.items).filter((i) => !c.optionalKeys.includes(i.key));
  const total = items.reduce((s, i) => s + i.max, 0);
  const have = items.filter((i) => i.status === "scored").reduce((s, i) => s + i.max, 0);
  const requiredInputs = total === 0 ? 0 : have / total;
  const history = Math.min(1, input.bars / c.fullHistoryBars);
  const score = Math.round((100 * (c.freshness * freshness + c.required * requiredInputs + c.history * history)) * 10) / 10;
  return {
    score, freshness, requiredInputs: Math.round(requiredInputs * 1000) / 1000, history: Math.round(history * 1000) / 1000,
    sessionsBehind: behind, stale: behind === null || behind > 1,
    status: score < c.lowBelow ? "LOW CONFIDENCE" : "OK",
  };
}
