/** enhanced_v2 methodology: every weight and threshold lives here, nothing is hardcoded in the scoring code. */
export const SCORING_VERSION = "enhanced_v2";

export const TECH_WEIGHTS = {
  trend: 18,
  momentum: 16,
  volume: 12,
  pattern: 12,
  market: 12,
  relativeStrength: 20,
  flows: 10,
} as const;
export type TechCategoryKey = keyof typeof TECH_WEIGHTS;

export const TECH_CONFIG = {
  /** Sessions over which an EMA "slope" is measured. */
  slopeSessions: 5,
  /** Higher-highs/lows compares the last N sessions to the N before. */
  structureSessions: 10,
  trend: { aboveEma20: 3, aboveEma50: 3, aboveEma200: 3, ema20Over50: 2, ema50Over200: 2, ema20Slope: 2, ema50Slope: 1, higherHighsLows: 2 },
  momentum: {
    rsiLevel: 6, rsiDirection: 2, macdOverSignal: 3, macdOverZero: 2, histRising: 3,
    /** [lower bound inclusive, share of rsiLevel]; first matching row from the top. >75 is penalised for extension, not reversed. */
    rsiBands: [[75.0001, 0.35], [70.0001, 0.7], [55, 1], [50, 0.6], [45, 0.35], [40, 0.15], [-Infinity, 0]] as [number, number][],
    rsiLookback: 3,
    rsiFlat: 1,
    rsiExtended: 75,
  },
  volume: {
    confirmation: 8,
    accumulation: 4,
    accumulationSessions: 10,
    /** Mutually exclusive RVOL tiers [min RVOL, share of `confirmation`] on an up day. */
    upTiers: [[2, 1], [1.5, 0.875], [1.2, 0.75], [1, 0.55], [0, 0.375]] as [number, number][],
    /** On a down day high volume is selling pressure; light volume means selling is fading. */
    downTiers: [[1.5, 0], [1.2, 0.125], [1, 0.25], [0, 0.5]] as [number, number][],
    flatShare: 0.5,
    /** Up-day share of volume over the window -> share of `accumulation`. */
    accumulationTiers: [[0.6, 1], [0.5, 0.625], [0.4, 0.25], [0, 0]] as [number, number][],
  },
  pattern: {
    candle: 6, breakout: 6,
    candleNeutral: 3, /* share of `candle` awarded with no pattern in the window: explicit, shown as neutral */
    hitStep: 1.5, contextMultiplier: 1.5, nearLevelTol: 0.015, windowSessions: 3,
    breakoutSessions: 20, breakoutRvol: 1.2, breakoutNearTol: 0.02, breakoutNoVolShare: 0.58, breakoutNearShare: 0.33,
  },
  market: { niftyTrend: 5, sectorTrend: 5, breadth: 2, breadthTiers: [[0.6, 1], [0.4, 0.5], [0, 0]] as [number, number][] },
  indexTrend: { aboveEma20: 1.5, aboveEma50: 1.5, aboveEma200: 1, ema20Slope: 1 },
  relativeStrength: {
    vsNifty20: 5, vsNifty60: 5, vsSector20: 4, vsSector60: 3, improving: 3,
    /** Excess return thresholds for 20 sessions [min excess, share]; 60-session thresholds are scaled by `scale60`. */
    tiers20: [[0.05, 1], [0.02, 0.8], [0, 0.55], [-0.02, 0.3], [-0.05, 0.1], [-Infinity, 0]] as [number, number][],
    scale60: 1.7,
    improvingGap: 10, improvingMin: 0.01,
  },
  flows: {
    fii: 4, dii: 3, delivery: 3,
    deliveryMinReadings: 3,
    deliveryHigh: 60, deliveryMid: 45,
  },
} as const;

/** Coverage below this marks the score PROVISIONAL (not comparable with fully evaluated stocks). */
export const MIN_COVERAGE_FOR_RANKING = 0.8;
