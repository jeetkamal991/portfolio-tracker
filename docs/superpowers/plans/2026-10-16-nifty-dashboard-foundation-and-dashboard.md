# Nifty Dashboard — Foundation + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build spec build-order steps 1–2: the data foundation (schema, provider, EOD job, back-fill, history import) and the private Dashboard page (live strip, today's summary, sector heatmap, watchlist with support/resistance and overrides).

**Architecture:** Next.js App Router app on Vercel, Supabase Postgres + auth. All market logic lives in pure, unit-tested functions (`src/lib/calc`), a swappable data provider (`src/lib/provider`), and jobs that talk to storage only through a `Repo` interface, so jobs are tested with an in-memory repo and a fake provider. A Vercel cron calls the EOD route; long back-fills run as local scripts.

**Tech Stack:** Next.js 15 (App Router, TypeScript), React 19, Tailwind CSS, `@supabase/supabase-js` + `@supabase/ssr`, `yahoo-finance2`, `exceljs`, `zod`, Vitest, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-10-16-nifty-dashboard-design.md`

**Later plans (not in this one):** spec build-order 3 History, 4 Rotation, 5 Search, 6 Claude tasks. This plan creates their tables so later plans add code only.

## Global Constraints

- Node 20+. All commands must work in Windows PowerShell (npm scripts only, no bash-only syntax).
- All percentages are stored and passed as **fractions** (−0.0088 = −0.88%), matching `data/history.xlsx`. Only UI formatting multiplies by 100.
- All trading dates are **IST calendar dates** as `YYYY-MM-DD` strings, derived via `Asia/Kolkata`. Never use `toISOString().slice(0,10)` on a candle timestamp.
- Private app: every page and API route except `/login` and `/api/cron/*` requires a signed-in Supabase user. Cron routes require `Authorization: Bearer ${CRON_SECRET}`.
- `SUPABASE_SERVICE_ROLE_KEY` is used only in server code and scripts, never imported by a client component.
- No Claude API, no paid services. Free tiers of Vercel and Supabase only.
- EOD cron: `0 11 * * 1-5` (UTC) = 4:30 PM IST, Mon–Fri.
- Indicator definitions are exactly spec §3.4: EMA smoothing 2/(n+1) seeded with SMA of first n closes; RSI 14 Wilder; RS = trailing 20-trading-day (4-week) return minus Nifty 50's; swing window 60 days, 5 bars each side, merge within 1%; near-level within 1%.
- Provider fetches retry up to 3 times (1 s, 2 s, 4 s backoff).

## Review Focus

1. **IST date shift** — a Yahoo candle stamped 03:45 UTC or 18:30 UTC previous day must land on the correct IST date; a wrong shift silently mislabels every row. Pinned by `istDate` tests in Task 1 and the Yahoo mapping test in Task 7.
2. **One instrument fails, the rest must still save** — a single bad ticker or rate-limit must not abort the EOD run; status becomes `partial` and the rest are written. Pinned in Task 9.
3. **Holiday/weekend run** — when the newest candle is older than today (IST), nothing new is written for today and the run logs `no_session`. Pinned in Task 9.
4. **Manual levels survive the nightly job** — the EOD job updates only auto levels; a manual override stays until cleared, and clearing reverts to auto. Pinned in Tasks 9 and 13.
5. **Adding a stock Yahoo has no data for** — unknown or delisted symbols return a clear error and nothing is added to the watchlist. Pinned in Task 10.

---

## File Structure

```
supabase/migrations/0001_init.sql        schema + RLS
src/lib/time/ist.ts                       IST date + market-hours helpers
src/lib/calc/pct.ts                       pct change
src/lib/calc/ema.ts                       EMA series
src/lib/calc/rsi.ts                       RSI(14) Wilder series
src/lib/calc/returns.ts                   period returns, RS vs Nifty
src/lib/calc/levels.ts                    trend tag, near-level, effective level, distances
src/lib/calc/swing.ts                     swing support/resistance
src/lib/calc/indicators.ts                combines the above per date
src/lib/provider/types.ts                 MarketDataProvider interface, Candle, Quote
src/lib/provider/retry.ts                 withRetry
src/lib/provider/yahoo.ts                 Yahoo implementation (only file importing yahoo-finance2)
src/lib/instruments.ts                    fixed index/sector list + NSE CSV parser
src/lib/db/types.ts                       Instrument, StoredDay, IndicatorRow, Levels, JobRun
src/lib/db/repo.ts                        Repo interface
src/lib/db/supabaseRepo.ts                Repo over Supabase (service role)
src/lib/db/memoryRepo.ts                  Repo in memory (tests)
src/lib/supabase/{server,browser,admin}.ts  clients
src/lib/jobs/backfill.ts                  backfillInstrument, addStock
src/lib/jobs/eod.ts                       runEod
src/lib/import/history.ts                 parse history.xlsx
src/lib/live/quoteCache.ts                60 s quote cache
src/lib/view/dashboard.ts                 view-model builders
scripts/verify-tickers.ts | seed-instruments.ts | backfill.ts | import-history.ts | compare-import.ts
src/middleware.ts                         auth gate
src/app/login/page.tsx
src/app/page.tsx                          Dashboard
src/app/components/*                      LiveStrip, TodaySummary, SectorHeatmap, ClaudeCard, WatchlistTable, AddStock, AsOfBadge
src/app/api/cron/eod/route.ts
src/app/api/quotes/route.ts
src/app/api/instruments/search/route.ts
src/app/api/watchlist/route.ts            POST add
src/app/api/watchlist/[key]/route.ts      DELETE remove
src/app/api/levels/[key]/route.ts         PUT manual levels
vercel.json
tests/**                                  mirrors src/lib
```

---

### Task 1: Scaffold project and IST time helpers

**Files:**
- Create: Next.js app in repo root, `vitest.config.ts`, `.env.example`, `src/lib/time/ist.ts`
- Test: `tests/time/ist.test.ts`

**Interfaces:**
- Produces: `istDate(d: Date): string` (YYYY-MM-DD in Asia/Kolkata); `istNowParts(now: Date): { date: string; weekday: number /*0=Sun*/; minutes: number /*since IST midnight*/ }`; `isMarketOpen(now: Date): boolean` (Mon–Fri, 09:15 ≤ IST time ≤ 15:30); `addDays(date: string, n: number): string`.

- [ ] **Step 1: Scaffold.** In the existing folder run `npx create-next-app@15 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm` (keep existing `docs/` and `data/`). Then `npm i @supabase/supabase-js @supabase/ssr yahoo-finance2 exceljs zod` and `npm i -D vitest tsx @types/node`. Add scripts: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`. Create `vitest.config.ts` with `@` alias to `src`. Create `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Ensure `.env.local` is in `.gitignore`.

- [ ] **Step 2: Write the failing tests**

```ts
import { istDate, isMarketOpen, addDays } from "@/lib/time/ist";
test("UTC 18:30 previous day is next IST date", () => {
  expect(istDate(new Date("2026-10-15T18:30:00Z"))).toBe("2026-10-16");
});
test("NSE candle at 03:45 UTC stays same date", () => {
  expect(istDate(new Date("2026-10-16T03:45:00Z"))).toBe("2026-10-16");
});
test("market hours", () => {
  expect(isMarketOpen(new Date("2026-10-16T03:44:00Z"))).toBe(false); // 09:14 IST Fri
  expect(isMarketOpen(new Date("2026-10-16T03:45:00Z"))).toBe(true);  // 09:15
  expect(isMarketOpen(new Date("2026-10-16T10:00:00Z"))).toBe(true);  // 15:30
  expect(isMarketOpen(new Date("2026-10-16T10:01:00Z"))).toBe(false);
  expect(isMarketOpen(new Date("2026-10-17T05:00:00Z"))).toBe(false); // Saturday
});
test("addDays crosses month", () => expect(addDays("2026-09-30", 1)).toBe("2026-10-01"));
```

- [ ] **Step 3: Run** `npm test` — Expected: FAIL (module not found).
- [ ] **Step 4: Implement `src/lib/time/ist.ts`** using `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", ... })` parts. `addDays` works on UTC-noon dates to avoid DST issues.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck` — Expected: PASS.
- [ ] **Step 6: Commit** `git add -A && git commit -m "chore: scaffold Next.js app; feat: IST time helpers"`

---

### Task 2: Pct change, EMA, RSI

**Files:**
- Create: `src/lib/calc/pct.ts`, `src/lib/calc/ema.ts`, `src/lib/calc/rsi.ts`
- Test: `tests/calc/pct-ema-rsi.test.ts`

**Interfaces:**
- Produces: `pctChange(prev: number, close: number): number`; `emaSeries(closes: number[], period: number): (number | null)[]` (same length; `null` until index `period-1`; value at `period-1` = SMA of first `period`); `rsiSeries(closes: number[], period = 14): (number | null)[]` (Wilder; first value at index `period`).

- [ ] **Step 1: Write the failing tests**

```ts
test("pctChange is a fraction", () => expect(pctChange(100, 99.12)).toBeCloseTo(-0.0088, 6));
test("EMA seeded with SMA then smoothed", () => {
  const e = emaSeries([1, 2, 3, 4, 5, 6], 3);
  expect(e.slice(0, 2)).toEqual([null, null]);
  expect(e[2]).toBeCloseTo(2, 10);      // SMA(1,2,3)
  expect(e[3]).toBeCloseTo(3, 10);      // 4*0.5 + 2*0.5
  expect(e[5]).toBeCloseTo(5, 10);
});
test("EMA shorter than period is all null", () => expect(emaSeries([1, 2], 3)).toEqual([null, null]));
test("RSI all gains is 100, all losses is 0", () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 + i);
  expect(rsiSeries(up)[14]).toBe(100);
  expect(rsiSeries(up.slice().reverse())[14]).toBe(0);
  expect(rsiSeries(up)[13]).toBeNull();
});
test("RSI Wilder reference value", () => {
  // Wilder's classic 14-period sample (closes) → RSI at index 14 ≈ 70.53
  const c = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  expect(rsiSeries(c)[14]!).toBeCloseTo(70.53, 1);
});
```

- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** the three files. RSI: first avg gain/loss = simple mean of first 14 changes; then `avg = (prevAvg*13 + current)/14`; avgLoss 0 → 100.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(calc): pct change, EMA, RSI"` (add new files first).

---

### Task 3: Period returns, RS vs Nifty, trend and level helpers

**Files:**
- Create: `src/lib/calc/returns.ts`, `src/lib/calc/levels.ts`
- Test: `tests/calc/returns-levels.test.ts`

**Interfaces:**
- Produces:
  - `periodReturn(closes: number[], bars: number): number | null` — `closes.at(-1)/closes.at(-1-bars) - 1`, null if not enough.
  - `PERIODS = { d1: 1, w1: 5, m1: 21, m3: 63 } as const`
  - `rsVsNifty(dates: string[], closes: number[], nifty: Map<string, number>, bars = 20): (number | null)[]`
  - `type Trend = "above_both" | "between" | "below_both"`; `trendTag(cmp: number, ema50: number | null, ema200: number | null): Trend | null`
  - `effectiveLevel(auto: number | null, manual: number | null): number | null` (manual wins)
  - `pctFrom(cmp: number, ref: number): number` = `(cmp - ref)/ref`
  - `distanceToSupport(cmp, s) = (cmp - s)/cmp`; `distanceToResistance(cmp, r) = (r - cmp)/cmp`
  - `isNearLevel(cmp: number, level: number | null, tol = 0.01): boolean` = `|cmp - level|/cmp <= tol`

- [ ] **Step 1: Write the failing tests**

```ts
test("periodReturn", () => {
  expect(periodReturn([100, 110], 1)).toBeCloseTo(0.1);
  expect(periodReturn([100], 1)).toBeNull();
});
test("RS uses Nifty on the same dates", () => {
  const dates = Array.from({ length: 21 }, (_, i) => `d${i}`);
  const closes = dates.map((_, i) => (i === 20 ? 110 : 100));
  const nifty = new Map(dates.map((d, i) => [d, i === 20 ? 105 : 100]));
  const rs = rsVsNifty(dates, closes, nifty);
  expect(rs[19]).toBeNull();
  expect(rs[20]).toBeCloseTo(0.05);
});
test("RS null when Nifty missing a date", () => {
  const dates = Array.from({ length: 21 }, (_, i) => `d${i}`);
  expect(rsVsNifty(dates, dates.map(() => 1), new Map())[20]).toBeNull();
});
test("trendTag", () => {
  expect(trendTag(110, 100, 90)).toBe("above_both");
  expect(trendTag(95, 100, 90)).toBe("between");
  expect(trendTag(80, 100, 90)).toBe("below_both");
  expect(trendTag(80, 100, null)).toBeNull();
});
test("effective level and near-level", () => {
  expect(effectiveLevel(100, null)).toBe(100);
  expect(effectiveLevel(100, 95)).toBe(95);
  expect(isNearLevel(100, 99.0)).toBe(true);
  expect(isNearLevel(100, 98.9)).toBe(false);
  expect(isNearLevel(100, null)).toBe(false);
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): returns, RS, trend and level helpers`

---

### Task 4: Swing support/resistance

**Files:**
- Create: `src/lib/calc/swing.ts`
- Test: `tests/calc/swing.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `swingLevels(bars: { high: number; low: number }[], cmp: number, opts?: { lookback?: number /*60*/; side?: number /*5*/; mergeTol?: number /*0.01*/ }): { support: number | null; resistance: number | null }`

Algorithm (not determined by the signature):
1. Use the last `lookback` bars. Bar `i` is a swing high if `high[i]` is ≥ every high in `i-side..i+side` (excluding itself) and strictly greater than at least one; same for swing low with lows. Bars without `side` neighbours on both sides are not candidates.
2. Merge: sort candidate prices ascending; walk them, adding a price to the current cluster when `(price - clusterMean)/clusterMean <= mergeTol`; each cluster becomes its mean. Merge highs and lows separately.
3. `support` = largest merged swing low `< cmp`; `resistance` = smallest merged swing high `> cmp`; otherwise null.

- [ ] **Step 1: Write the failing tests**

```ts
const flat = (n: number, v: number) => Array.from({ length: n }, () => ({ high: v + 1, low: v - 1 }));
test("finds nearest swing low below and swing high above", () => {
  const bars = flat(30, 100);
  bars[10] = { high: 101, low: 90 };   // swing low 90
  bars[20] = { high: 112, low: 99 };   // swing high 112
  expect(swingLevels(bars, 100)).toEqual({ support: 90, resistance: 112 });
});
test("merges levels within 1%", () => {
  const bars = flat(40, 100);
  bars[10] = { high: 101, low: 90 };
  bars[25] = { high: 101, low: 90.5 };
  expect(swingLevels(bars, 100).support).toBeCloseTo(90.25);
});
test("ignores bars in the last 5 (no right neighbours)", () => {
  const bars = flat(30, 100);
  bars[27] = { high: 101, low: 80 };
  expect(swingLevels(bars, 100).support).toBeNull();
});
test("only last 60 bars are used", () => {
  const bars = flat(100, 100);
  bars[10] = { high: 101, low: 85 };
  expect(swingLevels(bars, 100).support).toBeNull();
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): swing support/resistance`

---

### Task 5: Indicator pipeline

**Files:**
- Create: `src/lib/calc/indicators.ts`, `src/lib/db/types.ts`
- Test: `tests/calc/indicators.test.ts`

**Interfaces:**
- Produces in `src/lib/db/types.ts`:
  ```ts
  type InstrumentType = "index" | "sector" | "stock";
  interface Instrument { id: number; key: string; name: string; type: InstrumentType; yahooTicker: string; active: boolean }
  interface StoredDay { date: string; open: number|null; high: number|null; low: number|null; close: number|null; volume: number|null; pctChange: number|null; importedPct: number|null; ema50: number|null; ema200: number|null; rsi14: number|null; rsVsNifty: number|null }
  interface IndicatorRow { date: string; pctChange: number|null; ema50: number|null; ema200: number|null; rsi14: number|null; rsVsNifty: number|null }
  interface Levels { autoSupport: number|null; autoResistance: number|null; manualSupport: number|null; manualResistance: number|null }
  type JobStatus = "ok" | "partial" | "no_session" | "failed";
  interface JobRun { job: string; startedAt: string; finishedAt: string; status: JobStatus; message: string }
  ```
- Produces: `computeIndicators(days: { date: string; close: number }[], nifty: Map<string, number>): IndicatorRow[]` — input ascending, one output per input; `pctChange` null for the first row.

- [ ] **Step 1: Write the failing test** — 250 synthetic closes (`100 + i`): row 0 pctChange null; row 1 pctChange `1/100`; `ema50` null at 48, non-null at 49; `ema200` null at 198, non-null at 199; `rsi14` = 100 at index 14; `rsVsNifty` = 0 when `nifty` is built from the same closes.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** by composing Tasks 2–3 functions. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): indicator pipeline`

---

### Task 6: Schema, Supabase clients, Repo

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`, `src/lib/supabase/admin.ts`, `src/lib/db/repo.ts`, `src/lib/db/supabaseRepo.ts`, `src/lib/db/memoryRepo.ts`
- Test: `tests/db/memoryRepo.test.ts`

**Interfaces:**
- Consumes: types from Task 5.
- Produces `Repo`:
  ```ts
  interface Repo {
    listInstruments(f?: { types?: InstrumentType[]; activeOnly?: boolean }): Promise<Instrument[]>;
    getInstrumentByKey(key: string): Promise<Instrument | null>;
    searchInstruments(q: string, limit: number): Promise<Instrument[]>; // stocks, key or name ILIKE
    upsertInstruments(rows: Omit<Instrument, "id">[]): Promise<void>;   // conflict on key
    upsertCandles(instrumentId: number, candles: Candle[]): Promise<void>; // writes OHLCV only
    getDays(instrumentId: number, limit: number): Promise<StoredDay[]>;     // newest `limit`, returned ascending
    upsertIndicators(instrumentId: number, rows: IndicatorRow[]): Promise<void>;
    upsertImportedPct(rows: { instrumentId: number; date: string; importedPct: number }[]): Promise<void>;
    listWatchlist(): Promise<Instrument[]>;
    addToWatchlist(instrumentId: number): Promise<void>;
    removeFromWatchlist(instrumentId: number): Promise<void>;
    getLevels(instrumentId: number): Promise<Levels>; // all-null if no row
    setAutoLevels(instrumentId: number, support: number | null, resistance: number | null): Promise<void>; // never touches manual_*
    setManualLevels(instrumentId: number, support: number | null, resistance: number | null): Promise<void>;
    logJobRun(run: JobRun): Promise<void>;
    lastJobRun(job: string): Promise<JobRun | null>;
  }
  ```
  (`Candle` comes from Task 7's `src/lib/provider/types.ts`; define that type file in this task so both compile: `interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number }`.)
- `memoryRepo.ts` exports `createMemoryRepo(seed?: { instruments?: Instrument[] }): Repo & { _days: Map<number, Map<string, StoredDay>> }`.

Schema (`0001_init.sql`) — tables from spec §3.2 with these exact columns:
- `instruments(id bigserial pk, key text unique not null, name text not null, type text not null check (type in ('index','sector','stock')), yahoo_ticker text not null, active boolean not null default true)`
- `daily_prices(instrument_id bigint references instruments on delete cascade, date date, open/high/low/close/volume numeric, pct_change numeric, imported_pct numeric, ema50 numeric, ema200 numeric, rsi14 numeric, rs_vs_nifty numeric, primary key (instrument_id, date))` — `imported_pct` replaces the spec's `source` column: imported days are those with `imported_pct` set; history views read `coalesce(pct_change, imported_pct)`.
- `watchlist(instrument_id bigint primary key references instruments on delete cascade, added_at timestamptz default now())`
- `levels(instrument_id bigint primary key references instruments on delete cascade, auto_support, auto_resistance, manual_support, manual_resistance numeric, updated_at timestamptz default now())`
- `rotation_snapshots(week_ending date, instrument_id bigint references instruments, rs_score numeric, rank int, grp text check (grp in ('sector','watchlist')), primary key (week_ending, instrument_id, grp))`
- `daily_summaries(date date primary key, summary text not null, market_events jsonb not null default '[]', watchlist_news jsonb not null default '[]', created_at timestamptz default now())`
- `reports(id bigserial pk, instrument_id bigint references instruments, status text check (status in ('pending','done','failed')) default 'pending', requested_at timestamptz default now(), completed_at timestamptz, requested_via text check (requested_via in ('site','chat')), content jsonb, error text)`
- `job_runs(id bigserial pk, job text, started_at timestamptz, finished_at timestamptz, status text, message text)`
- Enable RLS on every table; one policy per table: `for all to authenticated using (true) with check (true)`. (Signups are disabled, so the only authenticated user is the owner; the service role bypasses RLS.)
- Index `daily_prices (date)`.

- [ ] **Step 1: Write failing memory-repo contract tests:** `upsertCandles` then `upsertIndicators` on the same date keeps both OHLC and indicators; `upsertImportedPct` does not erase `close`; `getDays(id, 2)` returns the newest two ascending; `setAutoLevels` after `setManualLevels` leaves manual values unchanged; `getLevels` on unknown id returns all nulls.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `memoryRepo.ts`, then `supabaseRepo.ts` with the same semantics (PostgREST `upsert` with only the columns being written, `onConflict: "instrument_id,date"`; snake_case ↔ camelCase mapping in one place). Clients: `admin.ts` = service-role client (server only, throws if env missing); `server.ts` = `@supabase/ssr` cookie client; `browser.ts` = browser client.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — PASS.
- [ ] **Step 5: Apply the migration** to the Supabase project (paste into Supabase → SQL Editor, or use the Supabase MCP `apply_migration` if connected). Verify: SQL `select count(*) from information_schema.tables where table_schema='public'` returns 8.
- [ ] **Step 6: Commit** `feat(db): schema, Supabase clients, repo`

---

### Task 7: Data provider (Yahoo) and ticker verification

**Files:**
- Create: `src/lib/provider/retry.ts`, `src/lib/provider/yahoo.ts`, `scripts/verify-tickers.ts`; modify `src/lib/provider/types.ts`
- Test: `tests/provider/retry.test.ts`, `tests/provider/yahoo.test.ts`

**Interfaces:**
- Produces in `types.ts`:
  ```ts
  interface Quote { ticker: string; price: number; changePct: number /*fraction*/; prevClose: number; asOf: string /*ISO*/ }
  interface MarketDataProvider {
    getDailyHistory(ticker: string, fromDate: string, toDate: string): Promise<Candle[]>; // ascending, IST dates
    getQuotes(tickers: string[]): Promise<Quote[]>;
  }
  ```
- `withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 1000, sleep?: (ms: number) => Promise<void>): Promise<T>` — waits `baseMs * 2^(n-1)` between tries.
- `createYahooProvider(client?: YahooLike): MarketDataProvider` and exported pure mappers `mapChart(result): Candle[]`, `mapQuote(q): Quote`. `yahoo.ts` is the only file importing `yahoo-finance2` (handle its v2 default export / v3 `new YahooFinance()` style here only).

- [ ] **Step 1: Write the failing tests**

```ts
test("withRetry succeeds on 3rd try with 1s, 2s waits", async () => {
  const waits: number[] = []; let n = 0;
  const v = await withRetry(async () => { if (++n < 3) throw new Error("x"); return 7; }, 3, 1000, async ms => { waits.push(ms); });
  expect(v).toBe(7); expect(waits).toEqual([1000, 2000]);
});
test("withRetry rethrows after 3 failures", async () => {
  await expect(withRetry(async () => { throw new Error("boom"); }, 3, 1, async () => {})).rejects.toThrow("boom");
});
test("mapChart uses IST date and drops null closes", () => {
  const c = mapChart({ quotes: [
    { date: new Date("2026-10-15T18:30:00Z"), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { date: new Date("2026-10-16T03:45:00Z"), open: 1, high: 2, low: 0.5, close: null, volume: 0 },
  ]});
  expect(c).toEqual([{ date: "2026-10-16", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
});
test("mapQuote converts percent to fraction", () => {
  expect(mapQuote({ symbol: "^NSEI", regularMarketPrice: 25000, regularMarketChangePercent: -0.88, regularMarketPreviousClose: 25222, regularMarketTime: new Date("2026-10-16T09:00:00Z") }).changePct).toBeCloseTo(-0.0088);
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** Wrap each Yahoo call in `withRetry`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Verify tickers.** `scripts/verify-tickers.ts` (run with `npx tsx scripts/verify-tickers.ts`) fetches the last 10 days for every entry in `INDEX_INSTRUMENTS` (Task 8) and prints ticker, candle count, last date, last close. Candidates: `NIFTY50 ^NSEI`, `NIFTY_BANK ^NSEBANK`, `INDIAVIX ^INDIAVIX`, `NIFTY_AUTO ^CNXAUTO`, `NIFTY_FIN NIFTY_FIN_SERVICE.NS`, `NIFTY_FMCG ^CNXFMCG`, `NIFTY_IT ^CNXIT`, `NIFTY_MEDIA ^CNXMEDIA`, `NIFTY_METAL ^CNXMETAL`, `NIFTY_PHARMA ^CNXPHARMA`, `NIFTY_PSU_BANK ^CNXPSUBANK`, `NIFTY_PVT_BANK NIFTY_PVT_BANK.NS`, `NIFTY_HEALTHCARE NIFTY_HEALTHCARE.NS`. Expected: every row has ≥ 5 candles. For any that fail, find the working Yahoo symbol (Yahoo search for the index name), update `INDEX_INSTRUMENTS`, and re-run until all pass. Then compare the 16 Oct 2026 day % for NIFTY50 against `data/history.xlsx` (OCT sheet) — must match within 0.0005.
- [ ] **Step 6: Commit** `feat(provider): Yahoo provider with retry; verified index tickers`

---

### Task 8: Instrument list and seeding

**Files:**
- Create: `src/lib/instruments.ts`, `scripts/seed-instruments.ts`
- Test: `tests/instruments.test.ts`

**Interfaces:**
- Produces: `INDEX_INSTRUMENTS: Omit<Instrument, "id">[]` (the 13 from Task 7; `NIFTY50` and `INDIAVIX` type `index`, the 11 sector columns type `sector` — `NIFTY_BANK` is both Bank Nifty in the strip and the BANK sector); `STRIP_KEYS = ["NIFTY50", "NIFTY_BANK", "INDIAVIX"]`; `SECTOR_KEYS` (the 11 sector keys in sheet column order: AUTO, BANK, FIN, FMCG, IT, MEDIA, METAL, PHARMA, PSU_BANK, PVT_BANK, HEALTHCARE); `parseEquityCsv(csv: string): Omit<Instrument, "id">[]` — rows with `SERIES` = `EQ` → `{ key: SYMBOL, name: "NAME OF COMPANY", type: "stock", yahooTicker: SYMBOL + ".NS", active: true }`; header names trimmed; quoted fields with commas handled.

- [ ] **Step 1: Write failing tests:** `parseEquityCsv` on a 3-row sample (one `EQ`, one `BE`, one name containing a comma in quotes) returns one or two rows as appropriate with `.NS` tickers; `SECTOR_KEYS.length === 11`; every `STRIP_KEYS` key exists in `INDEX_INSTRUMENTS`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** `seed-instruments.ts` loads `.env.local` (use `process.loadEnvFile(".env.local")`), reads `data/EQUITY_L.csv`, and calls `repo.upsertInstruments([...INDEX_INSTRUMENTS, ...stocks])`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Seed.** Owner downloads the NSE equity list (`EQUITY_L.csv`, "Securities available for Equity segment" on nseindia.com) into `data/`. Add npm script `"seed": "tsx scripts/seed-instruments.ts"`, run `npm run seed`. Verify: SQL `select type, count(*) from instruments group by type` → index 2, sector 11, stock > 1500.
- [ ] **Step 6: Commit** `feat: instrument list and seeding` (`data/EQUITY_L.csv` stays local: `data/` is git-ignored, the file is downloaded by the owner, not committed).

---

### Task 9: EOD job and cron route

**Files:**
- Create: `src/lib/jobs/eod.ts`, `src/app/api/cron/eod/route.ts`, `vercel.json`
- Test: `tests/jobs/eod.test.ts` (fake provider + memory repo)

**Interfaces:**
- Consumes: `Repo`, `MarketDataProvider`, `computeIndicators`, `swingLevels`, `istDate`, `addDays`.
- Produces: `runEod(deps: { repo: Repo; provider: MarketDataProvider; now: Date; concurrency?: number /*5*/ }): Promise<JobRun>`; `refreshInstrument(deps, inst: Instrument, niftyCloses: Map<string, number>): Promise<"updated" | "no_session">` (also used by Task 10).

Behaviour:
1. Targets = active instruments of type index/sector + watchlist stocks. NIFTY50 is processed first (its closes feed RS for the rest).
2. Per instrument: `getDailyHistory(ticker, addDays(today, -10), today)` → `upsertCandles` → `getDays(id, 400)` → `computeIndicators` → `upsertIndicators` for the last 10 rows. Watchlist stocks also: `setAutoLevels` from `swingLevels(last 60 days, cmp = last close)`.
3. If the newest fetched candle's date ≠ today (IST) the instrument is `no_session` (still upsert what came back — it self-heals missed days).
4. An instrument that throws after retries is recorded in the message and skipped; others continue.
5. Status: all failed → `failed`; some failed → `partial`; none failed and all `no_session` → `no_session`; else `ok`. Message lists failed keys. Always `logJobRun({ job: "eod", ... })`.
6. Route: `GET`, checks `Authorization === "Bearer " + process.env.CRON_SECRET` (else 401), runs with Supabase repo + Yahoo provider, returns the JobRun JSON. `export const maxDuration = 60`.
7. `vercel.json`: `{ "crons": [{ "path": "/api/cron/eod", "schedule": "0 11 * * 1-5" }] }`.

- [ ] **Step 1: Write failing tests** (fixed `now = 2026-10-16T11:00:00Z`, fake provider returning 260 synthetic candles ending `2026-10-16` per ticker):
  - `ok` run writes today's row with `close`, `pctChange`, `ema50`, `ema200` non-null for NIFTY50.
  - Re-running produces identical rows (idempotent).
  - Provider whose newest candle is `2026-10-15` → status `no_session`, no row for `2026-10-16`.
  - One ticker throwing → status `partial`, message contains that key, other instruments have today's row.
  - Watchlist stock gets auto levels; a pre-set manual support is unchanged after the run.
  - A `job_runs` entry is logged in every case.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(jobs): EOD job and cron route`

---

### Task 10: Back-fill and add-stock

**Files:**
- Create: `src/lib/jobs/backfill.ts`, `scripts/backfill.ts`
- Test: `tests/jobs/backfill.test.ts`

**Interfaces:**
- Produces: `backfillInstrument(deps: { repo; provider; now: Date }, inst: Instrument, fromDate: string): Promise<number /*candles stored*/>` — fetch full range, `upsertCandles`, recompute indicators over all stored days, `upsertIndicators` for all rows, set auto levels if the instrument is on the watchlist.
- `addStock(deps, key: string): Promise<{ ok: true } | { ok: false; error: "unknown_symbol" | "no_data" | "already_added" }>` — instrument must exist with type `stock`; back-fill from `addDays(today, -730)`; 0 candles → `no_data` and nothing added; then `addToWatchlist` and set auto levels.
- Script: `npm run backfill -- --from 2015-01-01` back-fills all index/sector instruments sequentially (NIFTY50 first), printing per-instrument counts.

- [ ] **Step 1: Write failing tests:** `addStock("NOPE")` → `unknown_symbol`; provider returning `[]` → `no_data` and watchlist empty; success → watchlist has it, `ema200` present on last day for 500 synthetic candles, levels row exists; second add → `already_added`; a stock with only 120 candles has `ema200` null on its last day (UI shows "not enough history").
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Back-fill for real.** Add npm script `"backfill": "tsx scripts/backfill.ts"`, run `npm run backfill -- --from 2015-01-01`. Verify: SQL `select i.key, count(*), max(d.date) from daily_prices d join instruments i on i.id=d.instrument_id group by 1` — 13 rows, each > 1000 days (sectors that started later may have fewer), max date = last trading day.
- [ ] **Step 6: Commit** `feat(jobs): back-fill and add-stock`

---

### Task 11: History import and comparison check

**Files:**
- Create: `src/lib/import/history.ts`, `scripts/import-history.ts`, `scripts/compare-import.ts`
- Test: `tests/import/history.test.ts` (builds a workbook in memory with exceljs)

**Interfaces:**
- Produces:
  - `HEADER_TO_KEY: Record<string, string>` — `NIFTY→NIFTY50, AUTO→NIFTY_AUTO, BANK→NIFTY_BANK, Financial→NIFTY_FIN, FMCG→NIFTY_FMCG, IT→NIFTY_IT, MEDIA→NIFTY_MEDIA, METAL→NIFTY_METAL, PHARMA→NIFTY_PHARMA, PSU BANK→NIFTY_PSU_BANK, PVT BANK→NIFTY_PVT_BANK, HEALTHCARE→NIFTY_HEALTHCARE` (headers matched after trim).
  - `parseHistoryWorkbook(buf: Buffer): Promise<{ rows: { key: string; date: string; pct: number }[]; report: { sheets: number; dates: number; values: number; blanks: number; outliers: { key: string; date: string; pct: number }[]; unknownHeaders: string[] } }>` — every sheet; row 1 headers; skip rows whose first cell is not a date (the `Total` row and empties); blank cells counted in `blanks` and skipped; outlier = `|pct| > 0.1`. Dates from Excel cells are read with their **local Y-M-D components** (no UTC shift).
  - `scripts/import-history.ts [--dry-run]` reads `data/history.xlsx`, prints the report; without `--dry-run` writes via `repo.upsertImportedPct`.
  - `scripts/compare-import.ts` prints every (key, date) where both `pct_change` and `imported_pct` exist and differ by more than 0.0005, then a count. Exit code 0 always.

- [ ] **Step 1: Write failing tests** with a workbook of two sheets mirroring the real layout (`'Date '` header with trailing space, `'Financial '`, a `Total` row, an empty row, one blank cell, one value 0.15): rows have trimmed keys mapped via `HEADER_TO_KEY`; `Total` excluded; date `2026-10-01` read as `"2026-10-01"`; `blanks === 1`; one outlier reported; an extra header `FOO` appears in `unknownHeaders`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Import for real.** `npx tsx scripts/import-history.ts --dry-run` → expected report: 3 sheets, 42 dates (AUG 12, SEP 19, OCT 11), 11 blanks, no unknown headers. Then run without `--dry-run`, then `npx tsx scripts/compare-import.ts` and show the owner the mismatch list (expected: few or none; investigate any > 0.002).
- [ ] **Step 6: Commit** `feat(import): history.xlsx import and comparison check`

---

### Task 12: Login and auth gate

**Files:**
- Create: `src/middleware.ts`, `src/app/login/page.tsx`, `src/app/login/actions.ts`

**Interfaces:**
- Consumes: `src/lib/supabase/server.ts`.
- Produces: unauthenticated requests to any path except `/login`, `/api/cron/*`, `/_next/*`, static files → redirect to `/login` (API routes return 401 JSON instead of redirect). Login uses `signInWithPassword`; a "Sign out" server action used by the Dashboard header.

- [ ] **Step 1: Implement** middleware (standard `@supabase/ssr` session-refresh pattern) and a minimal email/password login form; failed sign-in shows "Wrong email or password".
- [ ] **Step 2: Owner setup (manual, by the owner):** Supabase → Authentication → Users → Add user (your email + password); Authentication → Sign In / Providers → disable "Allow new users to sign up".
- [ ] **Step 3: Verify** with `npm run dev`: `/` redirects to `/login`; `curl http://localhost:3000/api/quotes` returns 401; after the owner signs in, `/` loads.
- [ ] **Step 4: Commit** `feat(auth): login page and auth gate`

---

### Task 13: API routes — quotes, search, watchlist, levels

**Files:**
- Create: `src/lib/live/quoteCache.ts`, `src/app/api/quotes/route.ts`, `src/app/api/instruments/search/route.ts`, `src/app/api/watchlist/route.ts`, `src/app/api/watchlist/[key]/route.ts`, `src/app/api/levels/[key]/route.ts`
- Test: `tests/live/quoteCache.test.ts`, `tests/api/levels.test.ts`

**Interfaces:**
- `createQuoteCache(fetcher: (tickers: string[]) => Promise<Quote[]>, ttlMs = 60_000, clock = Date.now): { get(tickers: string[]): Promise<Quote[]> }` — returns cached quotes younger than ttl, fetches only the missing/expired tickers; on fetch error returns stale cached quotes where available and rethrows only if none.
- `GET /api/quotes` → `{ quotes: Quote[]; marketOpen: boolean }` for STRIP_KEYS + watchlist tickers.
- `GET /api/instruments/search?q=` → up to 10 `{ key, name }` stocks; `q` shorter than 2 chars → `[]`.
- `POST /api/watchlist` body `{ key }` → `addStock` result; 400 with `{ error }` on failure. `export const maxDuration = 60`.
- `DELETE /api/watchlist/[key]` → 204.
- `PUT /api/levels/[key]` body validated with zod `{ manualSupport: number | null, manualResistance: number | null }` (positive numbers or null) → `setManualLevels`; returns the updated `Levels`. Handler logic lives in an exported `handleLevelsPut(repo, key, body)` so it is testable.

- [ ] **Step 1: Write failing tests:** cache serves second call within 60 s without calling fetcher; after 61 s refetches; fetch error with cached data returns stale; `handleLevelsPut` with `{ manualSupport: 95, manualResistance: null }` stores manual support and leaves auto values; sending both null clears overrides so `effectiveLevel` returns auto; negative number → validation error; unknown key → 404.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** Route handlers use the Supabase repo built on `admin.ts` after the middleware has authenticated the request.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(api): quotes, search, watchlist, levels`

---

### Task 14: Dashboard — strip, summary, sector heatmap, Claude card

**Files:**
- Create: `src/lib/view/dashboard.ts`, `src/app/page.tsx`, `src/app/components/{LiveStrip,TodaySummary,SectorHeatmap,ClaudeCard,AsOfBadge}.tsx`
- Test: `tests/view/dashboard.test.ts`

**Interfaces:**
- Produces in `dashboard.ts`:
  - `buildSectorRows(series: { key: string; name: string; days: StoredDay[] }[]): { key; name; d1; w1; m1; m3: number | null; trend: Trend | null }[]` in `SECTOR_KEYS` order.
  - `heatColor(value: number | null, period: "d1" | "w1" | "m1" | "m3"): string` — diverging green/red, saturating at ±0.02 / 0.05 / 0.10 / 0.15; null → neutral grey.
  - `buildAsOf(latestNiftyDate: string | null, lastRun: JobRun | null): { date: string | null; stale: boolean }` — stale when the last EOD run status is `failed` or `partial`.
- Page layout (top to bottom): header (title, sign out), LiveStrip, ClaudeCard, TodaySummary (Nifty + Bank Nifty latest `pctChange`), SectorHeatmap, Watchlist (Task 15). AsOfBadge in header: "Data as of DD Mon YYYY", amber when stale.
- LiveStrip (client): polls `/api/quotes` every 60 s only while `marketOpen`; shows price and day % (green/red); outside market hours shows the last close from server props and the label "Closed".
- ClaudeCard: reads today's `daily_summaries` row; none → "No summary for today". (Content rendering is filled in by the Claude-tasks plan.)
- Formatting: percentages `±0.00%`; prices `en-IN` grouping. Tables in `overflow-x-auto` wrappers.

- [ ] **Step 1: Write failing tests:** `buildSectorRows` with 70 days gives non-null m3 and correct w1 (`c[n-1]/c[n-6]-1`); with 30 days m3 is null; `heatColor(0.03,"d1")` equals `heatColor(0.05,"d1")` (saturated); `buildAsOf` stale for `partial`, not stale for `no_session`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** view model, then components and page.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` — PASS.
- [ ] **Step 5: Verify visually** with `npm run dev`: signed in, the heatmap shows 11 sectors with colours, today's summary shows Nifty's last % matching the last row of `data/history.xlsx` (16 Oct 2026), ClaudeCard says "No summary for today", layout readable at 390 px width.
- [ ] **Step 6: Commit** `feat(ui): dashboard strip, summary, sector heatmap`

---

### Task 15: Watchlist table, add stock, inline levels

**Files:**
- Create: `src/app/components/WatchlistTable.tsx`, `src/app/components/AddStock.tsx`; modify `src/lib/view/dashboard.ts`, `src/app/page.tsx`
- Test: extend `tests/view/dashboard.test.ts`

**Interfaces:**
- Produces: `buildWatchlistRow(input: { key: string; name: string; lastDay: StoredDay; levels: Levels }, cmp: number): WatchlistRow` where
  ```ts
  interface WatchlistRow { key; name; cmp: number; dayPct: number | null; ema50: number | null; ema200: number | null;
    fromEma50: number | null; fromEma200: number | null; trend: Trend | null;
    support: number | null; resistance: number | null; supportIsManual: boolean; resistanceIsManual: boolean;
    toSupport: number | null; toResistance: number | null; nearLevel: boolean; notEnoughHistory: boolean }
  ```
  `cmp` = live quote price when available, else `lastDay.close`; `dayPct` = live `changePct` when available, else `lastDay.pctChange`. `notEnoughHistory` = `ema200 === null`.
- WatchlistTable (client): columns per spec §4.1; near-level rows highlighted; manual levels show an "M" badge; clicking a level opens an inline number input — Enter saves via `PUT /api/levels/[key]`, empty input clears that override (sends null); remove button per row (`DELETE`); EMA 200 cell shows "not enough history" when flagged. Receives live quotes from the same polling source as LiveStrip (lift the poller into a shared client context `QuotesProvider`).
- AddStock (client): debounced (250 ms) search via `/api/instruments/search`, list of `name (KEY)`, select → `POST /api/watchlist` with a "Adding… fetching history" state; errors shown inline: `unknown_symbol` "Symbol not found", `no_data` "No price data for this stock", `already_added` "Already on your watchlist".

- [ ] **Step 1: Write failing tests:** `buildWatchlistRow` — manual support overrides auto and sets `supportIsManual`; cmp 100 with support 99.2 → `nearLevel` true; `fromEma50` = `(cmp-ema50)/ema50`; `toResistance` = `(r-cmp)/cmp`; `ema200` null → `notEnoughHistory` true and `trend` null.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** builder, `QuotesProvider`, components.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` — PASS.
- [ ] **Step 5: Verify manually:** add two stocks by typing part of their names; both appear with EMAs and auto levels; set a manual support → "M" badge, survives page reload; clear it → auto value returns; add a nonsense string → no result offered; remove a stock → row disappears.
- [ ] **Step 6: Commit** `feat(ui): watchlist with add stock and level overrides`

---

### Task 16: Deploy and first-week check

**Files:**
- Modify: `README.md` (setup, env vars, scripts, how to run each job)

- [ ] **Step 1:** Write `README.md`: prerequisites, `.env.local` keys, `npm run seed`, `npm run backfill -- --from 2015-01-01`, import commands, `npm run dev`, deploy steps below.
- [ ] **Step 2 (owner):** create a private GitHub repo, push. In Vercel: import the repo, add the four env vars (generate `CRON_SECRET` as a long random string), deploy.
- [ ] **Step 3: Verify cron route** in production: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<app>.vercel.app/api/cron/eod` returns a JobRun with status `ok` (or `no_session` on a holiday); without the header returns 401. Vercel → Settings → Cron Jobs lists `/api/cron/eod` at `0 11 * * 1-5`.
- [ ] **Step 4: First-week check:** for the next 5 trading days, after 4:30 PM IST, the owner keeps logging manually; run `npx tsx scripts/import-history.ts` with the updated sheet then `npx tsx scripts/compare-import.ts`. Expected: no differences above 0.0005. Any larger mismatch is investigated before stopping the manual log.
- [ ] **Step 5: Commit** `docs: README with setup and deploy`
