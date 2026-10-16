# Nifty Dashboard — Step 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, login-protected Next.js app whose database holds two years of daily prices and indicators for Nifty, Bank Nifty, VIX and the sector indices, merged with the owner's imported manual history, and refreshed automatically every weekday by an EOD job.

**Architecture:** Pure calculation functions (`lib/calc`) and a pure row builder (`lib/prices/buildRows`) do all the maths; a provider module (`lib/provider`) is the only code that talks to Yahoo; a `PriceStore` interface is the only code the jobs use to talk to Supabase, so jobs are tested against an in-memory store. One function, `refreshInstrument`, serves both the EOD job and back-fill: an instrument with no stored rows gets ~2 years fetched, otherwise only recent days.

**Tech Stack:** Next.js (App Router, TypeScript, latest stable from `create-next-app@latest`), Supabase (Postgres, Auth, `@supabase/supabase-js`, `@supabase/ssr`), Vitest, `exceljs` (history import), `tsx` (scripts), Vercel (Hobby) cron.

**Spec:** `docs/superpowers/specs/2026-10-16-nifty-dashboard-design.md`

This plan covers build-order step 1 only. Steps 2–6 (Dashboard, History, Rotation, Search, Claude tasks) each get their own plan when this one ships.

## Global Constraints

- Free tiers only: Vercel Hobby, Supabase Free. No Claude API.
- Provider: Yahoo Finance behind the provider interface; nothing outside `lib/provider/` may reference Yahoo.
- `% change = (close − previous close) / previous close × 100`.
- EMA 50/200 on daily closes, `k = 2/(n+1)`, seeded with the SMA of the first n closes.
- RSI 14-period, Wilder smoothing.
- Relative strength = instrument's trailing 4-week return − Nifty 50's trailing 4-week return. **4 weeks = 20 trading days.**
- Swing levels: last 60 trading days; swing high/low = bar whose high/low is the extreme of the 5 bars on each side; levels within 1% merged; support = nearest merged swing low below CMP, resistance = nearest merged swing high above CMP.
- EOD job: Mon–Fri 4:30 PM IST = cron `0 11 * * 1-5` (UTC). Each fetch retried up to 3 times (4 attempts total).
- History import writes `source = 'import'`; provider writes `source = 'provider'`.
- Unique key on `daily_prices (instrument_id, date)`; every job is idempotent (re-running a day upserts the same rows).
- Dates are stored as IST calendar dates (`YYYY-MM-DD`, `Asia/Kolkata`).
- Back-fill depth: 730 calendar days.
- Secrets live in `.env.local` (git-ignored) and Vercel env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`. `data/` is git-ignored (private history file).

**Decisions made while planning (not in the spec):**
- **Import vs provider on the same date:** the provider fills OHLC and indicators; the imported `pct_change` is kept and the row keeps `source = 'import'`. `source` therefore means "where pct_change came from". This applies whichever runs first.
- **Yahoo has no daily history** for `^CNXMEDIA`, `NIFTY_PVT_BANK.NS` and `NIFTY_HEALTHCARE.NS` (verified 2026-10-16: only the current day's bar). These sectors build history forward from the EOD job; indicators show "not enough history" until enough bars exist. All other index tickers return 2 years.
- **Trading-session detection:** the EOD job refreshes Nifty 50 first; if Nifty's newest provider date is not later than its newest stored date, the run is `no_session` and nothing is written.
- **Single owner via RLS:** policies grant full access to the `authenticated` role, and public sign-ups are disabled in Supabase Auth, so the owner is the only authenticated user. Jobs and scripts use the secret key (bypasses RLS).
- **Bank Nifty** is seeded as `type = 'index'` (the sheet's `BANK` column maps to it).
- **NSE equity list** is loaded from a locally downloaded `EQUITY_L.csv` (NSE blocks scripted downloads).

## Review Focus

1. **Yahoo bars with null close, or two bars on the same IST date** (seen live: `^NSEI` has a null-close bar; thin tickers return a 15:31 bar) → nulls dropped, one bar per date (last wins). Test in Task 4.
2. **Holiday, weekend or re-run on the same day** → `no_session`, zero rows written, `job_runs` says so. Test in Task 7.
3. **Import and provider rows on the same date, in either order** → imported pct_change survives, OHLC/indicators filled. Tests in Task 5 (provider after import) and Task 8 (import after provider).
4. **Instruments with short history** (the three thin sectors, recent listings) → ema200/rsi/rs/levels are `null`, nothing throws. Tests in Tasks 2 and 5.
5. **One instrument's fetch fails** → the others are still written, the failed one keeps its last good data, the job is `partial` and names the symbol. Test in Task 7.

---

## File Structure

```
app/
  layout.tsx, page.tsx              # page.tsx: minimal "foundation status" (latest Nifty rows + last job run)
  login/page.tsx, login/actions.ts  # email+password login
  api/cron/eod/route.ts             # Vercel cron entry
lib/
  calc/indicators.ts (+ .test.ts)   # pctChanges, ema, rsi, trailingReturn, trendTag
  calc/swingLevels.ts (+ .test.ts)  # swing detection, merge, support/resistance
  provider/types.ts                 # Candle, Quote, MarketDataProvider
  provider/yahoo.ts (+ .test.ts)    # Yahoo v8 chart implementation
  provider/retry.ts (+ .test.ts)    # withRetry
  provider/index.ts                 # getProvider()
  prices/types.ts                   # Instrument, StoredRow, PriceRow, AutoLevels
  prices/buildRows.ts (+ .test.ts)  # pure: stored + candles + nifty → rows to upsert, auto levels
  prices/refresh.ts (+ .test.ts)    # refreshInstrument (uses PriceStore + provider)
  prices/store.ts                   # PriceStore interface
  prices/memoryStore.ts             # in-memory PriceStore for tests
  prices/supabaseStore.ts           # Supabase PriceStore
  jobs/eod.ts (+ .test.ts)          # runEod
  jobs/mapLimit.ts                  # bounded concurrency
  import/parseHistory.ts (+ .test.ts)  # workbook → ImportRow[], dry-run report
  supabase/server.ts, browser.ts, admin.ts
  auth/publicPaths.ts (+ .test.ts)
middleware.ts                       # (or proxy.ts — use the convention the installed Next version uses)
scripts/
  check-tickers.ts, backfill.ts, seed-equities.ts, import-history.ts
supabase/migrations/
  20261016000000_init.sql
  20261016000100_seed_instruments.sql
vercel.json
```

---

### Task 1: Project scaffold

**Files:**
- Create: Next.js app at repo root, `vitest.config.ts`, `.gitignore` additions, `.env.local.example`

**Interfaces:**
- Produces: `npm run dev`, `npm test` (Vitest, `@/` alias → repo root), `npm run script -- <file>` (runs `tsx --env-file=.env.local`).

- [ ] **Step 1:** `git init`, then `npx create-next-app@latest . --ts --app --eslint --tailwind --no-src-dir --import-alias "@/*" --use-npm` (answer prompts with defaults; keep existing `docs/` and `data/`).
- [ ] **Step 2:** `npm i @supabase/supabase-js @supabase/ssr exceljs` and `npm i -D vitest tsx @types/node`. Add scripts: `"test": "vitest run"`, `"script": "tsx --env-file=.env.local"`. Create `vitest.config.ts` with the `@` alias and `environment: 'node'`.
- [ ] **Step 3:** Append to `.gitignore`: `data/`, `.env*.local`. Create `.env.local.example` listing the four env var names from Global Constraints with empty values.
- [ ] **Step 4:** Add `lib/smoke.test.ts` with `expect(1 + 1).toBe(2)`. Run `npm test` → 1 passed. Run `npm run dev` → `http://localhost:3000` serves the starter page. Delete the smoke test.
- [ ] **Step 5:** Commit: `chore: scaffold Next.js app with Vitest`.

---

### Task 2: Indicator calculations

**Files:**
- Create: `lib/calc/indicators.ts`, `lib/calc/indicators.test.ts`

**Interfaces:**
- Produces (all pure; arrays aligned with input, `null` where not computable):
  - `pctChanges(closes: number[]): (number | null)[]` — index 0 is `null`.
  - `ema(closes: number[], n: number): (number | null)[]`
  - `rsi(closes: number[], n = 14): (number | null)[]` — first value at index `n`.
  - `trailingReturn(closes: number[], lookback: number): (number | null)[]` — `(c[i]/c[i−lookback] − 1) × 100`.
  - `type TrendTag = 'above' | 'between' | 'below'`
  - `trendTag(close: number, ema50: number | null, ema200: number | null): TrendTag | null` — `null` if either EMA is null; `'between'` covers every case that isn't above both or below both.

- [ ] **Step 1: Write the failing tests** (`toBeCloseTo(x, 2)` unless noted)

```ts
const C = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,45.64];

test('pctChanges', () => expect(pctChanges([100, 101, 99.99])).toEqual([null, expect.closeTo(1, 6), expect.closeTo(-1, 6)]));
test('ema seeds with SMA then smooths', () => {
  expect(ema([1,2,3,4,5], 3)).toEqual([null, null, 2, 3, 4]);
  const e = ema(C, 10);
  expect(e[8]).toBeNull(); expect(e[9]).toBeCloseTo(44.779, 3); expect(e[19]).toBeCloseTo(45.8704, 3);
});
test('ema shorter than n is all null', () => expect(ema([1,2], 3)).toEqual([null, null]));
test('rsi Wilder reference', () => {
  const r = rsi(C, 14);
  expect(r[13]).toBeNull();
  expect(r.slice(14).map(v => +v!.toFixed(2))).toEqual([70.46, 66.25, 66.48, 69.35, 66.29, 57.92]);
});
test('rsi is 100 when there are no losses', () => expect(rsi([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15])[14]).toBe(100));
test('trailingReturn', () => expect(trailingReturn([100, 110, 121], 2)).toEqual([null, null, expect.closeTo(21, 6)]));
test('trendTag', () => {
  expect(trendTag(110, 100, 105)).toBe('above');
  expect(trendTag(90, 100, 105)).toBe('below');
  expect(trendTag(102, 100, 105)).toBe('between');
  expect(trendTag(110, 100, null)).toBeNull();
});
```

- [ ] **Step 2:** `npx vitest run lib/calc/indicators.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement the five functions in `lib/calc/indicators.ts`. RSI: average gain/loss of the first `n` changes is the seed, then `avg = (avg × (n−1) + current) / n`; RSI = 100 when average loss is 0.
- [ ] **Step 4:** Re-run → all pass.
- [ ] **Step 5:** Commit: `feat(calc): % change, EMA, RSI, trailing return, trend tag`.

---

### Task 3: Swing support/resistance

**Files:**
- Create: `lib/calc/swingLevels.ts`, `lib/calc/swingLevels.test.ts`

**Interfaces:**
- Produces:
  - `type Bar = { high: number; low: number }`
  - `swingLevels(bars: Bar[], cmp: number, opts = { window: 60, side: 5, mergePct: 1 }): { support: number | null; resistance: number | null }`

Algorithm (not determined by the signature):
1. Take the last `window` bars. Index `i` is a swing high if `side` bars exist on both sides and `high[i] >= every high in i−side..i+side`; same for swing low with `low[i] <=`.
2. Merge separately for highs and lows: sort ascending, walk building clusters; a value joins the current cluster if `(value − clusterFirst) / clusterFirst × 100 <= mergePct`; the merged level is the cluster mean.
3. support = largest merged low `< cmp`; resistance = smallest merged high `> cmp`; `null` when none.

- [ ] **Step 1: Write the failing tests**

```ts
const lows = [10,9,8,7,6,5,6,7,8,9,10,11,12,13,14,15,14,13,12,11,10];
const bars = lows.map(l => ({ low: l, high: l + 1 }));

test('finds V-bottom support and peak resistance', () =>
  expect(swingLevels(bars, 12)).toEqual({ support: 5, resistance: 16 }));
test('nothing below/above CMP gives null', () =>
  expect(swingLevels(bars, 4)).toEqual({ support: null, resistance: 16 }));
test('bars without 5 neighbours each side are not swings', () =>
  expect(swingLevels(bars.slice(0, 8), 7)).toEqual({ support: null, resistance: null }));
test('levels within 1% merge to their mean', () => {
  // two swing lows at 100 and 100.5, separated by a bump, CMP well above
  const l = [110,108,106,104,102,100,102,104,106,108,110,108,106,104,102,100.5,102,104,106,108,110];
  expect(swingLevels(l.map(x => ({ low: x, high: x + 1 })), 120).support).toBeCloseTo(100.25, 6);
});
test('only the last 60 bars are considered', () => {
  const old = [...bars.slice(0, 11)];                      // swing low 5 at index 5
  const flat = Array.from({ length: 60 }, () => ({ low: 50, high: 51 }));
  expect(swingLevels([...old, ...flat], 60).support).not.toBe(5);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → pass.
- [ ] **Step 5:** Commit: `feat(calc): swing support/resistance levels`.

---

### Task 4: Provider module (Yahoo) with retry

**Files:**
- Create: `lib/provider/types.ts`, `lib/provider/yahoo.ts`, `lib/provider/yahoo.test.ts`, `lib/provider/retry.ts`, `lib/provider/retry.test.ts`, `lib/provider/index.ts`, `scripts/check-tickers.ts`

**Interfaces:**
- Produces:
  - `type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number }` (date = IST `YYYY-MM-DD`)
  - `type Quote = { ticker: string; price: number; changePct: number | null; asOf: string }` (asOf = ISO timestamp)
  - `interface MarketDataProvider { getDailyHistory(ticker: string, from: string, to: string): Promise<Candle[]>; getQuotes(tickers: string[]): Promise<Quote[]> }`
  - `class ProviderError extends Error { constructor(message: string, public readonly kind: 'not_found' | 'transient') }`
  - `createYahooProvider(fetchImpl: typeof fetch = fetch): MarketDataProvider`
  - `getProvider(): MarketDataProvider` (returns the Yahoo one)
  - `withRetry<T>(fn: () => Promise<T>, opts?: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<T>` — default `retries: 3`, delays `baseDelayMs × 2^attempt` (default 1000); never retries a `ProviderError` of kind `'not_found'`.

Yahoo details: `GET https://query1.finance.yahoo.com/v8/finance/chart/{encodeURIComponent(ticker)}?period1={unix}&period2={unix}&interval=1d` with header `User-Agent: Mozilla/5.0`. Read `chart.result[0].timestamp[]` and `indicators.quote[0].{open,high,low,close,volume}[]`. `chart.error.code === 'Not Found'` → `ProviderError('…', 'not_found')`; HTTP ≥ 500, 429, or network error → `'transient'`. Convert each timestamp to an IST date with `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })`. Drop bars whose close is null; when two bars share a date keep the later one; return sorted ascending. `getQuotes`: for each ticker (concurrently) fetch `range=5d&interval=1d`; `price = meta.regularMarketPrice`, `changePct` from the last two cleaned closes (null if fewer than two), `asOf` from `meta.regularMarketTime`.

- [ ] **Step 1: Write failing tests** with a fake `fetchImpl` returning canned chart JSON:

```ts
test('normalises bars: IST dates, drops null closes, one bar per date', async () => {
  // timestamps: 2026-10-15 09:15 IST, 2026-10-16 09:15 IST (close null), 2026-10-16 15:31 IST
  const p = createYahooProvider(fakeFetch(chart([1792035900, 1792122300, 1792144867], [22997.35, null, 23146.15])));
  expect(await p.getDailyHistory('^NSEI', '2026-10-01', '2026-10-16')).toEqual([
    expect.objectContaining({ date: '2026-10-15', close: 22997.35 }),
    expect.objectContaining({ date: '2026-10-16', close: 23146.15 }),
  ]);
});
test('Not Found becomes ProviderError not_found', async () => {
  const p = createYahooProvider(fakeFetch({ chart: { result: null, error: { code: 'Not Found', description: 'x' } } }));
  await expect(p.getDailyHistory('NOPE.NS', '2026-10-01', '2026-10-16')).rejects.toMatchObject({ kind: 'not_found' });
});
test('getQuotes computes day % from last two closes', async () => { /* closes [100, 101] → changePct 1 */ });
```
`retry.test.ts`: succeeds on 3rd attempt (fn called 3×); gives up after 4 calls with `retries: 3` and rethrows; `not_found` is called once. Use `sleep: async () => {}`.

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → pass.
- [ ] **Step 5:** Create `scripts/check-tickers.ts`: for the 13 seeded tickers (Task 6 list), fetch 730 days and print `ticker  bars  firstDate  lastDate`. Run `npm run script -- scripts/check-tickers.ts`. Expected: ~495 bars for 10 tickers; 1 bar for `^CNXMEDIA`, `NIFTY_PVT_BANK.NS`, `NIFTY_HEALTHCARE.NS`. If any ticker returns `not_found`, stop and report.
- [ ] **Step 6:** Commit: `feat(provider): Yahoo daily history and quotes with retry`.

---

### Task 5: Price row builder

**Files:**
- Create: `lib/prices/types.ts`, `lib/prices/buildRows.ts`, `lib/prices/buildRows.test.ts`

**Interfaces:**
- Consumes: Task 2 functions, `swingLevels` (Task 3), `Candle` (Task 4).
- Produces:
  - `type InstrumentType = 'index' | 'sector' | 'stock'`
  - `type Instrument = { id: number; symbol: string; providerTicker: string; type: InstrumentType }`
  - `type StoredRow = { date: string; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null; pctChange: number | null; source: 'import' | 'provider' }`
  - `type PriceRow = { instrumentId: number; date: string; open: number; high: number; low: number; close: number; volume: number; pctChange: number | null; ema50: number | null; ema200: number | null; rsi14: number | null; rsVsNifty: number | null; source: 'import' | 'provider' }`
  - `type AutoLevels = { instrumentId: number; autoSupport: number | null; autoResistance: number | null }`
  - `buildPriceRows(instrumentId: number, stored: StoredRow[], candles: Candle[], niftyReturn20: Map<string, number>): { rows: PriceRow[]; levels: AutoLevels }`
  - `niftyReturnMap(dates: string[], closes: number[]): Map<string, number>` — date → 20-day trailing return.

Behaviour: merge stored rows that have a close with the new candles (candle wins on the same date), sort by date, compute every indicator over the full merged series, and return **only rows whose date is in `candles`**. For a date where the stored row has `source: 'import'`, keep the stored `pctChange` and `source: 'import'`; otherwise `pctChange` comes from `pctChanges` and `source: 'provider'`. `rsVsNifty = own 20-day return − niftyReturn20.get(date)`, null if either is missing. Levels come from `swingLevels` over the merged bars with `cmp` = latest close.

- [ ] **Step 1: Write failing tests**
  - Returns rows only for candle dates; earlier stored rows feed the EMA but aren't returned.
  - **Import precedence:** stored `{date:'2026-10-16', close:null, pctChange:0.65, source:'import'}` + candle for the same date → row has `close` from the candle, `pctChange: 0.65`, `source: 'import'`.
  - Stored import row with `close: null` and no candle is ignored in the close series (no NaN in EMA).
  - **Short history:** 30 candles → `ema200: null` on all rows, `ema50: null`, `rsi14` present from index 14, nothing throws. 8 candles → levels `{ autoSupport: null, autoResistance: null }` (no bar has 5 neighbours each side). 1 candle → one row, `pctChange: null`.
  - `rsVsNifty`: with own closes rising 10% over 20 bars and `niftyReturn20` = 4 on the last date → `rsVsNifty` ≈ 6.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → pass.
- [ ] **Step 5:** Commit: `feat(prices): build price rows with indicators and import precedence`.

---

### Task 6: Supabase schema, RLS, instrument seed, Supabase store

**Files:**
- Create: `supabase/migrations/20261016000000_init.sql`, `supabase/migrations/20261016000100_seed_instruments.sql`, `lib/prices/store.ts`, `lib/prices/memoryStore.ts`, `lib/prices/supabaseStore.ts`, `lib/supabase/admin.ts`

**Interfaces:**
- Produces:
  - `interface PriceStore {`
    `listRefreshTargets(): Promise<Instrument[]>` (active index/sector instruments + every watchlist stock)
    `loadRows(instrumentId: number): Promise<StoredRow[]>` (all rows, ascending)
    `upsertRows(rows: PriceRow[]): Promise<void>`
    `upsertAutoLevels(levels: AutoLevels): Promise<void>` (touches only auto_* and updated_at)
    `startJob(name: string): Promise<number>`
    `finishJob(id: number, status: JobStatus, message: string): Promise<void>` `}`
  - `type JobStatus = 'running' | 'ok' | 'partial' | 'failed' | 'no_session'`
  - `class MemoryPriceStore implements PriceStore` (constructor takes `instruments`, optional seed rows; exposes `rows`, `levels`, `jobs` for assertions)
  - `createSupabasePriceStore(client: SupabaseClient): PriceStore`
  - `createAdminClient(): SupabaseClient` (server-only; URL + `SUPABASE_SECRET_KEY`)

Schema (`init.sql`):
```sql
create table instruments (id bigint generated always as identity primary key, symbol text not null unique,
  provider_ticker text not null, name text not null, type text not null check (type in ('index','sector','stock')),
  active boolean not null default true);
create table daily_prices (instrument_id bigint not null references instruments(id) on delete cascade, date date not null,
  open numeric, high numeric, low numeric, close numeric, volume bigint, pct_change numeric,
  ema50 numeric, ema200 numeric, rsi14 numeric, rs_vs_nifty numeric,
  source text not null check (source in ('import','provider')), primary key (instrument_id, date));
create table watchlist (instrument_id bigint primary key references instruments(id) on delete cascade, added_at timestamptz not null default now());
create table levels (instrument_id bigint primary key references instruments(id) on delete cascade,
  auto_support numeric, auto_resistance numeric, manual_support numeric, manual_resistance numeric, updated_at timestamptz not null default now());
create table rotation_snapshots (week_ending date not null, instrument_id bigint not null references instruments(id) on delete cascade,
  rs_score numeric, rank int not null, group_kind text not null check (group_kind in ('sector','watchlist')),
  primary key (week_ending, group_kind, instrument_id));
create table daily_summaries (date date primary key, summary text not null, market_events jsonb not null default '[]',
  watchlist_news jsonb not null default '[]', created_at timestamptz not null default now());
create table reports (id uuid primary key default gen_random_uuid(), instrument_id bigint not null references instruments(id),
  status text not null default 'pending' check (status in ('pending','done','failed')), requested_at timestamptz not null default now(),
  completed_at timestamptz, requested_via text not null check (requested_via in ('site','chat')), content jsonb, error text);
create table job_runs (id bigint generated always as identity primary key, job_name text not null, started_at timestamptz not null default now(),
  finished_at timestamptz, status text not null check (status in ('running','ok','partial','failed','no_session')), message text);
```
Then, for each of the 8 tables: `alter table … enable row level security;` and `create policy owner_all on … for all to authenticated using (true) with check (true);`.

Seed (`seed_instruments.sql`), `symbol, provider_ticker, name, type`:
`NIFTY50 ^NSEI 'Nifty 50' index` · `BANKNIFTY ^NSEBANK 'Nifty Bank' index` · `INDIAVIX ^INDIAVIX 'India VIX' index` · `NIFTYAUTO ^CNXAUTO` · `NIFTYFIN NIFTY_FIN_SERVICE.NS 'Nifty Financial Services'` · `NIFTYFMCG ^CNXFMCG` · `NIFTYIT ^CNXIT` · `NIFTYMEDIA ^CNXMEDIA` · `NIFTYMETAL ^CNXMETAL` · `NIFTYPHARMA ^CNXPHARMA` · `NIFTYPSUBANK ^CNXPSUBANK` · `NIFTYPVTBANK NIFTY_PVT_BANK.NS 'Nifty Private Bank'` · `NIFTYHEALTH NIFTY_HEALTHCARE.NS 'Nifty Healthcare'` (all after the first three are `sector`; names `Nifty Auto`, `Nifty FMCG`, … as above).

`supabaseStore` notes: `loadRows` must page with `.range()` in blocks of 1000 until a short page (PostgREST caps responses at 1000 rows); `upsertRows` maps camelCase → snake_case and upserts in chunks of 500 with `onConflict: 'instrument_id,date'`; numeric columns come back as numbers or strings depending on size — coerce with `Number()` (null stays null).

- [ ] **Step 1:** Find or create the Supabase project (Supabase MCP `list_projects`; if none fits, ask the owner before `create_project` — it may have a cost check). Put URL, publishable key and secret key in `.env.local`.
- [ ] **Step 2:** Write both migration files; apply them with MCP `apply_migration` (names `init`, `seed_instruments`).
- [ ] **Step 3:** Verify with MCP `execute_sql`: `select type, count(*) from instruments group by type` → index 3, sector 10. `select tablename, rowsecurity from pg_tables where schemaname='public'` → 8 tables, all `true`. Run MCP `get_advisors` (security) → no RLS warnings.
- [ ] **Step 4:** Owner action in the Supabase dashboard: Auth → disable "Allow new users to sign up"; create the owner user (email + password).
- [ ] **Step 5:** Write `store.ts`, `memoryStore.ts`, `supabaseStore.ts`, `admin.ts`. `npx tsc --noEmit` → no errors.
- [ ] **Step 6:** Commit: `feat(db): schema, RLS, instrument seed, price store`.

---

### Task 7: refreshInstrument and the EOD job

**Files:**
- Create: `lib/prices/refresh.ts`, `lib/prices/refresh.test.ts`, `lib/jobs/mapLimit.ts`, `lib/jobs/eod.ts`, `lib/jobs/eod.test.ts`, `app/api/cron/eod/route.ts`, `vercel.json`

**Interfaces:**
- Consumes: `PriceStore`, `MemoryPriceStore` (Task 6), `MarketDataProvider`, `withRetry` (Task 4), `buildPriceRows`, `niftyReturnMap` (Task 5).
- Produces:
  - `refreshInstrument(deps: { store: PriceStore; provider: MarketDataProvider; today: string }, inst: Instrument, niftyReturn20: Map<string, number>): Promise<{ written: number; newestDate: string | null }>` — fetch window: from = (newest stored date with a close − 7 days), or `today − 730 days` if none; to = `today`. Fetch through `withRetry`. Writes rows and auto levels; writes nothing if no candles.
  - `mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]>`
  - `runEod(deps: { store: PriceStore; provider: MarketDataProvider; today: string }, opts?: { skipSessionCheck?: boolean }): Promise<{ status: JobStatus; message: string }>`

`runEod` order: `startJob('eod')` → refresh `NIFTY50` first, comparing its newest stored date before vs newest written date after; if not later and `!skipSessionCheck` → finish `no_session` (message `no session for <today>`) and return without touching other instruments → load Nifty rows, build `niftyReturnMap` → refresh all other targets via `mapLimit(…, 6, …)` → status `ok`, or `partial` with message `failed: SYM1, SYM2` if any rejected, or `failed` if Nifty itself fails. Any thrown error still calls `finishJob`.

Friday `rotation_snapshots` (spec §3.3) are left to the Rotation plan (build step 4); the schema exists now.

Note the session check runs *after* writing Nifty's rows; on a no-session day Nifty's fetch returns only already-stored dates, which re-upsert identical values (idempotent), so "nothing written" means no new dates.

Route: `GET` only; respond 401 unless `Authorization === 'Bearer ' + process.env.CRON_SECRET`; `today` = current IST date; `export const maxDuration = 60`; returns the `runEod` result as JSON. `vercel.json`: `{ "crons": [{ "path": "/api/cron/eod", "schedule": "0 11 * * 1-5" }] }`.

- [ ] **Step 1: Write failing tests** (fake provider backed by a map of ticker → candles; `MemoryPriceStore`):
  - `refreshInstrument` on an empty store requests from `today − 730d`; with stored rows up to `2026-10-14` requests from `2026-10-07`.
  - **Idempotent:** running `runEod` twice for the same `today` leaves identical `store.rows` and the second run is `no_session`.
  - **Holiday:** provider returns no Nifty candle newer than stored → `no_session`, sector rows unchanged, one job with status `no_session`.
  - **Partial failure:** sector ticker throws `ProviderError('x','transient')` on every call → other sectors written, failed sector's rows unchanged, job `partial`, message contains its symbol.
  - **Nifty fails** → job `failed`, no other instrument fetched.
  - `mapLimit` never runs more than `limit` at once (track concurrent counter).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → pass.
- [ ] **Step 5:** Local route check: `npm run dev`, then `curl -i localhost:3000/api/cron/eod` → 401; with `-H "Authorization: Bearer $CRON_SECRET"` → 200 JSON (needs Task 6 env).
- [ ] **Step 6:** Commit: `feat(jobs): refreshInstrument and EOD cron job`.

---

### Task 8: History import, back-fill and equity seed scripts

**Files:**
- Create: `lib/import/parseHistory.ts`, `lib/import/parseHistory.test.ts`, `scripts/import-history.ts`, `scripts/backfill.ts`, `scripts/seed-equities.ts`

**Interfaces:**
- Consumes: `createAdminClient` (Task 6), `runEod` (Task 7).
- Produces:
  - `const HISTORY_COLUMNS: Record<string, string>` = `{ NIFTY: 'NIFTY50', AUTO: 'NIFTYAUTO', BANK: 'BANKNIFTY', FINANCIAL: 'NIFTYFIN', FMCG: 'NIFTYFMCG', IT: 'NIFTYIT', MEDIA: 'NIFTYMEDIA', METAL: 'NIFTYMETAL', PHARMA: 'NIFTYPHARMA', 'PSU BANK': 'NIFTYPSUBANK', 'PVT BANK': 'NIFTYPVTBANK', HEALTHCARE: 'NIFTYHEALTH' }` (keys = header trimmed + upper-cased)
  - `type ImportRow = { symbol: string; date: string; pctChange: number }`
  - `parseHistoryWorkbook(buf: Buffer): Promise<{ rows: ImportRow[]; unknownHeaders: string[] }>`
  - `dryRunReport(rows: ImportRow[]): { perSymbol: Record<string, { count: number; first: string; last: string }>; missingWeekdays: string[]; outliers: ImportRow[]; duplicates: ImportRow[] }`
  - `toImportPayload(rows: ImportRow[], idBySymbol: Map<string, number>): { instrument_id: number; date: string; pct_change: number; source: 'import' }[]`

Workbook layout (verified against `data/history.xlsx`): one sheet per month (`OCT`, `SEP`, `AUG`), row 1 headers (`Date `, `NIFTY`, … `HEALTHCARE`), row 2 `Total` formulas, data from row 3/4 on. A row is data iff column A is a date. Cell values are fractions: `pctChange = value × 100`, rounded to 4 dp. Empty cells are skipped. Dates come from Excel without a timezone — format the cell's calendar date as given (use UTC getters on the `Date` exceljs returns).

Report rules: `missingWeekdays` = Mon–Fri dates between a symbol's first and last date with no row (NIFTY50 only — holidays like 2026-10-02 will appear; that's for the owner to eyeball); `outliers` = `|pctChange| > 5`; `duplicates` = same symbol+date appearing twice (across sheets).

The import upsert sends **only** `instrument_id, date, pct_change, source` so an existing provider row keeps its OHLC and indicators (PostgREST updates only the columns in the payload).

- [ ] **Step 1: Write failing tests** — build a workbook in the test with exceljs: sheet `OCT` with header row (including the trailing-space `Date ` and `Financial `), a `Total` row with formulas, an empty row, and two data rows (`2026-10-15`: NIFTY 0.0166; `2026-10-16`: NIFTY 0.0065, AUTO empty); sheet `SEP` repeating `2026-10-16` NIFTY.
  - rows: NIFTY50 `2026-10-15` → 1.66, `2026-10-16` → 0.65; no AUTO row for the 16th; `unknownHeaders` is `[]`.
  - An unknown header `REALTY` lands in `unknownHeaders` and its values are skipped.
  - `dryRunReport`: the repeated `2026-10-16` is in `duplicates`; a 6.1 value is in `outliers`; a Mon/Wed pair reports the Tuesday in `missingWeekdays`.
  - `toImportPayload` objects have exactly the four keys `instrument_id, date, pct_change, source`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → pass.
- [ ] **Step 5:** `scripts/import-history.ts [--write] <path>` — default is dry run: prints the report and per-symbol counts, writes nothing. With `--write`, upserts `toImportPayload` in chunks of 500 (`onConflict: 'instrument_id,date'`) and prints the number written. Exit non-zero if `unknownHeaders` is non-empty.
- [ ] **Step 6:** `scripts/backfill.ts` — `runEod({ store: createSupabasePriceStore(createAdminClient()), provider: getProvider(), today: <IST today> }, { skipSessionCheck: true })` and print the result.
- [ ] **Step 7:** `scripts/seed-equities.ts <EQUITY_L.csv>` — parse NSE's CSV (columns `SYMBOL`, `NAME OF COMPANY`, ` SERIES`; header names may have leading spaces — trim), keep series `EQ` and `BE`, upsert `{ symbol, provider_ticker: SYMBOL + '.NS', name, type: 'stock', active: true }` on `symbol`, print count.
- [ ] **Step 8: Run against the real database, in this order**
  1. `npm run script -- scripts/import-history.ts data/history.xlsx` → review the dry-run report with the owner (expect 42 NIFTY50 rows from 2026-08-13 to 2026-10-16, 2026-10-02 listed as a missing weekday, no unknown headers).
  2. With the owner's OK: `… import-history.ts --write data/history.xlsx`.
  3. `npm run script -- scripts/backfill.ts` → `ok`.
  4. Owner downloads `EQUITY_L.csv` from nseindia.com (Market Data → Securities available for trading) into `data/`; run `seed-equities.ts data/EQUITY_L.csv` → ~2,000+ stocks.
- [ ] **Step 9: Verify** with MCP `execute_sql`:
  - `select date, close, pct_change, source from daily_prices dp join instruments i on i.id=dp.instrument_id where i.symbol='NIFTY50' and date >= '2026-10-13' order by date` → 2026-10-16 has close ≈ 23146.15, pct_change 0.65, source `import`.
  - `select i.symbol, count(*), count(ema200) from daily_prices dp join instruments i on i.id=dp.instrument_id group by 1 order by 1` → ~495 rows and ~296 ema200 values for the 10 full-history indices; only import rows + 1 bar for MEDIA, PVTBANK, HEALTH.
  - `select * from job_runs order by id desc limit 1` → `ok`.
- [ ] **Step 10:** Commit: `feat(import): history import, back-fill and equity seed scripts`.

---

### Task 9: Auth, status page, deploy

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `lib/auth/publicPaths.ts`, `lib/auth/publicPaths.test.ts`, `middleware.ts` (or `proxy.ts`), `app/login/page.tsx`, `app/login/actions.ts`
- Modify: `app/page.tsx`, `app/layout.tsx`

**Interfaces:**
- Produces:
  - `isPublicPath(pathname: string): boolean` — true for `/login` and anything under `/api/cron/` (the cron route has its own secret check); false otherwise.
  - `createServerSupabase(): Promise<SupabaseClient>` (cookie-based, `@supabase/ssr`), `createBrowserSupabase(): SupabaseClient`.
  - Server actions `signIn(formData)` (email + password → redirect `/`; on error re-render `/login?error=1` showing "Wrong email or password") and `signOut()`.

- [ ] **Step 1: Write failing test:** `isPublicPath('/login')`, `isPublicPath('/api/cron/eod')` → true; `isPublicPath('/')`, `isPublicPath('/api/quotes')`, `isPublicPath('/loginx')` → false.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `publicPaths.ts`, the Supabase clients (standard `@supabase/ssr` pattern), middleware (refresh session; redirect to `/login` when there's no user and the path isn't public), login page and actions.
- [ ] **Step 4:** `app/page.tsx` (server component, uses `createServerSupabase`) — temporary status page replaced in step 2 of the build: heading "Nifty Dashboard", a table of the last 10 NIFTY50 rows (date, close, % change, EMA 50, EMA 200, RSI, source), the latest `job_runs` row, and a sign-out button. Empty state: "No data yet — run the back-fill."
- [ ] **Step 5:** Run → `npm test` all pass, `npm run build` succeeds. Manual: `npm run dev`, open `/` → redirected to `/login`; sign in as the owner → status table shows 2026-10-16 with % change 0.65.
- [ ] **Step 6:** Commit: `feat(auth): owner login and foundation status page`.
- [ ] **Step 7: Deploy (owner action needed).** Create a GitHub repo (private) and push, import it in Vercel (Hobby), set the four env vars (generate `CRON_SECRET` with `openssl rand -hex 32`), deploy. Confirm Vercel → Settings → Cron Jobs lists `/api/cron/eod` at `0 11 * * 1-5`, then use "Run" once → `job_runs` gets a row (`no_session` if that day's data is already stored, which is correct).
- [ ] **Step 8: First-week check (spec §7).** For the next five trading days, compare the status page's Nifty % change with the owner's manual log. Note: Vercel Hobby crons may fire any time within the 11:00 UTC hour (4:30–5:29 PM IST); the step-6 plan (Claude tasks) must schedule the daily summary after that window or gate on today's `job_runs`.
