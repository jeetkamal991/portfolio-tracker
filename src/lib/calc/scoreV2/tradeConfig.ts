/** Trade Quality (enhanced_v2): every weight and threshold is configurable here. Tier tables are [lower bound inclusive, share of the item's max]. */
export const TRADE_WEIGHTS = { rewardRisk: 30, entry: 25, volatility: 25, liquidity: 20 } as const;
export type TradeCategoryKey = keyof typeof TRADE_WEIGHTS;

export const TRADE_CONFIG = {
  levels: {
    /** Suggested stop = lower of valid support and entry - atrStopMultiple x ATR. */
    atrStopMultiple: 1.5,
  },
  /** Reward-to-risk tiers (from the specification: 3.0 -> 25/25, 2.5 -> 22, 2.0 -> 19, 1.5 -> 14, 1.0 -> 7). */
  rewardRiskTiers: [[3, 1], [2.5, 0.88], [2, 0.76], [1.5, 0.56], [1, 0.28], [0, 0]] as [number, number][],
  entry: {
    ema20: 10, ema50: 5, resistanceRoom: 5, supportHolding: 5,
    /** Distance above the EMA in ATRs -> share. A close below the EMA is not rewarded: nothing shows support is holding. */
    ema20Tiers: [[3, 0], [2, 0.35], [1, 0.7], [0, 1]] as [number, number][],
    ema20Below: 0.3,
    ema50Tiers: [[6, 0], [4, 0.3], [2, 0.7], [0, 1]] as [number, number][],
    ema50Below: 0.2,
    /** Room up to resistance in ATRs. */
    resistanceTiers: [[3, 1], [2, 0.7], [1, 0.4], [0, 0.1]] as [number, number][],
    /** Support counts as "near" within this many ATRs below the close. */
    supportNearAtr: 1.5,
    supportHeldTol: 0.005,
    supportNeutral: 0.5,
    heldSessions: 3,
    /** Entry observations. */
    extendedAtr: 2.5,
    pullbackAtr: 1.5,
    poorRewardRisk: 1.5,
    weakTechnical: 50,
  },
  volatility: {
    atrPct: 8, expansion: 6, stopDistance: 7, gapRisk: 4,
    /** ATR% of price -> share (higher is not automatically bad: it only matters through the other items). */
    atrPctTiers: [[7, 0.125], [5, 0.375], [3.5, 0.625], [2, 0.875], [0, 1]] as [number, number][],
    /** ATR now / ATR `expansionSessions` ago. Lower ratio = contracting. Tiers are on the ratio, ascending bounds. */
    expansionSessions: 20,
    expansionBands: [[1.4, 0.15], [1.15, 0.5], [0.9, 0.85], [0, 1]] as [number, number][],
    /** (entry - stop) / ATR: too tight sits inside normal daily noise; too wide wastes risk budget. */
    stopTiers: { tooTight: 1, tight: 1.5, good: 3, wide: 4 },
    stopShares: { tooTight: 0, tight: 0.43, good: 1, wide: 0.64, tooWide: 0.29 },
    gapSessions: 60,
    gapTiers: [[2, 0.12], [1, 0.62], [0, 1]] as [number, number][],
  },
  liquidity: {
    value: 12, steady: 4, position: 4,
    /** Median daily traded value in INR crore -> share. */
    valueTiersCr: [[100, 1], [50, 0.83], [20, 0.67], [5, 0.42], [1, 0.17], [0, 0]] as [number, number][],
    /** Below this median value (INR crore) the stock is flagged as seriously illiquid. */
    minValueCr: 1,
    steadyTiers: [[0.9, 1], [0.75, 0.75], [0.5, 0.375], [0, 0]] as [number, number][],
    /** A position of this size (INR) as a share of the median daily traded value -> share. Ascending upper bounds. */
    referencePositionInr: 1_000_000,
    positionBands: [[0.001, 1], [0.005, 0.75], [0.01, 0.5], [0.02, 0.25]] as [number, number][],
    window: 20,
    minReadings: 15,
  },
} as const;

/** Trade Quality coverage required for ranking eligibility. */
export const MIN_TRADE_COVERAGE_FOR_RANKING = 0.8;
export const TRADE_MIN_CANDLES_ATR = 34;
