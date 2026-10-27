/** What every backtest result must be read with, in the command's output and on the Backtests page. */
export function caveats(strategyId: string): string[] {
  const out = [
    "Survivorship bias: only today's Nifty 200 members are tested. Stocks that left the index or were delisted are missing, so results look better than reality.",
    "Price only: dividends are not included.",
    "No circuit limits and no liquidity cap: every order is assumed to fill at the open.",
  ];
  // alphas #1 and #54 take few distinct values, so a top-N pick among ties is arbitrary
  if (strategyId === "alpha:a001" || strategyId === "alpha:a054") {
    out.push("Tied alpha scores: this alpha takes few distinct values, so a top-N pick among ties falls back to stock-key order, which is arbitrary.");
  }
  return out;
}
