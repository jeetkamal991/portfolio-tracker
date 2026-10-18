# Redesign Stage 5 — Portfolio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship redesign spec stage 5: the Portfolio tab (spec §4.4) — summary cards, stop-loss/target warnings bar, sortable holdings table, add/edit holding pop-up with type-to-pick stock search and auto-filled CMP, sector, score and suggested levels, merge-on-add averaging — plus the Dashboard portfolio snapshot (spec §4.3 item 4) and the "Add to Portfolio" button in the stock pop-up (spec §4.2).

**Architecture:** A `holdings` table (one row per instrument) behind four Repo methods. All money maths (invested, value, P/L, day P/L, merge averaging, status rules) lives in pure functions in `src/lib/calc/portfolio.ts`. Holding stocks join the data universe (`listUniverseStocks`) so the EOD job prices and scores them, and the live quote poller includes their tickers. Adding a holding for a stock with no stored history first runs the same back-fill + score path the watchlist uses (extracted into one shared function).

**Tech Stack:** unchanged.

**Spec:** `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md` §4.2 (Add to Portfolio), §4.3 item 4, §4.4, §6.2 (`holdings`), §7. Previous plans: stages 1–4 in `docs/superpowers/plans/`.

**Not in this stage:** automatic holding alerts and Telegram (stage 7 — this stage only computes status); transactions history, CSV import, realised P/L (out of scope per spec §10).

## Global Constraints

- All earlier constraints hold (fractions, IST dates, dark tokens, mono tabular numbers, no Claude API, Windows-compatible scripts).
- Money is shown in ₹ with `en-IN` grouping and 2 decimals for prices, 0 decimals for totals (`₹1,24,560`); P/L always signed (`+₹2,340`, `−₹1,120`) and coloured up/down.
- **CMP precedence:** live quote price → latest stored close. **Day % precedence:** live `changePct` → stored `pctChange` → `importedPct`.
- **Formulas (per holding):** `invested = qty × avgPrice`; `value = qty × cmp`; `pnl = value − invested`; `pnlPct = pnl / invested`; `prevClose = cmp / (1 + dayPct)`; `dayPnl = qty × (cmp − prevClose)`, except when `buyDate` is today (IST) → `dayPnl = qty × (cmp − avgPrice)`; `dayPnl` null when `dayPct` is null and the buy date is not today.
- **Totals:** sums over holdings with a CMP; `totalPnlPct = totalPnl / totalInvested` (null when invested is 0); `todayPnl` sums non-null day P/Ls.
- **Merge on add** (same instrument already held): `qty = q1 + q2`; `avgPrice = (q1·p1 + q2·p2) / (q1 + q2)`; `buyDate` = the earlier date; SL/T1/T2 = the new entry's values when given, else the existing ones.
- **Status rules (spec §4.4, verbatim):** SL: `cmp <= sl` → `SL_HIT`; `(cmp − sl)/cmp <= 0.02` → `NEAR_SL`. T1: `cmp >= t1` → `TARGET_HIT`; `(t1 − cmp)/cmp <= 0.02` → `NEAR_TARGET`. Precedence: SL_HIT > TARGET_HIT > NEAR_SL > NEAR_TARGET > OK. No SL and no T1 → OK.
- **Validation:** quantity a positive integer; buy price > 0; buy date not in the future (IST) and not before 2000-01-01; SL/T1/T2 optional, > 0 when given. Inline warnings (allowed to save): SL ≥ buy price ("Stop loss is at or above your buy price"), T1 ≤ CMP ("Target 1 is already below the current price"), T2 ≤ T1 ("Target 2 should be above Target 1").
- Destructive actions use an in-page confirm (two-step button), never `window.confirm`.

## Review Focus

1. **Holding with no live quote and no stored close** (just added, data fetch failed) — row shows "—" for CMP-dependent values, is excluded from totals, and the summary says "1 holding has no price yet"; nothing renders `NaN` or `₹0`. Pinned in Task 1.
2. **Buy date = today** — day P/L uses the buy price, not yesterday's close (otherwise a stock bought today shows yesterday-to-today movement it never had). Pinned in Task 1.
3. **Merging with a different buy price and partial quantities** — weighted average is exact to the paisa (round only for display). Pinned in Task 1.
4. **SL above CMP at entry or T1 below CMP** — status immediately shows SL_HIT / TARGET_HIT and the form shows the warning, but saving is allowed. Pinned in Tasks 1 and 4.
5. **Adding a stock outside the Nifty 200 that Yahoo doesn't know** — clear "No price data for this stock" error and nothing saved. Pinned in Task 2.

---

## File Structure

```
supabase/migrations/0005_holdings.sql
src/lib/db/{types,repo,supabaseRepo,memoryRepo}.ts   + Holding, listHoldings/getHolding/upsertHolding/deleteHolding
src/lib/calc/portfolio.ts          holdingMetrics, portfolioTotals, mergeHolding, holdingStatus, validateHoldingInput
src/lib/universe/stocks.ts         listUniverseStocks += holdings
src/lib/jobs/backfill.ts           ensureStockData (extracted from addStock), addHolding
src/lib/api/portfolio.ts           handleHoldingPost/Put/Delete, buildHoldingPrefill
src/lib/api/quotes.ts              + holding tickers
src/app/api/holdings/route.ts      POST (add/merge)
src/app/api/holdings/[key]/route.ts  PUT (edit), DELETE
src/app/api/holdings/prefill/[key]/route.ts  GET (form auto-fill)
src/lib/view/portfolio.ts          buildPortfolioView (rows + totals + warnings, sortable)
src/app/(app)/portfolio/page.tsx
src/app/components/portfolio/{SummaryCards,WarningsBar,HoldingsTable,HoldingForm,PortfolioSnapshot}.tsx
src/app/components/popup/StockModal.tsx   + Add to Portfolio
src/app/(app)/page.tsx                    + PortfolioSnapshot
tests/calc/portfolio.test.ts, tests/api/portfolio.test.ts, tests/view/portfolio.test.ts, tests/jobs/backfill.test.ts (+addHolding), tests/db/memoryRepo.test.ts (+holdings)
```

---

### Task 1: Portfolio maths

**Files:** Create `src/lib/calc/portfolio.ts`; Test `tests/calc/portfolio.test.ts`

**Interfaces (Produces):**
```ts
interface HoldingInput { qty: number; avgPrice: number; buyDate: string; stopLoss: number | null; target1: number | null; target2: number | null }
type HoldingStatus = "OK" | "NEAR_SL" | "SL_HIT" | "NEAR_TARGET" | "TARGET_HIT";
interface HoldingMetrics { invested: number; value: number | null; pnl: number | null; pnlPct: number | null; dayPnl: number | null; status: HoldingStatus | null }
function holdingMetrics(h: HoldingInput, cmp: number | null, dayPct: number | null, today: string): HoldingMetrics
function holdingStatus(cmp: number, stopLoss: number | null, target1: number | null): HoldingStatus
function portfolioTotals(rows: (HoldingMetrics & { hasPrice: boolean })[]): { invested: number; value: number; pnl: number; pnlPct: number | null; todayPnl: number; count: number; unpriced: number }
function mergeHolding(existing: HoldingInput, incoming: HoldingInput): HoldingInput
function validateHoldingInput(input: unknown, ctx: { today: string; cmp: number | null }): { ok: true; value: HoldingInput; warnings: string[] } | { ok: false; errors: Record<string, string> }
```
`validateHoldingInput` uses zod for shape; error keys are field names (`qty`, `avgPrice`, `buyDate`, `stopLoss`, `target1`, `target2`); messages: "Enter a whole number above 0", "Enter a price above 0", "Buy date can't be in the future", "Enter a price above 0, or leave empty".

- [ ] **Step 1: Write failing tests**
  - 10 @ ₹100, cmp 110, dayPct 0.10, buy date earlier → invested 1000, value 1100, pnl 100, pnlPct 0.1, prevClose 100, dayPnl 100.
  - Same but `buyDate === today` → dayPnl = 10 × (110 − 100) = 100 computed from avgPrice; with avgPrice 105 → 50.
  - cmp null → value/pnl/pnlPct/dayPnl/status null; `invested` still 1000.
  - dayPct null and buy date earlier → dayPnl null.
  - Status: SL 95, cmp 95 → SL_HIT; cmp 96.9 → NEAR_SL ((96.9−95)/96.9 = 0.0196); cmp 97 → OK with no T1; T1 120, cmp 120 → TARGET_HIT; cmp 117.7 → NEAR_TARGET ((120−117.7)/117.7 = 0.0195); SL 95 + T1 120 with cmp 96 → NEAR_SL (SL outranks); no SL, no T1 → OK.
  - Totals over three rows (one unpriced) → sums of the two priced, `unpriced 1`, `count 3`; all invested 0 → `pnlPct null`.
  - Merge 10 @ 100 (2026-01-10, SL 90) + 5 @ 130 (2026-03-01, SL null, T1 150) → qty 15, avg 110, buyDate 2026-01-10, SL 90, T1 150.
  - Merge 3 @ 101.35 + 7 @ 99.10 → avg 99.775 exactly (no rounding in the stored value).
  - Validation: qty 2.5 → error on `qty`; buy date tomorrow → error; SL 120 with avgPrice 100 → ok with warning "Stop loss is at or above your buy price"; T1 90 with cmp 100 → warning; T2 110 with T1 120 → warning; empty SL → `stopLoss null`.
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): portfolio metrics, status, merge and validation`

---

### Task 2: Holdings storage, universe and add-holding job

**Files:** Create `supabase/migrations/0005_holdings.sql`; Modify `src/lib/db/{types,repo,supabaseRepo,memoryRepo}.ts`, `src/lib/universe/stocks.ts`, `src/lib/jobs/backfill.ts`, `src/lib/jobs/score.ts` (if it lists stocks itself), `src/lib/api/quotes.ts`; Test `tests/db/memoryRepo.test.ts`, `tests/jobs/backfill.test.ts`, `tests/api/quotes.test.ts` (or the existing quotes test)

**Migration:**
```sql
create table if not exists holdings (
  instrument_id bigint primary key references instruments on delete cascade,
  quantity numeric not null check (quantity > 0),
  avg_price numeric not null check (avg_price > 0),
  buy_date date not null,
  stop_loss numeric, target1 numeric, target2 numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
alter table holdings enable row level security;
```

**Interfaces (Produces):**
- `interface Holding extends HoldingInput { instrumentId: number; key: string; name: string; yahooTicker: string }`
- Repo: `listHoldings(): Promise<Holding[]>`, `getHolding(instrumentId: number): Promise<Holding | null>`, `upsertHolding(instrumentId: number, h: HoldingInput): Promise<void>` (sets `updated_at`), `deleteHolding(instrumentId: number): Promise<void>`.
- `listUniverseStocks` returns NIFTY200 ∪ watchlist ∪ holdings (de-duplicated); `scorePass` and the EOD job get holdings through it (make `score.ts` use `listUniverseStocks` if it builds its own list).
- `handleQuotes` adds holding tickers to the batch.
- `backfill.ts`: extract `ensureStockData(deps, inst): Promise<{ ok: true } | { ok: false; error: "no_data" }>` — if the instrument already has a stored priced day within the last 10 calendar days, return ok; otherwise fetch 730 days, store, recompute, and score (`scorePass(onlyIds)`, scoring errors swallowed as today). `addStock` uses it (behaviour unchanged, its tests stay green).
- `addHolding(deps, key: string, input: HoldingInput): Promise<{ ok: true; merged: boolean } | { ok: false; error: "unknown_symbol" | "no_data" }>` — instrument must be a stock; `ensureStockData`; then insert, or `mergeHolding` with the existing row and save.

- [ ] **Step 1: Write failing tests**
  - Memory repo: upsert then list returns key/name/ticker joined; delete removes; upsert again replaces.
  - `addHolding` new stock with provider history → stored candles, holding saved, `merged false`, stock has a score.
  - `addHolding` same key again → `merged true`, qty summed, avg weighted.
  - Provider returns `[]` for an unknown stock → `no_data`, no holding saved.
  - Stock already priced yesterday (NIFTY200 member) → provider not called (spy).
  - `listUniverseStocks` includes a holding that is in neither NIFTY200 nor the watchlist.
  - `handleQuotes` includes a holding's ticker.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, `npm run typecheck` — PASS.
- [ ] **Step 5: Apply migration 0005** to Tracker1. Verify `select to_regclass('public.holdings')` is not null.
- [ ] **Step 6: Commit** `feat(db): holdings storage; holdings join the data universe`

---

### Task 3: Portfolio API and view model

**Files:** Create `src/lib/api/portfolio.ts`, `src/app/api/holdings/route.ts`, `src/app/api/holdings/[key]/route.ts`, `src/app/api/holdings/prefill/[key]/route.ts`, `src/lib/view/portfolio.ts`; Test `tests/api/portfolio.test.ts`, `tests/view/portfolio.test.ts`

**Interfaces (Produces):**
- `POST /api/holdings` body `{ key, qty, avgPrice, buyDate, stopLoss?, target1?, target2? }` → validate (Task 1, `cmp` from latest stored close) → `addHolding` → 200 `{ ok: true, merged, warnings }`; validation → 400 `{ errors }`; job errors → 400 `{ error }`. `export const maxDuration = 60`.
- `PUT /api/holdings/[key]` same body without `key` → validate → `upsertHolding` (replace, no merge) → 200 `{ ok: true, warnings }`; not held → 404.
- `DELETE /api/holdings/[key]` → 204.
- `GET /api/holdings/prefill/[key]` → `{ key, name, sectorName, cmp, dayPct, score, scoreLabel, support, resistance, nextResistance, held: HoldingInput | null }`; `nextResistance` = the second-nearest merged swing high above CMP (add `swingLevelList(bars, cmp): { supports: number[]; resistances: number[] }` to `swing.ts`, nearest first, and keep `swingLevels` as a wrapper so its tests stay green); unknown key → 404.
- `buildPortfolioView(holdings: Holding[], latest: Map<number, StoredDay | null>, quotes: Record<string, { price: number; changePct: number }>, today: string): { rows: PortfolioRow[]; totals; warnings: { key: string; name: string; status: HoldingStatus; cmp: number; level: number }[] }` where `PortfolioRow` = holding fields + metrics + `cmp`, `dayPct`, `score`, `scoreLabel`; warnings = rows whose status ≠ OK, ordered SL_HIT, TARGET_HIT, NEAR_SL, NEAR_TARGET then by key; `level` is the SL for SL statuses, T1 for target statuses.
- `sortPortfolioRows(rows, key: "name"|"qty"|"avgPrice"|"cmp"|"invested"|"value"|"pnl"|"pnlPct"|"dayPnl"|"score", dir)` — nulls last, ties by key; default `value` desc.

- [ ] **Step 1: Write failing tests** — POST valid → 200 and holding stored; POST qty 0 → 400 with `errors.qty`; POST for a held key merges; PUT replaces values exactly; PUT unknown → 404; DELETE then list empty; prefill returns support/resistance/nextResistance from a fixture with three swing highs above CMP (nearest two in order); `buildPortfolioView` uses live price when present, stored close otherwise, and orders warnings as specified; sort by pnl desc with a null pnl row last.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(api): holdings add/edit/remove, prefill and portfolio view`

---

### Task 4: Portfolio tab UI

**Files:** Rewrite `src/app/(app)/portfolio/page.tsx`; Create `src/app/components/portfolio/{SummaryCards,WarningsBar,HoldingsTable,HoldingForm}.tsx`

**Interfaces:**
- Page (server): `listHoldings`, latest day per holding (`getDaysOn` on the latest Nifty session plus `getLatestDay` for any holding missing that day), pass to a client wrapper that overlays `useQuotes()` and calls `buildPortfolioView` + `sortPortfolioRows`.
- **SummaryCards:** five tiles in a row (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`): `TOTAL INVESTED`, `CURRENT VALUE`, `OVERALL P/L` (₹ and % below), `TODAY'S P/L` (with `LIVE` chip during market hours), `HOLDINGS` (count; "· 1 without price" note when `unpriced > 0`). Mono values, uppercase mono labels.
- **WarningsBar:** shown only when warnings exist; amber Panel `RISK ALERTS`; one chip per warning: `TCS · STOP LOSS NEAR · CMP ₹3,412 · SL ₹3,400` (SL_HIT/TARGET_HIT in down/up colours, NEAR in warn); chip opens the stock pop-up.
- **HoldingsTable:** columns Stock (`StockLink`, key below), Qty, Avg buy, CMP, Invested, Value, P/L (₹ and %), Day P/L, SL, T1, T2, Status (chip: OK neutral, Near SL warn, SL hit down, Near target warn, Target hit up), Score (`ScoreLabelChip`), actions (Edit, Remove with two-step confirm "Remove? Yes / No"). Sortable headers (Task 3), sticky first column on phones, `overflow-x-auto`. Header button `+ Add holding`.
- **HoldingForm** (modal over the page, focus-trapped, Esc closes): 
  - Stock search (same component style as AddStock; stocks only); after picking, fetch `/api/holdings/prefill/KEY` and show a strip: name, sector, CMP with day %, score chip, "Support ₹x · Resistance ₹y". If already held, show "You hold 10 @ ₹100 — this adds to it (new average shown below)".
  - Fields: Quantity, Buy price (default CMP), Buy date (default today IST, `type="date"`, max today), Stop loss (placeholder `support ₹x`), Target 1 (placeholder `resistance ₹y`), Target 2 (placeholder `next resistance ₹z`); "Use suggested levels" button fills SL/T1/T2 from the placeholders.
  - Live preview line: `Invested ₹… · Value ₹… · P/L …` and, when merging, `New average ₹…`.
  - Field errors under each input; warnings in amber above the Save button (saving still allowed).
  - Edit mode: opened from a row; stock fixed; fields pre-filled from the holding; PUT on save.
  - On success: close, `router.refresh()`.
- Empty state: Panel "No holdings yet" with the `+ Add holding` button.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS.
- [ ] **Step 3: Verify manually** (`npm run dev`, signed in):
  - Add "reli" → Reliance: prefill shows CMP, sector, score, levels; "Use suggested levels" fills SL/T1/T2; save; row and summary update.
  - Add Reliance again with a different price → merge message and new average shown before saving; after save one row with summed qty.
  - Edit the SL to just under CMP → status Near SL, warnings bar chip appears; set SL above CMP → SL hit chip and form warning.
  - A stock outside the Nifty 200 (e.g. a small-cap) adds after a short wait; a nonsense symbol is not offered.
  - Remove with the two-step confirm.
  - Today's P/L shows `LIVE` during market hours; values move with quotes.
  - 390 px: cards wrap, table scrolls with the stock column pinned, form fits the screen.
- [ ] **Step 4: Commit** `feat(ui): Portfolio tab with holdings, warnings and add/edit form`

---

### Task 5: Dashboard snapshot and pop-up button

**Files:** Create `src/app/components/portfolio/PortfolioSnapshot.tsx`; Modify `src/app/(app)/page.tsx`, `src/app/components/popup/StockModal.tsx`, `src/lib/api/instrument.ts` / `src/lib/view/popup.ts` (add `holding: HoldingInput | null` to `PopupData`)

**Interfaces:**
- **PortfolioSnapshot** (Dashboard, after MoversPanel, before SectorStrip): Panel `YOUR PORTFOLIO` with action link `Manage portfolio (n) →` to `/portfolio`; four mini tiles (Invested, Current value, Overall P/L with %, Today's P/L); top 4 holdings by value (name as `StockLink`, `qty shares · Buy ₹x · CMP ₹y`, P/L ₹ and % right-aligned). Empty: "Add your first holding" button linking to `/portfolio?add=1` (the Portfolio page opens the form when `add=1`).
- **Pop-up header:** for stocks, an `Add to Portfolio` button beside `Add to Watchlist`; when held, it reads `In portfolio · 10 @ ₹100` and opens the edit form. Clicking navigates to `/portfolio?add=KEY` (or `?edit=KEY`), where the form opens with the stock pre-picked — no second form implementation inside the pop-up.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS.
- [ ] **Step 3: Verify manually:** Dashboard snapshot totals equal the Portfolio tab's; pop-up for a held stock shows "In portfolio" and opens the edit form; for a non-held stock opens the add form with the stock chosen; empty portfolio shows the button.
- [ ] **Step 4: Commit** `feat(ui): portfolio snapshot on dashboard; add to portfolio from pop-up`

---

### Task 6: Docs and owner check

- [ ] **Step 1:** README: Portfolio features, P/L and status rules, migration 0005, holdings are priced and scored by the nightly job. Commit `docs: stage 5`.
- [ ] **Step 2 (owner):** add a few real holdings, check P/L against your broker app for one stock, and confirm before stage 6 (Market: screeners + Claude summary) is planned.
