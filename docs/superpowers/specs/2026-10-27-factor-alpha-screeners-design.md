# Factor alpha screeners (Vibe-Trading sub-project 1 of 3)

Date: 2026-10-27. Branch: `feat/stage6b-shareholding` is the current branch; implementation should start on a new branch from `main`.

## Context and intent

The owner liked Vibe-Trading (https://github.com/HKUDS/Vibe-Trading, MIT) and wants three of its ideas inside Tracker, using the stored Nifty 200 data: factor screeners, backtesting, and a plain-English research agent. Decision: **hybrid**. Port the maths to TypeScript (no Python service, no new hosting), and build the research agent later as a scheduled Claude task, the way `docs/claude-tasks/` already works.

Assumptions (stated by Claude, not contradicted): single user, free tiers, no live trading or broker access, no direct Claude API calls from the app.

Roadmap, each with its own spec, plan and build:
1. **Factor alpha screeners (this spec).**
2. Backtesting (reuses `calc/alpha`; Vibe-Trading's `india_equity.py` engine is the reference for NSE costs and rules).
3. Research agent as a scheduled Claude task.

## What this adds

On the Market tab, under the existing Screeners panel: six per-alpha cards and one combined "Alpha rank" card. Each card lists the top 10 and bottom 10 Nifty 200 stocks as of the latest session.

Alphas are cross-sectional scores, not threshold signals. They are short-horizon (the paper's alpha #1 has a 5-day decay). Cards are labelled "ranked by alpha", never buy or sell, and credit the source paper.

## Source and licence

Formulas come from Z. Kakushadze (2015), "101 Formulaic Alphas", arXiv:1601.00991. They are published maths. Vibe-Trading's own notes say its modules were written from the paper's formula table. We do the same in TypeScript and do not copy its code. Each alpha module keeps the arXiv citation in its comment.

## Structure

```
src/lib/calc/alpha/ops.ts     rank, delta, stddev, correlation, ts_rank, decay_linear (pure)
src/lib/calc/alpha/alphas.ts  six alphas: id, name, theme, minBars, compute(panel)
src/lib/calc/alpha/run.ts     runAlphas(stocks, session) -> per-alpha top/bottom 10 + combined rank
src/lib/api/market.ts         loadMarket: widen fetch window to ~30 sessions; add alphas to MarketData
src/lib/view/market.ts        formatting helpers for alpha values
src/app/components/market/AlphaGrid.tsx   per-alpha cards + "Alpha rank" card
```

Input is the same `StockInput` list the screeners use (key, name, `StoredDay[]`). A panel aligns all stocks on shared dates, because each alpha ranks stocks against each other on a day. Stocks not priced on the session are skipped, as in `runScreeners`. UI reuses `StockLink`, `PctText`, `Chip` and the existing card styling.

## Alphas (first six)

All OHLCV-only. VWAP-based, industry-based and market-cap-based alphas are excluded.

| # | Idea | Inputs | Bars |
|---|---|---|---|
| 1 | Reversal after weak days, volatility-weighted | close | 25 |
| 2 | Volume change vs intraday move, correlation | open, close, volume | ~10 |
| 6 | Open vs volume, correlation | open, volume | 10 |
| 12 | Volume-confirmed one-day reversal | close, volume | 2 |
| 54 | Close position inside the day's range | open, high, low, close | 1 |
| 101 | Intraday momentum (close − open) / range | open, high, low, close | 1 |

The formulas were recalled from memory during brainstorming. **Before implementing each, verify it against the paper and Vibe-Trading's `agent/src/factors/zoo/alpha101/alpha_NNN.py`.** If one does not match, swap it for another OHLCV-only alpha from the same family.

## Combined card

Average each stock's per-alpha rank across the alphas it has enough bars for. Stocks with fewer than half the six alphas available are excluded, so thin history cannot dominate.

## Compute approach

Compute on page load from stored candles, no schema change. About 200 stocks × 30 sessions ≈ 6k rows (the screeners fetch ~1.2k today). If the Market tab gets more than about 1 s slower, switch to precomputing in the EOD job into a new table; the calc code is unchanged either way.

Check while building: does `getDaysRange` page past Supabase's row cap for ~6k rows.

## Failure handling

- An alpha that throws or returns NaN for a stock drops that stock from that alpha's cards; the page never breaks.
- If a whole alpha fails, log it; its card shows "unavailable today". Other cards and the screeners still render.
- No Nifty 200 data or no session: hide the alpha section, as the screeners do.
- Flat range (high = low) gives no score for that stock, not a divide by zero.
- A stock with a missing bar is dropped from that day's ranking.

## Testing

- Unit tests for each operator with hand-computed values (rank ties, correlation window, leading bars with no value).
- Per-alpha fixture of about 5 stocks with hand-worked expected scores.
- Optional one-off: run Vibe-Trading's Python on the same fixture and compare, in a scratch folder, not a dependency.
- `npm run typecheck`, `npm run lint`, `npm test` pass.
- Time the Market tab before and after.
- Screenshots of the Market tab in light and dark before handover (see memory: verify UI in a browser).

## Out of scope

Backtesting (sub-project 2), the research agent (3), live trading or broker connections, alphas needing VWAP, industry or market cap, storing alpha history, alerts on alpha ranks.

## Success criteria

1. The Market tab shows six alpha cards and one "Alpha rank" card, each top 10 and bottom 10, as of the latest session.
2. All tests, typecheck and lint pass.
3. Market tab load time rises by about 1 s or less.
4. Verified in light and dark screenshots.
5. Cards say "ranked by alpha" and cite the paper.
