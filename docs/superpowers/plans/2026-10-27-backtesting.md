# Backtesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local `npm run backtest` command that simulates an alpha, screener-rule, hold or random strategy over the stored Nifty 200 history, saves one run to Supabase, and a read-only Backtests tab that shows saved runs against Nifty 50.

**Architecture:** Pure calc modules under `src/lib/calc/backtest/` (costs, engine, metrics, strategies); a job module `src/lib/jobs/backtest.ts` that loads history, runs the engine and builds the run; a thin `scripts/backtest.ts`; one new table behind three `Repo` methods; two server pages plus a few components. The engine hands a strategy only the last `lookback` rows ending on day t, so look-ahead is impossible by construction.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest, Tailwind 4, `lightweight-charts`, Supabase via the existing `Repo`, `tsx` for the script.

**Spec:** `docs/superpowers/specs/2026-10-27-backtesting-design.md`

## Global Constraints

- Branch: create `feat/backtesting` from the **current HEAD** (`feat/stage6b-shareholding`), not `main`.
- Order timing: a signal on the close of t is bought at the **open of t+1**; skipped if the stock has no open price that day.
- Defaults (per-run settings): starting capital **1,000,000** rupees; **K = 10** open positions; **H = 5** sessions; long-only; each new position about 1/K of current equity in whole shares; cash earns nothing; optional stop loss s percent below entry, checked against the day's low, filled at the open if the day gaps below the stop, else at the stop price.
- Costs on every fill: STT 0.1% both sides; exchange charge 0.00297% both sides; SEBI fee 0.0001% both sides; stamp duty 0.015% on buys only; GST 18% on exchange + SEBI charges; brokerage 0; DP charge 0; slippage 0.1% against the trader. Constants live in `costs.ts` with a comment that rates change and must be checked against the broker's current schedule.
- Benchmark: NIFTY50 buy-and-hold over the same dates, price only, no costs. Sharpe uses a risk-free rate of 0 and says so.
- Every run's detail view shows four caveats: survivorship bias; price only (no dividends); no circuit limits and no liquidity cap; tied alpha scores (alphas #1 and #54 only) with a stock-key tiebreak.
- Supabase: new table has row level security on and no policies, like the other tables. The migration is applied to the owner's Tracker1 project only after asking the owner.
- A failed run saves nothing. No new dependency. Read-only page: no delete, no "request run" button.
- Done means `npm run typecheck`, `npm run lint` and `npm test` pass. The app is dark-only: screenshots are dark, by static render (esbuild bundle + Tailwind CSS + headless Edge, as for the alpha cards), and the handover says the signed-in page was not seen.
- Match the surrounding code: comment density, naming, the `−` minus sign in formatted numbers, `Panel`, `Chip`, `Label`, `PctText`, `StockLink`.

## Review Focus

Inputs the spec implies but its own tests would not otherwise cover. Each has a test in the task named.

1. A strategy returns the same stock twice, or a stock already held: never bought twice. (Task 2)
2. Slot value is smaller than one share (capital 50, price 100): the order is skipped, cash never goes negative. (Task 2)
3. A held stock's data ends (delisting): closed at its last close on the next calendar date, flagged `delisted`. (Task 3)
4. A day gaps below the stop: filled at the open, not at the stop price. (Task 3)
5. A run with zero trades: metrics have no NaN, the saved row and the page do not crash. (Task 4 and Task 8)

---

### Task 1: Costs

**Files:**
- Create: `src/lib/calc/backtest/costs.ts`
- Test: `tests/calc/backtestCosts.test.ts`

**Interfaces:**
- Produces:
  - `type Side = "buy" | "sell"`
  - `interface CostModel { fill(side: Side, price: number): number; charges(side: Side, value: number): number }`
  - `const NSE_COSTS: CostModel` — `fill` applies 0.1% slippage (buy up, sell down); `charges` returns rupees for a trade of that notional value, all charge lines above.
  - `const ZERO_COSTS: CostModel` — `fill` returns the price, `charges` returns 0 (for hand-worked engine tests).

- [ ] **Step 1: Write the failing tests** in `tests/calc/backtestCosts.test.ts`: `NSE_COSTS.fill("buy", 100)` is `100.1` and `fill("sell", 100)` is `99.9` (`toBeCloseTo(…, 10)`). `charges("buy", 100000)` is `118.6226` and `charges("sell", 100000)` is `103.6226` (hand-worked: STT 100 + exchange 2.97 + SEBI 0.10 + stamp 15 (buy only) + GST 18% of 3.07 = 0.5526). `charges("buy", 0)` is `0`. `ZERO_COSTS` returns the price and `0`.
- [ ] **Step 2: Run** `npx vitest run tests/calc/backtestCosts.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `costs.ts` with the signatures above; rates as named constants with the "check against your broker's current schedule" comment.
- [ ] **Step 4: Run** the same test — expect PASS.
- [ ] **Step 5: Branch and commit.** `git switch -c feat/backtesting`, then `git add src/lib/calc/backtest/costs.ts tests/calc/backtestCosts.test.ts` and `git commit -m "feat(calc): NSE delivery costs for backtests"`.

### Task 2: Engine core

**Files:**
- Create: `src/lib/calc/backtest/strategy.ts` (types only in this task), `src/lib/calc/backtest/engine.ts`
- Test: `tests/calc/backtestEngine.test.ts`

**Interfaces:**
- Consumes: `CostModel`, `ZERO_COSTS`, `NSE_COSTS` (Task 1); `OhlcvDay` from `@/lib/db/types`.
- Produces in `strategy.ts`:
  - `interface StockSeries<D extends OhlcvDay = OhlcvDay> { key: string; name: string; days: D[] }`
  - `interface Strategy<D extends OhlcvDay = OhlcvDay> { id: string; label: string; params: Record<string, string | number>; lookback: number; pick(window: StockSeries<D>[], date: string, limit: number): string[] }` — `window` holds, per stock that has a row on `date`, only its last `lookback` rows ending on `date`; `pick` returns stock keys, highest priority first, at most `limit`.
- Produces in `engine.ts`:
  - `interface EngineSettings { capital: number; maxPositions: number; holdSessions: number; stopPct: number | null; costs: CostModel }`
  - `interface Trade { key: string; name: string; entryDate: string; exitDate: string; qty: number; entryPrice: number; exitPrice: number; pnl: number; pnlPct: number; costs: number; reason: "time" | "stop" | "end" | "delisted" }` — prices are fills (slippage included), `pnl` is after all costs, `pnlPct` is `pnl / (qty * entryPrice)`
  - `interface DayPoint { date: string; equity: number; invested: number }`
  - `interface EngineResult { days: DayPoint[]; trades: Trade[]; tradedValue: number }` — `tradedValue` is the sum of buy and sell notional.
  - `runEngine<D extends OhlcvDay>(stocks: StockSeries<D>[], calendar: string[], strategy: Strategy<D>, s: EngineSettings): EngineResult`
- Algorithm the tests do not fix (per calendar date, in this order): time exits at the open → stop checks (open gap, then the day's low) on survivors → fill the entries the strategy chose on the previous close, in priority order, up to the free slots, each sized at previous-close equity / K → stop check for the new entries on the same bar → mark to close (a stock with no bar today keeps its last close) → call `strategy.pick` with the windows ending today and `limit = maxPositions`. Final date: close every open position at its close, reason `end`. Held-sessions count is calendar sessions since the entry date. A pick that is already held, already queued, or repeated is dropped.

- [ ] **Step 1: Write the failing tests** in `tests/calc/backtestEngine.test.ts` with a helper that builds stocks from per-date opens (`close = open`, `high = open + 1`, `low = open − 1`) and a stub strategy that returns fixed keys on named dates. Use `ZERO_COSTS` unless stated. Calendar `d0..d7` (any ascending ISO dates), stock A opens `100 + i` on `d_i`:
  - **entry and time exit:** stub picks `["A"]` on `d1` only; settings capital 10000, K 1, H 3. Expect one trade: entry `d2` at 102, qty 98, exit `d5` at 105, reason `time`, pnl 294; final `days` equity 10294.
  - **K cap and priority:** stocks A and B, stub picks `["A", "B"]` on `d1`, K 1. Only A is bought.
  - **duplicates and held stocks (Review Focus 1):** K 2, stub picks `["A", "A"]` on `d1` then `["A"]` on `d2`. Exactly one buy of A.
  - **too small to buy (Review Focus 2):** capital 50, A at 100: no trade, every `equity` is 50, cash never negative.
  - **no bar on the entry day:** A has no row on `d2`: no trade at all (the order is dropped, not carried).
  - **no look-ahead:** a recording strategy with `lookback` 3 over 8 dates: on every call each window row has `date <= `the call date and each window has at most 3 rows.
  - **costs wired in:** the entry-and-exit scenario with `NSE_COSTS`: final cash equals `10000 − buyValue − charges("buy", buyValue) + sellValue − charges("sell", sellValue)` where values use `fill`; `tradedValue` equals `buyValue + sellValue`.
  - **end of test:** a position still open on the last date is closed at that close with reason `end`.
- [ ] **Step 2: Run** `npx vitest run tests/calc/backtestEngine.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `strategy.ts` types and `runEngine` in `engine.ts` per the algorithm above. Index each stock's rows by date once up front; build windows from a per-stock pointer so a day costs O(lookback), not O(history).
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `git add src/lib/calc/backtest/strategy.ts src/lib/calc/backtest/engine.ts tests/calc/backtestEngine.test.ts` and `git commit -m "feat(calc): backtest engine core"`.

### Task 3: Engine stops, gaps and delisting

**Files:**
- Modify: `src/lib/calc/backtest/engine.ts`
- Test: `tests/calc/backtestEngine.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2's `runEngine` and `EngineSettings.stopPct`.
- Produces: nothing new in the types; behaviour for `stopPct`, missing exit-day bars and ended data.

- [ ] **Step 1: Write the failing tests** (same helper; entry at `d2` open 102, qty 98 as before, `stopPct` 5, stop price 96.9, H large):
  - **intraday stop:** `d3` open 100, low 96: exit at 96.9, reason `stop`, pnl `98 * (96.9 − 102)` (`toBeCloseTo(−499.8, 6)`).
  - **gap below the stop (Review Focus 4):** `d3` open 90, low 89: exit at the open 90, pnl −1176.
  - **no stop when the low stays above it:** `d3` low 97: the position stays open.
  - **stop on the entry bar:** the entry day's own low at 96: exit that day at 96.9.
  - **missing exit day:** H 3, A has no row on `d5` but has one on `d6`: exit at the `d6` open, reason `time`.
  - **delisting (Review Focus 3):** A's rows end at `d4` while held, calendar continues to `d7`: the trade exits on `d5` at the `d4` close, reason `delisted`, and later days keep the equity flat (no further marks on A).
- [ ] **Step 2: Run** `npx vitest run tests/calc/backtestEngine.test.ts` — expect the new tests FAIL.
- [ ] **Step 3: Implement** the stop, missing-bar and ended-data handling in `runEngine`.
- [ ] **Step 4: Run** the file — expect all engine tests PASS.
- [ ] **Step 5: Commit** `git add src/lib/calc/backtest/engine.ts tests/calc/backtestEngine.test.ts` and `git commit -m "feat(calc): backtest stops, gaps and delisting"`.

### Task 4: Metrics

**Files:**
- Create: `src/lib/calc/backtest/metrics.ts`
- Test: `tests/calc/backtestMetrics.test.ts`

**Interfaces:**
- Consumes: `Trade`, `DayPoint` (Task 2).
- Produces:
  - `interface Metrics { totalReturn: number; cagr: number; maxDrawdown: number; volatility: number; sharpe: number | null; hitRate: number | null; avgWinPct: number | null; avgLossPct: number | null; trades: number; turnoverPerYear: number | null; timeInvested: number | null }` — fractions, not percents; `maxDrawdown` is negative or 0; `sharpe` is annualised with a risk-free rate of 0, `null` when daily volatility is 0.
  - `computeMetrics(days: { date: string; equity: number; invested?: number }[], trades?: Trade[], tradedValue?: number): Metrics`
- Definitions: years = calendar days between first and last date / 365.25; `cagr = (end / start) ** (1 / years) − 1`; daily returns from consecutive equity; `volatility` and `sharpe` use the sample standard deviation × √252; `turnoverPerYear = tradedValue / years / average equity`; `timeInvested` = mean of `invested / equity`; trade metrics are `null` (and `trades` 0) when there are no trades or no `trades` argument.

- [ ] **Step 1: Write the failing tests:** equity `[100, 110, 99, 121]` on consecutive dates: `totalReturn` 0.21, `maxDrawdown` −0.1, `sharpe` `toBeCloseTo(7.229, 2)`. Two points `2025-01-01` → `2026-01-01` with equity 100 → 121: `cagr` equals `1.21 ** (365.25 / 365) − 1`. Flat equity: `sharpe` is `null`, `volatility` 0, `maxDrawdown` 0. Three trades with pnl `[100, −50, 25]` and `pnlPct` `[0.1, −0.05, 0.02]`: `hitRate` 2/3, `avgWinPct` 0.06, `avgLossPct` −0.05. **Zero trades (Review Focus 5):** `trades: []` gives `hitRate`, `avgWinPct`, `avgLossPct` `null` and `trades` 0, and `JSON.stringify` of the result has no `null` where a number is required and no `NaN`.
- [ ] **Step 2: Run** `npx vitest run tests/calc/backtestMetrics.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `computeMetrics` per the definitions.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `git add src/lib/calc/backtest/metrics.ts tests/calc/backtestMetrics.test.ts` and `git commit -m "feat(calc): backtest metrics"`.

### Task 5: Strategies

**Files:**
- Modify: `src/lib/calc/backtest/strategy.ts` (add the built-ins)
- Test: `tests/calc/backtestStrategies.test.ts`

**Interfaces:**
- Consumes: `Strategy`, `StockSeries` (Task 2); `runAlphas`, `ALPHAS`, `AlphaId` from `@/lib/calc/alpha/*`; `runScreeners`, `ScreenerId` from `@/lib/calc/screeners`; `StoredDay`.
- Produces:
  - `alphaStrategy(alpha: AlphaId, top: number): Strategy` — `lookback` 30; `pick` returns `runAlphas(window, date, top)`'s result for that alpha, `top` keys, highest score first.
  - `type RuleId = "vol_up" | "vol_down" | "breakout" | "breakdown" | "golden" | "death" | "rsi_high" | "rsi_low"` and `const RULE_IDS: RuleId[]`
  - `ruleStrategy(rule: RuleId): Strategy<StoredDay>` — `lookback` 6; `pick` returns the keys of `runScreeners(window, date, 1000)`'s result with that id, in its own order.
  - `holdStrategy(key: string): Strategy` — `lookback` 1; returns `[key]` when the window holds that stock, else `[]`.
  - `randomStrategy(seed: number): Strategy` — `lookback` 1; a deterministic seeded shuffle of the window's keys (same seed and date give the same picks; different dates differ); a small inline PRNG (mulberry32), no dependency.
  - Each strategy's `id`, `label` and `params` describe it (for example `id "alpha:a101"`, `params { alpha: "a101", top: 10 }`).

- [ ] **Step 1: Write the failing tests:** `alphaStrategy("a101", 2).pick` over three stocks with last bars `{o 10, h 12, l 8, c 11}`, `{o 10, h 12, l 8, c 9}`, `{o 10, h 10, l 10, c 10.5}` returns the keys ordered by `(c−o)/(h−l+0.001)`: the flat-range stock first (`0.5/0.001`), then the first, and limits to 2; the strategy's `lookback` is 30. `ruleStrategy("golden").pick` over two stocks whose `ema50` crosses above `ema200` within the last 5 rows for one and not the other returns only the crossing one (build rows like `tests/calc/screeners.test.ts`). `ruleStrategy("rsi_low").pick` returns oversold stocks lowest RSI first. `holdStrategy("X")` returns `["X"]` / `[]`. `randomStrategy(1)` returns identical picks for identical inputs, differs between seeds on 20 stocks, and never returns more than `limit` keys. `RULE_IDS` has the eight ids and none starting with `score`.
- [ ] **Step 2: Run** `npx vitest run tests/calc/backtestStrategies.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the five factories in `strategy.ts`.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `git add src/lib/calc/backtest/strategy.ts tests/calc/backtestStrategies.test.ts` and `git commit -m "feat(calc): backtest strategies"`.

### Task 6: Storage

**Files:**
- Create: `supabase/migrations/0010_backtest_runs.sql`
- Modify: `src/lib/db/types.ts`, `src/lib/db/repo.ts`, `src/lib/db/memoryRepo.ts`, `src/lib/db/supabaseRepo.ts`
- Test: `tests/db/memoryRepo.test.ts` (extend), `tests/db/supabaseRepo.paging.test.ts` (extend)

**Interfaces:**
- Consumes: `Metrics` (Task 4), `Trade` (Task 2).
- Produces in `types.ts`:
  - `interface BacktestRunInput { name: string; strategy: { id: string; label: string; params: Record<string, string | number> }; settings: { capital: number; maxPositions: number; holdSessions: number; stopPct: number | null; from: string; to: string }; metrics: { strategy: Metrics; benchmark: Metrics }; equity: [string, number, number][]; trades: Trade[]; dataThrough: string; universeNote: string }` — `equity` rows are `[date, strategy, benchmark]`, both starting at `capital`
  - `interface BacktestRunSummary { id: number; createdAt: string; name: string; strategy: BacktestRunInput["strategy"]; settings: BacktestRunInput["settings"]; metrics: BacktestRunInput["metrics"]; dataThrough: string }`
  - `interface BacktestRun extends BacktestRunSummary { equity: BacktestRunInput["equity"]; trades: Trade[]; universeNote: string }`
- Produces in `Repo`: `saveBacktestRun(run: BacktestRunInput): Promise<number>` (the new id), `listBacktestRuns(): Promise<BacktestRunSummary[]>` (newest first, without `equity`, `trades`, `universeNote`), `getBacktestRun(id: number): Promise<BacktestRun | null>`.
- Migration: table `backtest_runs` with `id bigserial primary key`, `created_at timestamptz not null default now()`, `name text not null`, `strategy jsonb not null`, `settings jsonb not null`, `metrics jsonb not null`, `equity jsonb not null`, `trades jsonb not null`, `data_through date not null`, `universe_note text not null`, and `alter table backtest_runs enable row level security;` with no policies (same shape as `0008_shareholding.sql`).

- [ ] **Step 1: Write the failing tests.** Memory repo: `saveBacktestRun` returns ids 1 then 2; `listBacktestRuns` returns newest first with the summary fields only (`Object.keys` has no `equity` or `trades`); `getBacktestRun(2)` returns the full row; `getBacktestRun(99)` is `null`. Supabase fake (like `getOhlcvRange`'s): `saveBacktestRun` inserts snake_case columns into `backtest_runs` and returns the id from the response; `listBacktestRuns` selects only `id,created_at,name,strategy,settings,metrics,data_through` and maps to camelCase; `getBacktestRun` maps all columns and returns `null` for no row.
- [ ] **Step 2: Run** `npx vitest run tests/db` — expect FAIL.
- [ ] **Step 3: Implement** the types, the `Repo` methods in both repos, and the migration file.
- [ ] **Step 4: Run** `npx vitest run tests/db` then `npm run typecheck` — expect PASS and no errors.
- [ ] **Step 5: Commit** `git add supabase/migrations/0010_backtest_runs.sql src/lib/db tests/db` and `git commit -m "feat(db): backtest runs table and repo methods"`.

### Task 7: History loading, run builder and command

**Files:**
- Create: `src/lib/jobs/backtest.ts`, `scripts/backtest.ts`
- Modify: `package.json` (add `"backtest": "tsx scripts/backtest.ts"`)
- Test: `tests/jobs/backtest.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 6; `Repo.listConstituents("NIFTY200")`, `Repo.getInstrumentByKey`, `Repo.getOhlcvRange`, `Repo.getDaysRange`.
- Produces in `src/lib/jobs/backtest.ts`:
  - `type StrategySpec = { kind: "alpha"; alpha: AlphaId; top: number } | { kind: "rule"; rule: RuleId } | { kind: "hold"; key: string } | { kind: "random"; seed: number }`
  - `interface BacktestOptions { spec: StrategySpec; name: string; from: string; maxPositions: number; holdSessions: number; stopPct: number | null; capital: number; dryRun: boolean }`
  - `parseBacktestArgs(argv: string[]): BacktestOptions` — argv is what follows `npm run backtest --`: `alpha --alpha a101 --top 10`, `rule --rule golden`, `hold --key NIFTY50`, `random --seed 1`, with `--hold` (default 5), `--stop`, `--from` (default `2020-01-01`), `--max-positions` (default 10), `--capital` (default 1000000), `--name`, `--dry-run`. Throws an `Error` with a readable message for an unknown kind, unknown alpha or rule id, a missing required flag, or a non-numeric value. `--name` defaults to a label built from the strategy.
  - `loadHistory<D extends OhlcvDay>(repo: Repo, ids: number[], from: string, to: string, wide: boolean): Promise<Map<number, D[]>>` — chunks of 10 ids, five chunks in flight at a time, `getDaysRange` when `wide` else `getOhlcvRange`.
  - `interface DataReport { stocks: number; firstDate: string | null; lastDate: string | null; bigMoves: { key: string; date: string; pct: number }[]; scoreCoverage: number | null }` and `dataReport(stocks: StockSeries<StoredDay>[]): DataReport` — `bigMoves` lists daily close-to-close moves of at least 35% in either direction (a sign of unadjusted splits); `scoreCoverage` is the share of rows with a non-null `score`, `null` for OHLCV-only rows.
  - `runBacktest(repo: Repo, opts: BacktestOptions): Promise<{ run: BacktestRunInput; report: DataReport; tradedValue: number }>` — loads the NIFTY200 constituents (or the one instrument for `hold`), loads NIFTY50 for the calendar and benchmark, runs the engine with `NSE_COSTS`, builds the run (equity rebased to `capital`, benchmark from NIFTY50 closes, `universeNote` = "Today's Nifty 200 members only (survivorship bias)"), and returns it. It throws, saving nothing, when the calendar has fewer than 60 sessions. It does not save; the script does.
- The script (`scripts/backtest.ts`): `process.loadEnvFile(".env.local")`, parse, run, print the data report, the metrics table (strategy vs Nifty 50) and the caveats; unless `dryRun`, call `saveBacktestRun` and print the id. Any error prints its message and exits 1, with nothing saved.

- [ ] **Step 1: Write the failing tests** in `tests/jobs/backtest.test.ts` on a memory repo with NIFTY50 and 12 stocks over 80 sessions: `parseBacktestArgs` defaults, each kind, and each error message (`["alpha", "--alpha", "zzz"]` throws naming the valid ids; `["rule"]` throws "needs --rule"; `["rule", "--rule", "score_top"]` throws). `loadHistory` over 25 ids returns every id's rows in ascending date order for both `wide` modes and calls the repo in chunks of at most 10 ids. `dataReport` flags a −50% day and not a +20% day, and reports score coverage 0.5 when half the rows have a score. `runBacktest` with `hold` on `NIFTY50` returns a run whose `equity` starts at `capital` for both lines and whose `settings.from`/`to` match the calendar; with an alpha spec it returns `trades` and metrics; with a calendar under 60 sessions it rejects with a readable message; a strategy whose `pick` throws makes `runBacktest` reject and `saveBacktestRun` is never called by the script path (spy on the repo).
- [ ] **Step 2: Run** `npx vitest run tests/jobs/backtest.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `src/lib/jobs/backtest.ts`, then the thin `scripts/backtest.ts` and the `package.json` script.
- [ ] **Step 4: Run** `npx vitest run tests/jobs` then `npm run typecheck` — expect PASS and no errors. Then `npm run backtest -- alpha --alpha a101 --top 10 --dry-run` against the real database — expect the data report, a metrics table and exit 0, nothing saved; note the run time and the data report numbers.
- [ ] **Step 5: Commit** `git add src/lib/jobs/backtest.ts scripts/backtest.ts package.json tests/jobs/backtest.test.ts` and `git commit -m "feat: backtest command, history loading and run builder"`.

### Task 8: Backtests tab

**Files:**
- Create: `src/lib/view/backtests.ts`, `src/app/(app)/backtests/page.tsx`, `src/app/(app)/backtests/[id]/page.tsx`, `src/app/components/backtests/RunList.tsx`, `src/app/components/backtests/RunDetail.tsx`, `src/app/components/backtests/EquityCurve.tsx`
- Modify: `src/lib/view/shell.ts` (add `{ href: "/backtests", label: "Backtests" }` to `TABS`, after Market), `tests/view/shell.test.ts` (tab order)
- Test: `tests/view/backtests.test.ts`

**Interfaces:**
- Consumes: `BacktestRunSummary`, `BacktestRun`, `Metrics`, `Trade`; `getRepo`; `Panel`, `Chip`, `Label`, `PctText`, `StockLink`; `lightweight-charts` as `PriceChart.tsx` uses it.
- Produces in `src/lib/view/backtests.ts`:
  - `fmtFrac(v: number | null): string` — a fraction as a signed one-decimal percent with `−` (`0.123` → `+12.3%`, `−0.05` → `−5.0%`, `null` → `—`)
  - `fmtRatio(v: number | null): string` — two decimals or `—`
  - `rebase100(equity: [string, number, number][]): { time: string; strategy: number; benchmark: number }[]` — both lines scaled so the first point is 100
  - `caveats(strategyId: string): string[]` — the three standing caveats, plus the tie note when `strategyId` is `alpha:a001` or `alpha:a054`
- Behaviour: the list page calls `listBacktestRuns()` and renders `RunList`: newest first; name, strategy label, period, CAGR, max drawdown, Sharpe, Nifty 50's CAGR; each row links to `/backtests/<id>`; an empty list says "No runs yet. Run `npm run backtest` on your PC." The detail page parses `id` (a non-numeric id or a missing run calls `notFound()`), loads `getBacktestRun`, and renders: caveats and `universeNote` at the top; metric cards, strategy vs Nifty 50; `EquityCurve` (two `LineSeries`, rebased to 100, colours from the CSS variables); a trade table, newest first, collapsed to 10 rows with "Show all N" (`StockLink` names, entry and exit dates, prices, P/L %, reason). A zero-trade run renders its cards with `—` and "No trades in this run." A run whose row fails a shape check shows "Can't display this run" in place of the detail, without throwing.

- [ ] **Step 1: Write the failing tests** in `tests/view/backtests.test.ts`: `fmtFrac(0.123)` is `"+12.3%"`, `fmtFrac(-0.05)` is `"−5.0%"`, `fmtFrac(null)` is `"—"`; `fmtRatio(1.234)` is `"1.23"`, `fmtRatio(null)` is `"—"`; `rebase100([["d1", 1000000, 1000000], ["d2", 1100000, 990000]])` gives `[{time:"d1",strategy:100,benchmark:100},{time:"d2",strategy:110,benchmark:99}]`; `caveats("alpha:a101")` has three entries and `caveats("alpha:a054")` four. In `tests/view/shell.test.ts` the tab order becomes `[..., "Market", "Backtests", "Alerts"]` and `activeTab("/backtests/3")` is `"/backtests"`.
- [ ] **Step 2: Run** `npx vitest run tests/view` — expect FAIL.
- [ ] **Step 3: Implement** the view helpers and the tab, then the pages and components.
- [ ] **Step 4: Run** `npm run typecheck`, `npm run lint` and `npx vitest run` — expect all clean.
- [ ] **Step 5: Look at it.** Render `RunList` and `RunDetail` with a realistic sample run (built from a `--dry-run` result written to a scratch JSON, plus a zero-trade run and the empty list) by static render at 1280 and 390 px, dark, as for the alpha cards (esbuild bundle with `next/navigation` stubbed, Tailwind CSS compiled with `@tailwindcss/postcss`, headless Edge). Read the screenshots: curve readable, cards aligned, trade table not overflowing at 390 px, caveats visible. Delete the scratch bundle before committing so lint stays clean.
- [ ] **Step 6: Commit** `git add src/lib/view src/app tests/view` and `git commit -m "feat(ui): Backtests tab"`.

### Task 9: Real-data checks and docs

**Files:**
- Modify: `README.md` (a "Backtests" section), `NOTES.md` (a session entry)

**Interfaces:** consumes the command (Task 7); produces nothing for other tasks.

- [ ] **Step 1: Control and random checks, dry runs on the real database.** `npm run backtest -- hold --key NIFTY50 --max-positions 1 --hold 100000 --dry-run`: the strategy's total return must be within 2 percentage points of the benchmark's. `npm run backtest -- random --seed 1 --dry-run`, then seeds 2 and 3: each CAGR minus the benchmark CAGR must be under 5 percentage points. If either tripwire fires, stop and debug (superpowers:systematic-debugging): a random strategy that beats the index by a wide margin means a look-ahead or sizing bug.
- [ ] **Step 2: Data report.** Read the report from step 1: note the stock count, date range, any `bigMoves` (suspected unadjusted splits) and the score coverage. If `bigMoves` is non-empty, say so in the handover and in `NOTES.md`; if `scoreCoverage` is low or `null`, the score rules stay excluded (they already are).
- [ ] **Step 3: Docs.** Add the "Backtests" section to `README.md`: what a run is, the command and its flags, that the migration `0010` must be applied first, what each caveat means, and that results are local-run, site-read-only. Add a `NOTES.md` session entry: what was built, the control and random numbers from step 1, the data-report findings, the load time of a run, and that the migration is not applied until the owner says so. Tell the owner the migration still needs applying before a run can be saved; do not apply it.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` — expect all clean.
- [ ] **Step 5: Commit** `git add README.md NOTES.md` and `git commit -m "docs: backtests"`.
