# Factor Alpha Screeners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show six Alpha101-style cross-sectional rank cards plus one combined "Alpha rank" card on the Market tab, computed from stored Nifty 200 candles.

**Architecture:** Pure TypeScript calc modules under `src/lib/calc/alpha/` (operators, six alphas, a runner) work on stock × date matrices. `loadMarket` widens its candle window to 30 sessions and adds `alphas` to `MarketData`. A new `AlphaGrid` component renders them under the existing Screeners panel. No schema change.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest, Tailwind 4, Supabase (via the existing `Repo`).

**Spec:** `docs/superpowers/specs/2026-10-27-factor-alpha-screeners-design.md`

## Global Constraints

- Branch: create `feat/alpha-screeners` from the **current HEAD** (`feat/stage6b-shareholding`), not from `main`. `main` lacks the stage 6b Market code this builds on, and the spec and plan are committed here.
- Window: 30 sessions. Per alpha: top 10 and bottom 10 stocks. Combined card: a stock needs at least 3 of the 6 alphas (half) to be included.
- Inputs are OHLCV only. No VWAP, industry or market-cap alphas.
- Cards say "ranked by alpha", never buy or sell, and cite Kakushadze (2015), arXiv:1601.00991. Each alpha module comment keeps the arXiv citation. Write the code from the formulas; do not copy Vibe-Trading's code.
- No schema change, no new dependency, no live trading, no Claude API calls from the app.
- Market tab may be at most about 1 s slower than before.
- Done means `npm run typecheck`, `npm run lint` and `npm test` pass, and light and dark screenshots of the Market tab were looked at (project memory: verify UI in a browser).
- Match the surrounding code: comment density, naming, the `−` minus sign in formatted numbers, `StockLink`, `PctText`, `Chip`, `Panel`, `Label`.

## Review Focus

Inputs the spec implies but its own tests would not otherwise cover. Each has a test in the task named.

1. Fewer than 20 stocks have a score: top and bottom lists would overlap. The bottom list must exclude stocks already in the top list. (Task 3)
2. A stock with one missing bar inside the 30-session window, for example a halt: it is dropped from every alpha that needs that bar. It is not scored as zero and does not crash the run. (Task 3)
3. Flat day (high = low) for alpha 54, and zero volume for alpha 2 (`log(0)`): the stock gets no score, not Infinity. (Task 1 and Task 2)
4. One alpha throws: only its card shows "unavailable today"; the other cards and the screeners render. (Task 3 and Task 5)
5. Nifty has fewer than 30 priced sessions (a young database): the window is shorter, alphas that need more bars score nobody, and the page still renders. (Task 4)

---

### Task 1: Operator library

**Files:**
- Create: `src/lib/calc/alpha/ops.ts`
- Test: `tests/calc/alphaOps.test.ts`

**Interfaces:**
- Produces (all pure, all return a new matrix with the same shape):
  - `type Matrix = number[][]` — `m[stock][t]`, oldest to newest, `NaN` means missing.
  - `delta(m: Matrix, d: number): Matrix` — `x[t] − x[t−d]`
  - `returns(m: Matrix): Matrix` — `x[t]/x[t−1] − 1`
  - `stddev(m: Matrix, w: number): Matrix` — rolling **sample** standard deviation (n−1), matches pandas
  - `correlation(a: Matrix, b: Matrix, w: number): Matrix` — rolling Pearson over the last `w` values
  - `tsArgmax(m: Matrix, w: number): Matrix` — 0-based position of the maximum inside the window, earliest on ties
  - `csRank(m: Matrix): Matrix` — per column (date), across stocks: average rank for ties, divided by the count of non-NaN values, so results fall in (0, 1]
  - `signedPower(m: Matrix, p: number): Matrix`, `sign(m: Matrix): Matrix`, `log(m: Matrix): Matrix` (NaN when x ≤ 0)
  - `map2(a: Matrix, b: Matrix, f: (x: number, y: number) => number): Matrix`, `map1(m: Matrix, f: (x: number) => number): Matrix`
- Rule for every rolling op: any `NaN` in the window gives `NaN`, and the first `w−1` (or `d`) columns are `NaN`. Any non-finite result is returned as `NaN`.

- [ ] **Step 1: Write the failing tests** in `tests/calc/alphaOps.test.ts`: `delta` of `[[1,3,6]]` by 1 is `[[NaN,2,3]]`; `returns` of `[[100,110]]` is `[[NaN,0.1]]`; `stddev([[1,2,3]], 3)` last value is `1` (sample); `correlation` of two perfectly rising series is `1` and of one rising, one falling is `−1`; a `NaN` inside the window gives `NaN`; `tsArgmax([[1,5,5,2]], 3)` is `[NaN,NaN,1,1]` (earliest of the tied maximum); `csRank` of one column `[10,20,20,NaN]` gives `[1/3, 2.5/3, 2.5/3, NaN]`; `log` of `0` and of a negative is `NaN`; `signedPower([[-2]], 2)` is `[[-4]]`; `sign` of `-3, 0, 5` is `-1, 0, 1`.
- [ ] **Step 2: Run** `npx vitest run tests/calc/alphaOps.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above in `src/lib/calc/alpha/ops.ts`. Use plain loops over `number[]`; no library.
- [ ] **Step 4: Run** `npx vitest run tests/calc/alphaOps.test.ts` — expect PASS.
- [ ] **Step 5: Branch and commit.** Run `git switch -c feat/alpha-screeners`, then `git add src/lib/calc/alpha/ops.ts tests/calc/alphaOps.test.ts` and `git commit -m "feat(calc): alpha operator library"`.

### Task 2: Six alphas

**Files:**
- Create: `src/lib/calc/alpha/alphas.ts`
- Test: `tests/calc/alphas.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `interface Panel { open: Matrix; high: Matrix; low: Matrix; close: Matrix; volume: Matrix }` (all the same shape, stock × date).
  - `type AlphaId = "a001" | "a002" | "a006" | "a012" | "a054" | "a101"`
  - `interface AlphaDef { id: AlphaId; title: string; theme: string; paperNo: number; minBars: number; compute(p: Panel): number[] }` — `compute` returns one value per stock for the **last** column; `NaN` when it cannot be scored.
  - `const ALPHAS: AlphaDef[]` in the order a001, a002, a006, a012, a054, a101.

- [ ] **Step 1: Verify each formula against the sources before coding it.** For each of the six, open the paper (arXiv:1601.00991) and the matching file `agent/src/factors/zoo/alpha101/alpha_NNN.py` in HKUDS/Vibe-Trading, and write the confirmed formula into that alpha's comment. The candidates below were recalled from memory, except #1, which was read from the repo:
  - #1: `rank(ts_argmax(signedpower((returns<0 ? stddev(returns,20) : close), 2), 5)) − 0.5`, minBars 25 (confirmed)
  - #2: `−1 · correlation(rank(delta(log(volume),2)), rank((close−open)/open), 6)`
  - #6: `−1 · correlation(open, volume, 10)`
  - #12: `sign(delta(volume,1)) · (−1 · delta(close,1))`
  - #54: `(−1 · (low−close) · open^5) / ((low−high) · close^5)`
  - #101: `(close−open) / ((high−low) + 0.001)`

  If one does not match, or turns out to need VWAP, industry or market cap, replace it with another OHLCV-only alpha from the same file set and update `ALPHAS`, this task and the spec's table. Set `minBars` from the repo file's `min_warmup_bars` where it exists.
- [ ] **Step 2: Write the failing tests** in `tests/calc/alphas.test.ts`: `ALPHAS.map(a => a.id)` equals the six ids in order. For each alpha, a 5-stock fixture built by a small `panel()` helper with the expected last-column values worked out by hand in the test comments. Plus: a stock with fewer than `minBars` bars gets `NaN`; #54 for a stock with `high === low` on the last day is `NaN`; #2 for a stock with `volume === 0` inside its window is `NaN`.
- [ ] **Step 3: Run** `npx vitest run tests/calc/alphas.test.ts` — expect FAIL.
- [ ] **Step 4: Implement** `ALPHAS` in `src/lib/calc/alpha/alphas.ts`, composing the Task 1 operators. Each alpha's comment carries the paper number and the arXiv citation. Return `NaN` for any stock whose last-column value is non-finite.
- [ ] **Step 5: Run** the same test — expect PASS.
- [ ] **Step 6 (optional, ask the owner first):** in a scratch folder, run Vibe-Trading's Python for the same fixture and compare the numbers. Not a dependency, nothing committed.
- [ ] **Step 7: Commit** `git add src/lib/calc/alpha/alphas.ts tests/calc/alphas.test.ts` and `git commit -m "feat(calc): six Alpha101 alphas"`.

### Task 3: Runner and combined rank

**Files:**
- Create: `src/lib/calc/alpha/run.ts`
- Test: `tests/calc/alphaRun.test.ts`

**Interfaces:**
- Consumes: `ALPHAS`, `Panel` (Task 2), `csRank`, `Matrix` (Task 1), `StoredDay` from `@/lib/db/types`.
- Produces:
  - `const ALPHA_WINDOW = 30`
  - `interface AlphaHit { key: string; name: string; close: number; dayPct: number | null; score: number }` — `score` is the raw alpha value, or for the combined card the mean rank in (0, 1]
  - `interface AlphaResult { id: AlphaId | "combined"; title: string; status: "ok" | "unavailable"; count: number; top: AlphaHit[]; bottom: AlphaHit[] }` — `count` is the number of stocks scored
  - `runAlphas(stocks: { key: string; name: string; days: StoredDay[] }[], session: string, limit?: number): AlphaResult[]` — `limit` defaults to 10. Returns **seven** results: `combined` first, then the six in `ALPHAS` order.
- Behaviour: only stocks whose last row is `session` and whose `close` is not null qualify (same rule as `runScreeners`). The date axis is the last 30 distinct dates up to `session` across qualifying stocks; a stock missing a date gets `NaN` there. `dayPct` is `pctChange ?? importedPct` of the session row. `top` is the highest scores, `bottom` the lowest, and `bottom` excludes stocks already in `top`. Combined score is the mean of the stock's `csRank` across the alphas that scored it; stocks with fewer than 3 are excluded. An alpha whose `compute` throws is logged with `console.error` and returned with `status: "unavailable"`, empty lists and `count: 0`; the rest still run.

- [ ] **Step 1: Write the failing tests** in `tests/calc/alphaRun.test.ts` (reuse the `day()` helper style from `tests/calc/screeners.test.ts`): result order and ids; a stock not priced on `session` is excluded; a stock with one missing bar in the window is scored by no alpha that needs it and does not break others (Review Focus 2); 6 qualifying stocks with `limit` 10 gives `top` and `bottom` with no stock in both (Review Focus 1); `count` matches scored stocks; combined excludes a stock scored by only 2 alphas and ranks the rest by mean rank; `vi.spyOn(ALPHAS[0], "compute").mockImplementation(() => { throw new Error("boom") })` gives that result `status: "unavailable"` and the other six still `ok` (Review Focus 4).
- [ ] **Step 2: Run** `npx vitest run tests/calc/alphaRun.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `runAlphas` in `src/lib/calc/alpha/run.ts`: build the `Panel` matrices from the aligned dates, call each `compute`, sort by score with the stock `key` as tiebreak (as `compare` in `calc/screeners.ts` does), then build the combined result.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `git add src/lib/calc/alpha/run.ts tests/calc/alphaRun.test.ts` and `git commit -m "feat(calc): run alphas and combined rank"`.

### Task 4: Wire into `loadMarket`

**Files:**
- Modify: `src/lib/api/market.ts` (the `MarketData` interface, the early returns, `getDays(nifty.id, 12)`, `.slice(-6)`, and the final return)
- Test: `tests/api/market.test.ts`

**Interfaces:**
- Consumes: `runAlphas`, `AlphaResult`, `ALPHA_WINDOW` (Task 3).
- Produces: `MarketData.alphas: AlphaResult[]` — `[]` when there is no universe, no session or no priced rows; otherwise `runAlphas(stocks, session)`.
- Window change: Nifty `getDays` asks for 40 rows and keeps the last `ALPHA_WINDOW` priced ones up to `session`. `runScreeners` and `runWatchSignals` slice their own windows (`WINDOW = 6`), so their results do not change.

- [ ] **Step 1: Measure the baseline first, before any edit.** Write a throwaway script in the scratchpad folder that loads `.env.local` with `process.loadEnvFile` (as `scripts/*.ts` do), calls `loadMarket(getRepo(), …)` five times and prints the median time and the row count `getDaysRange` returned. Run it with `npx tsx` and write the numbers down. Do not commit it.
- [ ] **Step 2: Update the existing tests and add new ones** in `tests/api/market.test.ts`: the empty-result `toEqual` gains `alphas: []`; the `getDaysRange` call assertion that expects `"2026-01-02"` becomes `"2026-01-01"` (the 7-date fixture now fits entirely in the window); add one test that `m.alphas` is `[]` with no constituents, and one that with the fixture's 7 sessions `m.alphas` has 7 entries and the alphas needing more than 7 bars have `count: 0` (Review Focus 5). Run `npx vitest run tests/api/market.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the `MarketData` field, the window change and the `runAlphas` call in `src/lib/api/market.ts`. Both early `return`s that build a `MarketData` object get `alphas: []`.
- [ ] **Step 4: Run** `npx vitest run tests/api tests/calc` — expect PASS, then `npm run typecheck` — expect no errors.
- [ ] **Step 5: Re-run the Step 1 script** and compare. If the median is more than about 1 s slower, stop and tell the owner: the spec's fallback is to precompute in the EOD job.
- [ ] **Step 6: Commit** `git add src/lib/api/market.ts tests/api/market.test.ts` and `git commit -m "feat(api): load alphas with the market data"`.

### Task 5: Alpha cards on the Market tab

**Files:**
- Create: `src/app/components/market/AlphaGrid.tsx`
- Modify: `src/lib/view/market.ts` (add `fmtAlphaScore`), `src/app/(app)/market/page.tsx` (render `AlphaGrid` after `ScreenerGrid`), `README.md` (Market section), `NOTES.md` (short status entry)
- Test: `tests/view/market.test.ts` (extend the existing file if present, otherwise create it)

**Interfaces:**
- Consumes: `AlphaResult`, `AlphaHit` (Task 3), `MarketData.alphas` (Task 4), `COLLAPSED_ROWS` from `@/lib/view/market`.
- Produces:
  - `fmtAlphaScore(id: AlphaResult["id"], score: number): string` — for `"combined"`, `Math.round(score * 100)` as text; otherwise the value to 3 significant digits, with `−` (U+2212) for negatives, matching `signedPct1` in the same file.
  - `AlphaGrid({ alphas, session, hasUniverse }: { alphas: AlphaResult[]; session: string | null; hasUniverse: boolean })` — client component.
- Behaviour: returns `null` when `!hasUniverse` or `alphas.length === 0`. A `Panel` titled "ALPHA RANKS · NIFTY 200" with `as of` label like `ScreenerGrid`. One card per result, `combined` first, laid out like `ScreenerCard` (same border and padding classes). Each card has a "Highest" list and a "Lowest" list (rows: `StockLink` name, `fmtAlphaScore`, `PctText` day %), each collapsed to `COLLAPSED_ROWS` with a "Show all" toggle. `status: "unavailable"` shows "unavailable today"; `count: 0` shows "Not enough history yet". A footer line: "Ranked by alpha, not a buy or sell call. Source: Kakushadze (2015), arXiv:1601.00991."

- [ ] **Step 1: Write the failing tests** for `fmtAlphaScore`: `("combined", 0.874)` is `"87"`; `("a012", -0.0123456)` is `"−0.0123"`; `("a054", 12345.6)` is `"1.23e+4"` (3 significant digits, as `toPrecision(3)` gives); `("a101", 0.5)` is `"0.500"`. Run `npx vitest run tests/view` — expect FAIL.
- [ ] **Step 2: Implement** `fmtAlphaScore`, run the test — expect PASS.
- [ ] **Step 3: Implement** `AlphaGrid.tsx` and render it in `page.tsx` between `ScreenerGrid` and `StakeScreeners`.
- [ ] **Step 4: Run** `npm run typecheck`, `npm run lint`, `npm test` — expect all clean.
- [ ] **Step 5: Look at it in a browser, light and dark.** Start `npm run dev` and screenshot `/market` at desktop width and at 390 px in both themes. If sign-in blocks the page, use the static-render approach `NOTES.md` describes for earlier stages, and say plainly in the handover what was and was not seen signed in. Check the combined card first, a collapsed and an expanded list, the unavailable and not-enough-history states (temporarily force one in a scratch edit and revert it), and the footer text.
- [ ] **Step 6: Docs.** Add an "Alpha ranks" paragraph to the README Market section (what the cards are, short-horizon, the source paper, how to read them) and a status entry to `NOTES.md`, including the measured load-time change from Task 4 and the "precompute in EOD if slow" fallback.
- [ ] **Step 7: Commit** `git add src/app/components/market/AlphaGrid.tsx src/lib/view/market.ts "src/app/(app)/market/page.tsx" tests/view README.md NOTES.md` and `git commit -m "feat(ui): alpha rank cards on the Market tab"`.
