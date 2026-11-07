# Fundamental Quality Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect 15 raw Yahoo fundamentals fields per stock into a new table with a coverage report, changing no score, screen or alert.

**Architecture:** A pure module turns a Yahoo `quoteSummary` response into a typed row and computes coverage. A local script (`npm run collect-fundamentals`) lists the universe, fetches stocks a few at a time with retries, upserts rows straight to Supabase (no `Repo` change) and prints coverage. One migration adds the table.

**Tech Stack:** TypeScript, `tsx`, `vitest`, `yahoo-finance2` ^4.0.4 (already installed), `@supabase/supabase-js`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-fundamental-quality-collection-design.md`

## Global Constraints

- Store values exactly as Yahoo returns them: no unit conversion, no defaults, no derived numbers. A value that is missing, not a finite number, or not a number is stored as `null` and its field name goes in `missing`. A value of `0` is real, not missing.
- No change to scoring, Rankings, alerts, the UI, crons or `Repo`.
- No new dependencies. No scraping.
- Migration number is `0021` (0016 to 0020 exist). It is written as a file in Task 2 and applied to Tracker1 only after the owner's separate explicit yes (Task 4).
- Scripts load `.env.local` with `process.loadEnvFile(".env.local")`, use `createAdminClient()` (`src/lib/supabase/admin.ts`) and `createSupabaseRepo`, and end with the `main().catch(...)` pattern from `scripts/backfill-delivery.ts`.
- Re-running on the same day overwrites (primary key `instrument_id, fetched_on`).
- Fields and Yahoo modules, verbatim from the spec: financialData: returnOnEquity, returnOnAssets, profitMargins, operatingMargins, revenueGrowth, earningsGrowth, debtToEquity, currentRatio, totalDebt, totalCash, freeCashflow, operatingCashflow. summaryDetail: trailingPE, marketCap. defaultKeyStatistics: priceToBook.
- Financials are stocks that belong to `NIFTY_FIN`, `NIFTY_PVT_BANK` or `NIFTY_PSU_BANK`.

## Review Focus

- A symbol Yahoo does not know (the call throws or returns nothing): stored as a row with every field missing, never skipped, never aborting the run. Pinned in Task 1 (`toRow(null, ...)`) and Task 3.
- A response where a whole module is absent: only that module's fields are missing. Pinned in Task 1.
- A field that is `0`, negative, `NaN`, `Infinity`, a string or an object: `0` and negatives are values, the rest are missing. Pinned in Task 1.
- `--dry-run` must write nothing, and a re-run on the same day must not duplicate rows. Pinned in Task 3 (manual checks).
- A stock in several indexes (for example Nifty 200 and Nifty Bank): it is financial if any of its indexes is one of the three. Pinned in Task 1.

---

### Task 1: Pure module `fundamentals.ts`

**Files:**
- Create: `src/lib/calc/fundamentals.ts`
- Test: `tests/calc/fundamentals.test.ts`

**Interfaces:**
- Produces:
  - `FIELDS: { key: string; column: string; module: "financialData" | "summaryDetail" | "defaultKeyStatistics" }[]`: the 15 fields in the order of Global Constraints; `column` is the snake_case table column (`returnOnEquity` becomes `return_on_equity`, `freeCashflow` becomes `free_cashflow`, `trailingPE` becomes `trailing_pe`, `priceToBook` becomes `price_to_book`, `marketCap` becomes `market_cap`).
  - `FINANCIAL_INDEXES: string[]` = `["NIFTY_FIN", "NIFTY_PVT_BANK", "NIFTY_PSU_BANK"]`.
  - `isFinancial(indexKeys: string[]): boolean`.
  - `type FundamentalsRow = { instrumentId: number; fetchedOn: string; isFinancial: boolean; values: Record<string, number | null>; missing: string[]; raw: unknown }`, where `values` is keyed by `FIELDS[].key`.
  - `toRow(summary: unknown, ctx: { instrumentId: number; fetchedOn: string; isFinancial: boolean }): FundamentalsRow`. `summary` is the object Yahoo returns (modules as keys) or `null`/`undefined`/any non-object, which yields every field missing and `raw: null`.
  - `type Coverage = { financials: { stocks: number; byField: Record<string, number> }; others: { stocks: number; byField: Record<string, number> } }`.
  - `coverage(rows: Pick<FundamentalsRow, "isFinancial" | "missing">[]): Coverage`: `byField[key]` is the number of stocks in that group where the field is present.
  - `formatCoverage(c: Coverage): string`: a plain-text table, one line per field with `present/stocks` and a percent for each group, fields below 80% marked with `<80%`.

- [ ] **Step 1: Write the failing tests** in `tests/calc/fundamentals.test.ts`:
  - `FIELDS` has 15 entries with unique keys and unique columns; `FIELDS.find(f => f.key === "trailingPE")!.column === "trailing_pe"`.
  - `isFinancial(["NIFTY200", "NIFTY_PVT_BANK"])` is `true`; `isFinancial(["NIFTY200", "NIFTY_AUTO"])` and `isFinancial([])` are `false`.
  - `toRow` with a full response (all three modules, every field a finite number) gives `missing: []`, `values.returnOnEquity` equal to the input, `raw` equal to the input.
  - `toRow` with `financialData` absent: the 12 financialData fields are in `missing` and null in `values`; the 4 others are present.
  - `toRow` field values: `0` and `-5` are kept; `NaN`, `Infinity`, `"12"`, `{}`, `null` and `undefined` become null and appear in `missing`.
  - `toRow(null, ctx)`, `toRow(undefined, ctx)` and `toRow("x", ctx)`: all 15 fields missing, `raw` null, `instrumentId`, `fetchedOn` and `isFinancial` echoed from `ctx`.
  - `coverage` with three rows (one financial missing `debtToEquity`, two non-financial, one of them missing `returnOnEquity`): `financials.stocks === 1`, `financials.byField.debtToEquity === 0`, `others.stocks === 2`, `others.byField.returnOnEquity === 1`; with no rows both groups have `stocks: 0` and every `byField` value `0`.
  - `formatCoverage` output contains `returnOnEquity`, the text `1/2`, and `<80%` on a field under 80%.

- [ ] **Step 2: Run to verify failure:** `npx vitest run tests/calc/fundamentals.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement the module** exactly to the signatures above. A value counts as present only when `typeof v === "number" && Number.isFinite(v)`. Read each field from `summary[module][key]`, treating a missing or non-object module as absent. `raw` is the input stored as plain JSON (`JSON.parse(JSON.stringify(summary))`) so Dates become strings.

- [ ] **Step 4: Run to verify pass:** `npx vitest run tests/calc/fundamentals.test.ts`. Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add src/lib/calc/fundamentals.ts tests/calc/fundamentals.test.ts
git commit -m "Add pure Yahoo fundamentals row and coverage logic"
```

### Task 2: Migration file

**Files:**
- Create: `supabase/migrations/0021_fundamentals_snapshots.sql`

**Interfaces:**
- Produces: table `fundamentals_snapshots` with columns `instrument_id bigint references instruments on delete cascade`, `fetched_on date`, `is_financial boolean not null`, one `double precision` column per `FIELDS[].column` (all nullable), `missing text[] not null default '{}'`, `raw jsonb`, `fetched_at timestamptz not null default now()`; primary key `(instrument_id, fetched_on)`; RLS enabled with no policies. Task 3 upserts with `onConflict: "instrument_id,fetched_on"`.

- [ ] **Step 1: Write the SQL file** with `create table if not exists`, a one-line comment saying it is collect-only data that no score reads, and `alter table fundamentals_snapshots enable row level security;`. Use `double precision` because `marketCap` and `totalDebt` exceed 32-bit integers and Yahoo ratios are fractional.
- [ ] **Step 2: Do NOT apply it.** Verification: `git diff --stat` shows only this file; the file lists exactly the 15 columns from `FIELDS`.
- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/0021_fundamentals_snapshots.sql
git commit -m "Add migration 0021 fundamentals_snapshots (not applied)"
```

### Task 3: Collection script

**Files:**
- Create: `scripts/collect-fundamentals.ts`
- Modify: `package.json` (add `"collect-fundamentals": "tsx scripts/collect-fundamentals.ts"`), `README.md` (a short "Fundamentals collection" paragraph under "Data scripts": what it does, the three flags, that nothing reads the table yet)

**Interfaces:**
- Consumes: `listUniverseStocks(repo)` from `src/lib/universe/stocks.ts` returns `Instrument[]` (`id`, `key`, `yahooTicker`); `repo.listMemberships()` returns `{ indexKey, instrumentId }[]`; `withRetry(fn, attempts, baseMs)` from `src/lib/provider/retry.ts`; `pool(items, limit, fn)` from `src/lib/jobs/pool.ts`; `istDate(new Date())` from `src/lib/time/ist.ts`; Task 1 exports.
- Produces: the CLI. Flags: `--dry-run` (fetch and report, write nothing), `--only A,B` (restrict to these instrument keys), `--report` (no fetching: read the latest `fetched_on` rows from the table and print coverage).

- [ ] **Step 1: Implement `scripts/collect-fundamentals.ts`:**
  - Parse flags; reject `--only` and `--report` together. `--only` with an unknown key aborts with a message naming it.
  - Build the universe, apply `--only`, and build `isFinancial` per stock from `listMemberships` via Task 1 `isFinancial`.
  - Fetch with `pool(stocks, 4, ...)`: for each, `withRetry(() => yahooFinance.quoteSummary(ticker, { modules: ["financialData", "summaryDetail", "defaultKeyStatistics"] }, { validateResult: false }), 3, 1000)`, then `toRow`. If all attempts throw, `toRow(null, ctx)` and count it under "failed fetches" with the ticker and error text. Sleep ~300 ms after each stock inside the pool worker. Verify the `quoteSummary` call signature and the `validateResult` option against the installed `yahoo-finance2` before relying on them; adjust to what the installed version accepts.
  - Unless `--dry-run`, upsert rows in batches of 100 to `fundamentals_snapshots` with columns from `FIELDS[].column`, `is_financial`, `missing`, `raw`, `instrument_id`, `fetched_on` (today's IST date) and `fetched_at`, `onConflict: "instrument_id,fetched_on"`. A write error aborts with exit code 1.
  - Print: universe size, failed-fetch list, then `formatCoverage(coverage(rows))`, then the 10 stocks with the most missing fields.
  - `--report` path: select the max `fetched_on`, load its rows, print the same coverage.
- [ ] **Step 2: Typecheck and lint:** `npm run typecheck` and `npm run lint`. Expected: clean.
- [ ] **Step 3: Dry run on real symbols (no database writes):** `npm run collect-fundamentals -- --dry-run --only TCS,HDFCBANK,RELIANCE`. Expected: the coverage report prints, `HDFCBANK` counts as a financial, and the Supabase `fundamentals_snapshots` table does not exist yet, so a write would fail. This proves nothing is written. If `--dry-run` tries to write, fix before moving on. Report what Yahoo returned for these three, including which fields were missing.
- [ ] **Step 4: Run the full suite:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit**
```bash
git add scripts/collect-fundamentals.ts package.json README.md
git commit -m "Add collect-fundamentals script and README note"
```

### Task 4: Apply the migration and first real run (owner's gate)

**Files:**
- Modify: `NOTES.md` (what ran, the coverage numbers, next review date)

**Interfaces:**
- Consumes: Tasks 2 and 3.

- [ ] **Step 1: Stop and ask the owner for an explicit yes to apply 0021 to Tracker1.** Do not apply on any other instruction. Verification: the owner's message says to apply it.
- [ ] **Step 2: Apply** with the Supabase `apply_migration` tool (name `fundamentals_snapshots`, the SQL from the file). Verify with `select column_name from information_schema.columns where table_name = 'fundamentals_snapshots'` that all 15 field columns plus `instrument_id, fetched_on, is_financial, missing, raw, fetched_at` exist.
- [ ] **Step 3: First run:** `npm run collect-fundamentals`. Expected: roughly 255 stocks, the coverage report prints, and `select count(*) from fundamentals_snapshots` equals the universe size.
- [ ] **Step 4: Re-run the same day:** the row count must not grow (upsert).
- [ ] **Step 5: Record in `NOTES.md`:** the coverage per field for financials and others, the failed fetches, and "run weekly; review after 3 to 4 runs; score only if coverage is about 80% or better".
- [ ] **Step 6: Commit** `NOTES.md`. Do not push or deploy unless the owner asks; this feature adds no deployed behavior, only a table and a script.

## Self-review notes
- Spec coverage: fields (Task 1), table design (Task 2), script and flags (Task 3), coverage split by financials (Tasks 1 and 3), pure logic tests (Task 1), success review after weekly runs (Task 4). Out-of-scope items appear in no task.
- Deviation to flag to the owner: the universe uses `listUniverseStocks` (Nifty 200, every sector index's members, watchlist, holdings; about 255 stocks), a slight superset of the spec's "Nifty 200 plus holdings and watchlist", so it matches what the EOD job already prices.
- Types: `FIELDS`, `FundamentalsRow`, `toRow`, `coverage` and `formatCoverage` are used with the same names in Tasks 1 and 3.
