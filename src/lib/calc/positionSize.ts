/**
 * Position sizing for a long trade. A risk-management helper only: it never feeds Technical Strength or Trade Quality.
 * Not financial advice: the defaults are starting values the user is expected to set for themselves.
 */
export const POSITION_DEFAULTS = {
  /** Percent of equity risked if the stop is hit. A placeholder to edit, not a recommendation. */
  riskPct: 1,
  /** Largest share of equity a single position may tie up, in percent. */
  maxAllocationPct: 20,
  lotSize: 1,
  /** Warn (never block) when the risk per trade is above this percent of equity. */
  warnRiskPctAbove: 5,
} as const;

export interface PositionInput {
  equity: number;
  riskPct: number;
  entry: number;
  stop: number;
  maxAllocationPct: number;
  /** Shares per lot (F&O or other lot-traded instruments); 1 for ordinary shares. */
  lotSize?: number;
}

export interface PositionSize {
  ok: true;
  quantity: number;
  lots: number | null;
  riskAmount: number;
  riskPerShare: number;
  capitalRequired: number;
  /** quantity x (entry - stop): the loss if the stop fills exactly at its price. */
  maxLoss: number;
  /** maxLoss as a percent of equity. */
  riskPctOfEquity: number;
  capitalPctOfEquity: number;
  /** What capped the size. */
  limitedBy: "risk" | "allocation" | "lot size";
  warnings: string[];
  assumptions: string[];
}
export interface PositionError {
  ok: false;
  errors: Record<string, string>;
}

export const POSITION_ASSUMPTIONS = [
  "Long position only: the stop must be below the entry.",
  "Maximum loss assumes the stop fills at its price. Gaps, slippage, brokerage, taxes and other charges can make the real loss larger.",
  "Quantity is rounded down to whole shares (or whole lots), so the risk taken is at or below the target.",
  "Account equity is whatever you enter; it is not read from your broker.",
] as const;

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
// A tiny epsilon stops 0.1 + 0.2 style float error from rounding an exact multiple down one share.
const floor = (x: number) => Math.floor(x + 1e-9);

export function positionSize(i: PositionInput): PositionSize | PositionError {
  const errors: Record<string, string> = {};
  const lot = i.lotSize ?? POSITION_DEFAULTS.lotSize;
  if (!pos(i.equity)) errors.equity = "Enter account equity above 0";
  if (!pos(i.riskPct) || i.riskPct > 100) errors.riskPct = "Risk per trade must be above 0% and at most 100%";
  if (!pos(i.entry)) errors.entry = "Enter a valid entry price";
  if (!pos(i.stop)) errors.stop = "Enter a valid stop-loss price";
  if (!pos(i.maxAllocationPct) || i.maxAllocationPct > 100) errors.maxAllocationPct = "Maximum allocation must be above 0% and at most 100%";
  if (!Number.isInteger(lot) || lot < 1) errors.lotSize = "Lot size must be a whole number of at least 1";
  if (!errors.entry && !errors.stop && i.stop >= i.entry) errors.stop = "For a long position the stop-loss must be below the entry price";
  if (Object.keys(errors).length) return { ok: false, errors };

  const riskAmount = i.equity * (i.riskPct / 100);
  const riskPerShare = i.entry - i.stop;
  const byRisk = floor(riskAmount / riskPerShare);
  const byAllocation = floor((i.equity * (i.maxAllocationPct / 100)) / i.entry);
  let quantity = Math.min(byRisk, byAllocation);
  let limitedBy: PositionSize["limitedBy"] = byAllocation < byRisk ? "allocation" : "risk";
  if (lot > 1) {
    const lots = Math.floor(quantity / lot);
    if (lots * lot < quantity) limitedBy = "lot size";
    quantity = lots * lot;
  }
  if (quantity < 1) {
    const need = Math.max(lot, 1);
    return {
      ok: false,
      errors: {
        quantity: `Not even ${need === 1 ? "one share" : `one lot (${need} shares)`} fits: the risk limit allows ₹${riskAmount.toFixed(0)} (₹${riskPerShare.toFixed(2)} per share) and the allocation limit allows ₹${(i.equity * (i.maxAllocationPct / 100)).toFixed(0)}.`,
      },
    };
  }
  const maxLoss = quantity * riskPerShare;
  const capitalRequired = quantity * i.entry;
  const warnings: string[] = [];
  if (i.riskPct > POSITION_DEFAULTS.warnRiskPctAbove) warnings.push(`Risk per trade is ${i.riskPct}% of equity, above the ${POSITION_DEFAULTS.warnRiskPctAbove}% warning level.`);
  if (limitedBy === "allocation") warnings.push("Size is limited by the maximum allocation, so less than the target risk is being taken.");
  if (capitalRequired > i.equity) warnings.push("Capital required exceeds account equity: this needs leverage or margin.");
  return {
    ok: true, quantity, lots: lot > 1 ? quantity / lot : null, riskAmount, riskPerShare, capitalRequired, maxLoss,
    riskPctOfEquity: (maxLoss / i.equity) * 100, capitalPctOfEquity: (capitalRequired / i.equity) * 100,
    limitedBy, warnings, assumptions: [...POSITION_ASSUMPTIONS],
  };
}
