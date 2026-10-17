# Redesign Stage 3 — Watchlist Redesign, Gainers/Losers, Breadth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship redesign spec stage 3: the redesigned Watchlist tab (spec §4.5) with EMA 20/50/200 cells, trend, RSI, levels, Technical Score, 1-month sparkline and sorting; and on the Dashboard the Nifty 200 top 5 gainers / top 5 losers with an advance/decline breadth bar (spec §4.3 item 3), live during market hours and from the last session otherwise.

**Architecture:** Pure view-model builders in `src/lib/view/watchlist.ts` and `src/lib/view/movers.ts`, unit-tested. The watchlist page loads each stock's last 25 days server-side; the table is a client component that overlays live quotes and sorts locally. Movers come from one route, `/api/movers`, which reads the latest stored session for all Nifty 200 constituents in a single repo call and, during market hours, overlays a cached batch quote; the Dashboard panel polls it every 60 s while the market is open.

**Tech Stack:** unchanged.

**Spec:** `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md` §4.3 (item 3), §4.5. Previous plans: stage 1 and stage 2 in `docs/superpowers/plans/`.

**Depends on:** stage 2 complete (score columns, `index_constituents`, `StockLink`, `ScoreBadge`/`ScoreLabelChip`). Movers show their empty state until the owner's Nifty 200 import (stage 2 Task 5) has run.

**Not in this stage:** sector tiles/constituents (4), portfolio snapshot (5), screeners and Market-tab breadth (6), alerts (7).

## Global Constraints

- All earlier constraints hold (fractions, IST dates, dark tokens, mono tabular numbers, no Claude API, Windows-compatible scripts).
- **Day % precedence everywhere in this stage:** live quote `changePct` when present → stored `pctChange` → stored `importedPct`.
- **EMA trend (3-EMA) for watchlist rows:** `above_all` when CMP ≥ all three EMAs, `below_all` when CMP < all three, `mixed` otherwise, `null` when any EMA is null. Chip tones: above_all up, mixed warn, below_all down. (Same rule the Nifty card already uses; move it to one shared function.)
- **Sorting:** nulls always last regardless of direction; ties broken by stock key ascending; default sort score descending.
- **Movers:** top 5 by day % descending (gainers) and ascending (losers) among Nifty 200 constituents with a non-null day %; a stock never appears in both lists (when fewer than 10 have data, gainers take the positive ones first, losers only negative ones). Breadth counts: advances > 0, declines < 0, unchanged = 0 exactly, over constituents with a non-null day %.
- **Live quotes for movers:** only during market hours (`isMarketOpen`), through the existing quote cache (60 s TTL); outside market hours no Yahoo call is made.

## Review Focus

1. **Watchlist stock with fewer than 21 priced days** (newly listed, or added during an outage) — sparkline renders with what exists (≥ 2 points) or a dash, never crashes; EMA 200 cell shows "—" with the "not enough history" title. Pinned in Task 1.
2. **Live quote missing for some tickers** (Yahoo omits a symbol) — those rows fall back to stored values and still sort correctly. Pinned in Tasks 1 and 3.
3. **Nifty 200 not imported yet / no constituent has today's row** — movers panel shows "Market movers appear after the Nifty 200 list is imported" (no constituents) or "No session data yet" (constituents but no rows), not an empty box. Pinned in Task 3.
4. **Market holiday or weekend** — `/api/movers` uses the newest stored session date (from NIFTY50) and labels the panel with that date. Pinned in Task 3.
5. **Large quote batch** (≈200 tickers) — one cache call per request, not 200; a failed batch falls back to stored values instead of failing the route. Pinned in Task 3.

---

## File Structure

```
src/lib/calc/levels.ts             + emaTrend (shared 3-EMA trend)
src/lib/view/nifty.ts              use emaTrend
src/lib/view/watchlist.ts          buildWatchRow, sortWatchRows, WatchSortKey
src/lib/view/movers.ts             buildMovers
src/lib/api/movers.ts              handleMovers (testable handler)
src/app/api/movers/route.ts
src/lib/db/{repo,supabaseRepo,memoryRepo}.ts   + getDaysOn
src/app/components/Sparkline.tsx
src/app/components/WatchlistTable.tsx  (rewritten)
src/app/components/AddStock.tsx        (restyled to match SearchBox)
src/app/(app)/watchlist/page.tsx       (loads 25 days per stock)
src/app/components/dashboard/MoversPanel.tsx
src/app/(app)/page.tsx                 (MoversPanel between chart and sector strip)
tests/view/watchlist.test.ts, tests/view/movers.test.ts, tests/api/movers.test.ts, tests/calc/returns-levels.test.ts (+emaTrend), tests/db/memoryRepo.test.ts (+getDaysOn)
```

---

### Task 1: Watchlist row model and sorting

**Files:** Modify `src/lib/calc/levels.ts`, `src/lib/view/nifty.ts`; Create `src/lib/view/watchlist.ts`; Test `tests/calc/returns-levels.test.ts`, `tests/view/watchlist.test.ts`

**Interfaces (Produces):**
- `type EmaTrend = "above_all" | "mixed" | "below_all"`; `emaTrend(cmp: number, ema20: number|null, ema50: number|null, ema200: number|null): EmaTrend | null` in `levels.ts`; `buildNiftyCard` uses it (its tests must stay green unchanged).
- In `watchlist.ts`:
  ```ts
  interface WatchInput { key: string; name: string; ticker: string; days: StoredDay[]; levels: Levels } // days ascending, up to 25
  interface WatchRow {
    key: string; name: string; cmp: number; dayPct: number | null;
    ema20: number | null; ema50: number | null; ema200: number | null;
    above20: boolean | null; above50: boolean | null; above200: boolean | null;
    trend: EmaTrend | null; rsi: number | null;
    support: number | null; resistance: number | null; supportIsManual: boolean; resistanceIsManual: boolean;
    toSupport: number | null; toResistance: number | null; nearLevel: boolean;
    score: number | null; scoreLabel: ScoreLabel | null; scorePartial: boolean;
    spark: number[];            // last ≤ 21 priced closes, ascending; live price replaces the last point when live
    notEnoughHistory: boolean;  // ema200 null
  }
  function buildWatchRow(input: WatchInput, live?: { price: number; changePct: number } | null): WatchRow | null // null when no priced day
  type WatchSortKey = "name" | "cmp" | "dayPct" | "ema20" | "ema50" | "ema200" | "rsi" | "toSupport" | "toResistance" | "score";
  function sortWatchRows(rows: WatchRow[], key: WatchSortKey, dir: "asc" | "desc"): WatchRow[]
  ```
  Indicators, levels and score come from the latest priced day; `cmp`/`dayPct` follow the Global Constraints precedence; `above*` = `cmp >= ema` (null when ema null); support/resistance/near-level reuse `effectiveLevel`, `distanceToSupport`, `distanceToResistance`, `isNearLevel`.

- [ ] **Step 1: Write failing tests**
  - `emaTrend(100, 99, 98, 97)` → `above_all`; `(100, 101, 99, 98)` → `mixed`; `(100, 101, 102, 103)` → `below_all`; any null → null.
  - `buildWatchRow` with 25 priced days: `spark.length === 21` and equals the last 21 closes; with live `{ price: 210, changePct: 0.02 }` → `cmp 210`, `dayPct 0.02`, `spark` last point 210.
  - Latest day `pctChange null`, `importedPct 0.015` → `dayPct 0.015` without live.
  - 1 priced day → `spark` has 1 point; 0 priced days → returns null.
  - Manual support 95 overrides auto 90 → `support 95`, `supportIsManual true`; cmp 100, support 99.2 → `nearLevel true`.
  - `ema200 null` → `notEnoughHistory true`, `trend null`, `above200 null`.
  - Score fields copied from the latest day (`score 72`, `scoreLabel "Bullish"`, `scorePartial` from `scoreComponents.partial`).
  - `sortWatchRows` by score desc with scores `[50, null, 80, 50]` and keys `[B, A, C, A2]` → keys `C, A2, B, A` (null last, tie by key); by score asc → `A2, B, C, A` (null still last); by name asc sorts by key.
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(view): watchlist row model with score, EMA 20 and sorting`

---

### Task 2: Watchlist tab UI

**Files:** Create `src/app/components/Sparkline.tsx`; Rewrite `src/app/components/WatchlistTable.tsx`; Modify `src/app/components/AddStock.tsx`, `src/app/(app)/watchlist/page.tsx`

**Interfaces:**
- Consumes: `buildWatchRow`, `sortWatchRows` (Task 1), `useQuotes`, `StockLink`, `ScoreLabelChip`, `Chip`, `Panel`, existing `parseLevelInput`, existing `/api/levels/[key]` and `/api/watchlist/[key]` routes.
- `Sparkline({ values: number[], width = 96, height = 28 })` — inline SVG polyline; stroke `--up` when last ≥ first, else `--down`; a faint area fill (same colour at 12% opacity); endpoint dot; fewer than 2 values → a centred "—"; `aria-label="1-month trend"`.
- Page: for each watchlist instrument load `getDays(id, 25)` and `getLevels(id)`; pass `WatchInput[]` to the table (drop the old 3-day `WatchItem`).
- Table (`Panel` titled `WATCHLIST · n stocks`):
  - Columns: Stock (name as `StockLink`, key below in mono `--muted`), CMP, Day %, EMA 20, EMA 50, EMA 200, Trend, RSI, Support, Resistance, Score, 1M, (remove).
  - EMA cells: value in mono, text `--up` when `above*` true, `--down` when false, `--muted` when null; title "Price above/below EMA n".
  - Trend: Chip `Above all` / `Mixed` / `Below all`, or "—".
  - RSI: number with one decimal; `--warn` when > 70 or < 30.
  - Support / Resistance: value plus `(±x.x%)` distance below in 10 px mono; `M` badge for manual; click to edit inline exactly as today (Enter saves, Esc cancels, empty clears).
  - Score: `ScoreLabelChip` with the number (e.g. `72 · Bullish`); "partial" title when partial; "—" when null.
  - Near-level rows: `bg-amber-950/20` with a left `--warn` border.
  - Headers are buttons that sort (click toggles asc/desc; arrow indicator on the active column); default score desc.
  - Table wrapper `overflow-x-auto`; first column sticky on small screens (`sticky left-0 bg-[var(--panel)]`).
  - Empty watchlist: "Your watchlist is empty. Search for a stock above to add it."
- AddStock: same visual style as the top-bar SearchBox (input with icon, dropdown of `Name (KEY)`), stocks only, debounce 250 ms; on add, `router.refresh()`; error texts unchanged.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS (existing watchlist/levels tests unchanged).
- [ ] **Step 3: Verify manually** (`npm run dev`, signed in): add two stocks; columns show EMA 20/50/200 coloured by price, trend chip, RSI, levels with distance, score chip, sparkline; sort by each header both ways (nulls last); edit a support (M badge), reload, clear it; remove a stock; clicking a name opens the pop-up; 390 px: table scrolls inside its panel with the stock column pinned, no page scroll.
- [ ] **Step 4: Commit** `feat(ui): redesigned watchlist with score, EMA cells and sparklines`

---

### Task 3: Movers and breadth (data)

**Files:** Create `src/lib/view/movers.ts`, `src/lib/api/movers.ts`, `src/app/api/movers/route.ts`; Modify `src/lib/db/{repo,supabaseRepo,memoryRepo}.ts`; Test `tests/view/movers.test.ts`, `tests/api/movers.test.ts`, `tests/db/memoryRepo.test.ts`

**Interfaces (Produces):**
- Repo: `getDaysOn(instrumentIds: number[], date: string): Promise<Map<number, StoredDay>>` — one query (`in` filter, chunks of 300 ids in Supabase), rows for exactly that date.
- `movers.ts`:
  ```ts
  interface MoverEntry { key: string; name: string; price: number | null; pct: number | null }
  interface Movers { gainers: MoverEntry[]; losers: MoverEntry[]; breadth: { advances: number; declines: number; unchanged: number; total: number } }
  function buildMovers(entries: MoverEntry[], n = 5): Movers
  ```
- `api/movers.ts`: `handleMovers(repo: Repo, cache: { get(t: string[]): Promise<Quote[]> }, now: Date): Promise<MoversResponse>` where
  ```ts
  type MoversResponse =
    | { state: "no_universe" }
    | { state: "no_data"; date: string | null }
    | { state: "ok"; date: string; live: boolean; movers: Movers };
  ```
  Steps: constituents of `NIFTY200` (empty → `no_universe`); session date = NIFTY50's latest priced date (`getLatestDay`); `getDaysOn(ids, date)`; base entries from stored close and `pctChange ?? importedPct`; if `isMarketOpen(now)`: one `cache.get(allTickers)` call, overlay price/changePct per ticker that came back, `live: true` (a thrown cache error → stored values, `live: false`); no stored rows and no live quotes → `no_data`.
- Route `GET /api/movers` → `handleMovers(getRepo(), quoteCache, new Date())`, `Cache-Control: no-store`.

- [ ] **Step 1: Write failing tests**
  - `buildMovers`: 12 entries with pcts `[0.05, 0.04, 0.03, 0.02, 0.01, 0.005, 0, -0.01, -0.02, -0.03, -0.04, null]` → gainers pcts `[0.05, 0.04, 0.03, 0.02, 0.01]`, losers `[-0.04, -0.03, -0.02, -0.01]` (only negatives), breadth `{ advances: 6, declines: 4, unchanged: 1, total: 11 }`.
  - Equal pcts ordered by key ascending; no key appears in both lists; all-positive set → losers empty.
  - `handleMovers`: no constituents → `no_universe`; constituents but no rows on the date → `no_data` with the date; closed market → `live: false`, cache never called (spy); open market with quotes for 2 of 3 tickers → those 2 use live pct, the third stored; cache throwing → `live: false`, stored movers returned.
  - Memory repo `getDaysOn` returns only rows on that date for the given ids.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(api): Nifty 200 movers and breadth`

---

### Task 4: Movers panel on the Dashboard

**Files:** Create `src/app/components/dashboard/MoversPanel.tsx`; Modify `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `/api/movers` (Task 3), `useQuotes().open` for market state, `StockLink`, `Panel`, `PctText`, `fmtPrice`, `fmtDate`.
- Server page passes the initial `MoversResponse` (call `handleMovers` directly) so the panel renders without a client round-trip; the client component refetches every 60 s while `open` is true (reuse the existing poller helper or a `setInterval` cleared on unmount).
- Layout: Panel titled `MARKET MOVERS · NIFTY 200` with a right-side label `LIVE` (up Chip) or `as of DD Mon YYYY`. Two columns side by side (stack under 768 px): `TOP GAINERS` and `TOP LOSERS`, each up to 5 rows: name as `StockLink`, price, day % (`PctText`), and a thin horizontal bar whose width is |pct| relative to the largest |pct| in that list (up/down colour). Below: breadth bar — a full-width 8 px rounded bar split advances (`--up`) / unchanged (`--muted`) / declines (`--down`) by count, with counts and ratio `A/D 1.42` in mono underneath.
- States: `no_universe` → "Market movers appear after the Nifty 200 list is imported."; `no_data` → "No session data yet."; fetch error keeps the last data.
- Dashboard order becomes: NiftyCard → PriceChart → MoversPanel → SectorStrip.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS.
- [ ] **Step 3: Verify manually:** before the Nifty 200 import the panel shows the import message; after it (owner's stage 2 import), 5 gainers and up to 5 losers with the session date, breadth counts summing to the constituents with data, names open the pop-up; during market hours the `LIVE` label shows and values change on refresh; 390 px stacks the two lists.
- [ ] **Step 4: Commit** `feat(dashboard): Nifty 200 top gainers, losers and breadth`

---

### Task 5: Docs and owner check

- [ ] **Step 1:** README: Watchlist columns and sorting, `/api/movers`, movers depend on the Nifty 200 import. Commit `docs: stage 3`.
- [ ] **Step 2 (owner):** check the Watchlist tab and the movers panel at full width and phone width; confirm before stage 4 (Sector Analysis) is planned.
