export type Side = "buy" | "sell";

export interface CostModel {
  /** The price a market order actually gets, slippage included. */
  fill(side: Side, price: number): number;
  /** Rupees of statutory charges on a trade of this notional value. */
  charges(side: Side, value: number): number;
}

// NSE delivery rates. They change from time to time: check them against your broker's current schedule.
const SLIPPAGE = 0.001;
const STT = 0.001; // both sides
const EXCHANGE = 0.0000297; // 0.00297%, both sides
const SEBI = 0.000001; // 0.0001%, both sides
const STAMP_BUY = 0.00015; // 0.015%, buys only
const GST = 0.18; // on exchange + SEBI charges

export const NSE_COSTS: CostModel = {
  fill: (side, price) => price * (side === "buy" ? 1 + SLIPPAGE : 1 - SLIPPAGE),
  charges: (side, value) =>
    value * (STT + EXCHANGE + SEBI + (side === "buy" ? STAMP_BUY : 0) + GST * (EXCHANGE + SEBI)),
};

/** For hand-worked tests: no slippage, no charges. */
export const ZERO_COSTS: CostModel = { fill: (_side, price) => price, charges: () => 0 };
