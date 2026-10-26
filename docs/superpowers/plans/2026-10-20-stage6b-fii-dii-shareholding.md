# Stage 6b — FII / DII Stake-Increase Screeners

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two quarterly screeners to the Market tab — top 10 Nifty 200 stocks where **FII** stake increased and where **DII** stake increased versus the previous quarter — plus FII/DII holding rows in the pop-up's Indicator Table. Data is collected by a Claude scheduled task on the owner's subscription (no Claude API) and stored in a new `shareholding` table.

**Architecture:** The app only reads `shareholding`. A pure function ranks quarter-on-quarter changes. Claude writes rows following `docs/claude-tasks/shareholding.md`, whose SQL is verified against the live database. Approved in chat on 2026-10-20 (owner chose "Claude collects it quarterly").

**Tech Stack:** unchanged.

**Spec:** `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md` §4.7 (screeners) — this plan adds the two cards. Builds on stage 6 (`docs/superpowers/plans/2026-10-18-redesign-stage6-market.md`).

## Global Constraints

- All earlier constraints hold. Percentages in `shareholding` are stored as **percent numbers** (48.1 = 48.1%), exactly as companies report them; changes are shown in **percentage points** (`+1.5 pts`). This is the one table that does not use fractions; the type and column comments say so.
- **Quarter** is identified by its end date: `2026-09-30`, `2026-06-30`, … Label format: `Jul–Sep 2026`.
- **Latest quarter** = the most recent quarter end with at least one row. **Previous quarter** = the quarter end three months before it.
- **Ranking:** universe = NIFTY200 constituents with rows for both quarters and non-null values for that holder; change = latest − previous; only changes > 0 are listed; top 10 by change desc, ties by key asc. `reported` = constituents with a row for the latest quarter; `total` = constituents.
- **Validation rules** (in the Claude task and re-checked by the app's parser): each value 0–100; `fii + dii + promoter ≤ 100.5` (rounding slack); a row failing them is not written (task) / ignored (app).

## Review Focus

1. **Quarter half-collected** (e.g. 120 of 200 reported) — the card ranks what exists and says "120 / 200 reported"; it never compares a stock's latest quarter with a two-quarters-old row. Pinned in Task 1.
2. **Stock with only the latest quarter** (first collection, new constituent) — excluded from ranking, no crash. Pinned in Task 1.
3. **Table empty** (before the first Claude run) — both cards show "Shareholding data appears after the quarterly update runs." Pinned in Task 2.
4. **Claude writing a duplicate or corrected value** — writes are upserts on (instrument, quarter), so a re-run replaces, never duplicates. Pinned in Task 3.

---

### Task 1: Storage and ranking

**Files:** Create `supabase/migrations/0008_shareholding.sql`, `src/lib/calc/shareholding.ts`; Modify `src/lib/db/{types,repo,supabaseRepo,memoryRepo}.ts`; Test `tests/calc/shareholding.test.ts`, `tests/db/memoryRepo.test.ts`

**Migration:**
```sql
create table if not exists shareholding (
  instrument_id bigint not null references instruments on delete cascade,
  quarter_end date not null,
  fii_pct numeric check (fii_pct between 0 and 100),
  dii_pct numeric check (dii_pct between 0 and 100),
  promoter_pct numeric check (promoter_pct between 0 and 100),
  source_url text,
  collected_at timestamptz not null default now(),
  primary key (instrument_id, quarter_end));
comment on table shareholding is 'Quarterly shareholding pattern; *_pct are percent numbers (48.1 = 48.1%), not fractions.';
alter table shareholding enable row level security;
```

**Interfaces (Produces):**
- `interface ShareholdingRow { instrumentId: number; quarterEnd: string; fiiPct: number | null; diiPct: number | null; promoterPct: number | null; sourceUrl: string | null }`
- Repo: `listShareholding(quarterEnds: string[]): Promise<ShareholdingRow[]>`, `latestShareholdingQuarter(): Promise<string | null>`.
- `shareholding.ts`:
  ```ts
  function previousQuarterEnd(q: string): string          // "2026-09-30" → "2026-06-30"; "2026-03-31" → "2025-12-31"
  function quarterLabel(q: string): string                 // "2026-09-30" → "Jul–Sep 2026"
  interface StakeHit { key: string; name: string; from: number; to: number; change: number }
  interface StakeScreener { holder: "FII" | "DII"; quarter: string; label: string; reported: number; total: number; hits: StakeHit[] }
  function rankStakeIncreases(holder: "FII" | "DII", members: { id: number; key: string; name: string }[], rows: ShareholdingRow[], latest: string, limit = 10): StakeScreener
  function isValidShareholding(r: ShareholdingRow): boolean
  ```
- [ ] **Step 1: Write failing tests** — quarter maths for all four quarter ends incl. year rollover; `quarterLabel("2026-12-31") === "Oct–Dec 2026"`; ranking: changes `+1.5, +0.2, 0, −0.4` → hits `[+1.5, +0.2]` only; a stock missing the previous quarter excluded; a row with a 2-quarters-old date not treated as previous; 12 increases → 10 hits; ties by key; `reported`/`total` counts; `isValidShareholding` rejects 101 and a sum of 102, accepts nulls.
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Apply migration 0008** to Tracker1; verify the table exists.
- [ ] **Step 6: Commit** `feat(db): quarterly shareholding storage and stake ranking`

---

### Task 2: Market cards and pop-up rows

**Files:** Modify `src/lib/api/market.ts`, `src/app/components/market/ScreenerGrid.tsx` (or a new `StakeScreenerCard.tsx`), `src/lib/view/popup.ts`, `src/lib/api/instrument.ts`; Test `tests/api/market.test.ts`, `tests/view/popup.test.ts`

**Interfaces:**
- `loadMarket` adds `stakes: { fii: StakeScreener; dii: StakeScreener } | null` (null when `latestShareholdingQuarter()` is null); one `listShareholding([latest, previous])` call.
- Cards (placed after the existing screeners, same card style): title `FII increased stake` / `DII increased stake`, sub-header `Jul–Sep 2026 · 164 / 200 reported`, rows: `StockLink` name, `48.1% → 49.6%` mono, `+1.5 pts` in up colour; 5 visible, `Show all` to 10. Empty states: no data → "Shareholding data appears after the quarterly update runs."; no increases → "No stake increases reported yet this quarter."
- Pop-up `indicatorTable` gains two rows after RS vs sector: `FII holding` → `49.6% (+1.5 pts vs Apr–Jun)` and `DII holding` likewise; "—" when absent.
- [ ] **Step 1: Write failing tests** — `loadMarket` with no shareholding rows → `stakes null`; with rows → both screeners; pop-up rows formatted as above and "—" when missing (table length grows by 2; update existing length assertion).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS.
- [ ] **Step 5: Verify manually** with 3 sample rows inserted for two quarters (then deleted): cards show the right order, labels and counts; pop-up rows show values.
- [ ] **Step 6: Commit** `feat(ui): FII and DII stake-increase screeners`

---

### Task 3: Claude instruction file (verified SQL)

**Files:** Create `docs/claude-tasks/shareholding.md`

Contents (written for Claude with the Supabase connector, project Tracker1 ref `shatrllqjurfjwykfhvk`):
1. **Target quarter:** the most recent quarter end whose filing deadline (quarter end + 21 days) has passed, computed from today's IST date; previous quarter = three months earlier.
2. **What's missing:** `select i.id, i.key, i.name from index_constituents c join instruments i on i.id = c.instrument_id where c.index_key = 'NIFTY200' and not exists (select 1 from shareholding s where s.instrument_id = i.id and s.quarter_end = $target) order by i.key limit 50;` — none → reply "All Nifty 200 shareholding for <label> is collected" and stop.
3. **Collect** for each stock: FII (FPI), DII (mutual funds + insurance + other domestic institutions as reported in the "DII" total) and promoter % for the target quarter **and** the previous quarter, from the company's shareholding pattern on a public source (BSE/NSE shareholding pattern pages, or a reputable aggregator showing the quarterly pattern). Record the page URL used.
4. **Validate** each row (0–100, sum ≤ 100.5); skip invalid ones and list them.
5. **Write** (one statement per stock, dollar-quoted strings):
   `insert into shareholding (instrument_id, quarter_end, fii_pct, dii_pct, promoter_pct, source_url) values ($id, $q, $fii, $dii, $promoter, $url) on conflict (instrument_id, quarter_end) do update set fii_pct = excluded.fii_pct, dii_pct = excluded.dii_pct, promoter_pct = excluded.promoter_pct, source_url = excluded.source_url, collected_at = now();` — for both quarters (the previous-quarter row is only inserted if missing: `on conflict do nothing` for that one).
6. **Finish** with a short note: collected n, skipped (with reasons), remaining count.
7. Never infer or estimate a figure; a stock whose pattern can't be found is skipped and retried next run.

- [ ] **Step 1:** Write the file.
- [ ] **Step 2:** Verify every SQL statement against Tracker1 with `execute_sql` (reads as written; writes inside `begin; … rollback;` with sample values).
- [ ] **Step 3: Commit** `docs: Claude task for quarterly shareholding`

---

### Task 4: Install the scheduled task (done in the Claude chat)

- [ ] **Step 1 (owner, in the Claude chat):** "stage 6b is built, set up the shareholding task". Claude creates scheduled task **Nifty shareholding update** with prompt = `docs/claude-tasks/shareholding.md`, schedule `CRON_TZ=Asia/Kolkata 0 19 22-28 1,4,7,10 *` plus a second task with `CRON_TZ=Asia/Kolkata 0 19 5-10 2,5,8,11 *` (late filers), and runs it once immediately for the Jul–Sep 2026 quarter (about 4 runs of 50 to cover all 200).
- [ ] **Step 2:** README: what the shareholding screeners mean (quarterly, percentage points), when the task runs, how to re-run it. Commit `docs: stage 6b`.
