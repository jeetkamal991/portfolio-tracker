# Backtesting (Vibe-Trading sub-project 2 of 3)

Date: 2026-10-27. Builds on `docs/superpowers/specs/2026-10-27-factor-alpha-screeners-design.md` (merged locally on `feat/stage6b-shareholding`). Start implementation on a new branch from the current HEAD, not `main`, which lacks stage 6b and the alphas.

## Context and intent

The owner liked Vibe-Trading (https://github.com/HKUDS/Vibe-Trading, MIT) and chose three ideas: factor screeners (done), backtesting (this spec) and a research agent (sub-project 3, later). Backtesting should let the owner test an idea on Tracker's own stored history and see how it would have done: CAGR, drawdown, hit rate, turnover, against Nifty 50, after realistic NSE costs.

Decisions made in brainstorming:
- **Both** alpha strategies and screener-rule strategies, through one signal interface.
- **Local script + saved results + a read-only page** (option A). A script on the owner's PC runs the simulation and writes one row per run to Supabase; the website only reads. No simulation runs on Vercel. The full history is about 380,000 rows (200 stocks x ~1,900 sessions), far too much to fetch on a page load (measured: ~1.9 s for 5,800 narrow rows in parallel).
- Single user, free tiers, no live trading, no direct Claude API calls from the app.

Roadmap: 1) factor alpha screeners (merged), 2) backtesting (this), 3) research agent as a scheduled Claude task.

## Data available (checked 2026-10-27)

Nifty 200 stocks start around 2019-01-01 (about 7.8 years); NIFTY50 starts 2015-01-02. OHLCV and the stored per-day indicators (ema20/50/200, rsi14, macd, bb, volAvg20, high52w/low52w) exist in `daily_prices`. **Not verified:** how far back the stored Technical Score is filled, and that stored OHLC is split-adjusted (Yahoo normally adjusts for splits, not dividends). Check both before trusting results; if the score is not stored for history, leave `score_top/bottom` out of the rule list.

## Structure

```
scripts/backtest.ts                         CLI: load history once, run the engine, save one run
src/lib/calc/backtest/strategy.ts           Strategy interface + built-in alpha and rule strategies
src/lib/calc/backtest/engine.ts             pure simulator: bars + strategy + costs -> trades, equity
src/lib/calc/backtest/metrics.ts            CAGR, max drawdown, volatility, Sharpe, hit rate, turnover
src/lib/calc/backtest/costs.ts              NSE delivery costs as constants
supabase/migrations/0010_backtest_runs.sql  one table
src/lib/db/repo.ts, memoryRepo.ts, supabaseRepo.ts   saveBacktestRun, listBacktestRuns, getBacktestRun
src/app/(app)/backtests/page.tsx            list of runs
src/app/(app)/backtests/[id]/page.tsx       one run: caveats, metric cards, equity curve, trades
src/app/components/backtests/*              list table, metric cards, curve (lightweight-charts), trade table
top bar                                      a new Backtests tab
```

## One interface for both strategy kinds

A strategy answers: "given the history up to and including date t, which stocks do you want to buy, in priority order?" Everything else is shared.
- **Alpha strategy:** returns the top N stocks by one alpha on date t, using `runAlphas(stocksCutAtT, t, N)` from `src/lib/calc/alpha/run.ts` unchanged.
- **Rule strategy:** returns the stocks where a screener rule fires on t, using `runScreeners(stocksCutAtT, t, limit)` from `src/lib/calc/screeners.ts` with a limit large enough to return every match. Offered rules: volume shockers (up/down), 52-week breakout/breakdown, golden/death cross, RSI overbought/oversold.
- **Exits** belong to the run settings: hold H sessions, plus an optional stop loss of s percent.

**Look-ahead guard (structural).** The engine passes a strategy only rows dated up to and including t. A pick made on t is bought at the **open of t+1**.

## Simulation rules

- Timeline: the NIFTY50 trading calendar.
- Entry: signal on the close of t, order at the open of t+1; skipped if the stock has no open price that day.
- Defaults (all per-run settings): starting capital 1,000,000 rupees; at most **K = 10** open positions; long-only; each new position gets about 1/K of current equity, in whole shares; free slots filled in the strategy's priority order, skipping stocks already held; cash earns nothing.
- Exits, whichever comes first: time exit after **H = 5** sessions at that day's open; optional stop loss at s percent below entry, checked against each day's low, filled at the open if the stock gaps below the stop, else at the stop price.
- Costs on every fill (Vibe-Trading `india_equity.py` delivery defaults): STT 0.1% both sides; exchange charge 0.00297% both sides; SEBI fee 0.0001% both sides; stamp duty 0.015% on buys only; GST 18% on exchange + SEBI charges; brokerage 0; DP charge 0; slippage 0.1% against the trader on each fill. Constants live in `costs.ts` with a comment that rates change and must be checked against the broker's current schedule.
- Equity curve: daily, marked to the close.
- Benchmark: NIFTY50 buy-and-hold over the same dates, price only, no costs.
- Metrics: total return, CAGR, max drawdown, annualised volatility, Sharpe (risk-free rate taken as 0, stated on the result), hit rate, average win and loss, trade count, turnover (traded value per year / average equity), time invested; each beside the benchmark's figures.

## Storage

Table `backtest_runs` (migration `0010`), RLS on with no policies, like the other tables. Columns: `id bigserial`, `created_at timestamptz default now()`, `name text`, `strategy jsonb` (id + params), `settings jsonb` (K, H, stop, capital, from, to), `metrics jsonb` (strategy and benchmark), `equity jsonb` (array of `[date, strategy, benchmark]`, ~1,900 points), `trades jsonb` (entry/exit date, key, qty, prices, P/L, exit reason, flags), `data_through date`, `universe_note text`. Repo methods: `saveBacktestRun`, `listBacktestRuns` (metadata and metrics only, not the heavy JSON), `getBacktestRun(id)`. The migration is applied to the owner's Tracker1 project by the owner, or by Claude only after asking.

## Command

```
npm run backtest -- alpha --alpha a101 --top 10 --hold 5 [--stop 7] [--from 2019-06-01] [--name "..."]
npm run backtest -- rule  --rule golden --hold 10 --stop 8 [--max-positions 10]
npm run backtest -- ... --dry-run     # prints the result, saves nothing
```

It loads only the columns the strategy needs (alphas read OHLCV only; rules also read the stored indicators), runs in memory, prints a results table, and saves the run unless `--dry-run`. It reads `.env.local` the way the other scripts do. A failed run saves nothing.

## Page

New Backtests tab. **List:** one row per run, newest first: name, strategy, period, CAGR, max drawdown, Sharpe, beside Nifty 50's CAGR. **Run detail:** caveats at the top; metric cards (strategy vs Nifty 50); equity curve with both lines rebased to 100 (`lightweight-charts`, as the stock chart); trade table, newest first, with "Show all". Read-only: no delete, no "request run" button. Unknown id gives a 404; a malformed saved row shows "can't display this run" without breaking the list.

## Caveats shown on every run

1. **Survivorship bias:** only today's Nifty 200 members are tested; stocks that left the index or were delisted are missing, so results look better than reality.
2. **Price only:** no dividends.
3. **No circuit limits and no liquidity cap.**
4. **Tied alpha scores:** alphas #1 and #54 take few distinct values, so a top-N pick among ties falls back to stock-key order (deterministic but arbitrary). A run on those alphas carries an extra note saying so.

## Failure handling

- A stock with a missing bar gets no fill that day; a missing exit day exits at the next available open.
- A stock whose data ends while held (a delisting) is closed at its last close and the trade is flagged.
- NaN or zero prices are skipped.
- History too short for the strategy: a clear refusal message.
- The engine is deterministic: the same inputs give the same output.

## Testing

- `costs`: one hand-worked buy-and-sell with every charge line.
- `engine`: scenarios of 2 to 3 stocks and about 10 bars, worked by hand: entry at the next open and the H-session exit; stop loss including a gap below the stop; the K cap and priority order; a no-look-ahead test proving a strategy never receives a row after t; costs lowering the result.
- `metrics`: equity series with known CAGR, drawdown and Sharpe.
- `strategy`: the alpha strategy takes the top N from `runAlphas`; the rule strategy matches `runScreeners` on history cut at t.
- Repo methods on the memory repo and on a fake Supabase client (as `getOhlcvRange`).
- Command: argument parsing, and an end-to-end `--dry-run` on a small in-memory repo.
- Sanity runs on real data before trusting anything: a "buy NIFTY50 and hold" control should reproduce the benchmark almost exactly; a seeded random-picks strategy should land near the benchmark minus costs (if random picks look brilliant, there is a bug).
- Page: formatter tests, plus light/dark screenshots by static render (the app is dark-only; note it) before handover.
- `npm run typecheck`, `npm run lint`, `npm test` pass.

## Out of scope

Dividends, short selling and leverage, intraday logic, stake-based signals (too little history), parameter search or optimisation (invites overfitting), a "Request run" button, deleting runs from the page, live trading, the Claude research agent (sub-project 3).

## Success criteria

1. `npm run backtest` runs an alpha strategy and a rule strategy end to end on the real data and saves each run.
2. All hand-worked fixtures pass; the Nifty control and random-picks checks come out sensibly.
3. The Backtests tab shows the list and a run's detail with curve, metrics and trades, verified in screenshots.
4. Every run's detail view shows the four caveats.
5. Tests, typecheck and lint pass.
