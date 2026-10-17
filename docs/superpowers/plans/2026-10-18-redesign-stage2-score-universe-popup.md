# Redesign Stage 2 — Indicators, Technical Score, Nifty 200, Stock Pop-up

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship redesign spec stage 2: new stored indicators (MACD, Bollinger, volume average, 52-week range), candlestick patterns, the Technical Score (spec §5) for Nifty, the 11 sectors and every Nifty 200 stock, the niftyindices.com imports (Nifty 200 + sector constituents + history for the 8 thin sectors), a Nifty 200 back-fill, the EOD job extension, and the stock pop-up with all four tabs, opened from anywhere a stock or sector is shown, plus the top-bar search.

**Architecture:** Pure calculation modules (`src/lib/calc/{macd,bollinger,volume,range52,patterns,score}.ts`) are composed by `computeIndicators` (per-bar, full history) and by a new per-session **score pass** in the EOD job and back-fill that runs in dependency order: Nifty → indices and sectors → stocks. Constituents live in `index_constituents`; each stock's sector is derived from it. The pop-up is a client component driven by the `?stock=KEY` URL parameter that fetches one JSON payload from `/api/instrument/[key]`.

**Tech Stack:** unchanged (Next.js 15.5, React 19, Tailwind 4, Supabase, Vitest, lightweight-charts v5, yahoo-finance2).

**Spec:** `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md` §4.1 (search), §4.2 (pop-up), §4.3 (Nifty score badge), §5 (score), §6.1–6.4 (data). Stage 1 plan: `docs/superpowers/plans/2026-10-17-redesign-stage1-shell-and-dashboard.md`.

**Not in this stage:** watchlist table redesign and score column (stage 3), gainers/losers/breadth (3), sector tiles/constituent UI (4), Add to Portfolio button (5), screeners (6), alerts (7).

## Global Constraints

- All foundation and stage 1 constraints hold (fractions, IST dates, dark tokens, mono numbers, Windows-compatible scripts, service-role key server-only, no Claude API).
- Indicator formulas, exactly:
  - **MACD (12, 26, 9):** `macd = EMA12(close) − EMA26(close)`; `signal = EMA9(macd)` seeded with the SMA of the first 9 non-null macd values; `hist = macd − signal`. EMAs use the existing `emaSeries` (SMA seed, k = 2/(n+1)).
  - **Bollinger (20, 2):** middle = SMA20(close); upper/lower = middle ± 2 × population standard deviation of the same 20 closes.
  - **vol_avg20:** mean volume of the 20 sessions **before** the current one (excluding today); null if any of them has null volume or fewer than 20 exist.
  - **high_52w / low_52w:** max high / min low over the last 252 priced sessions including the current one (use close where high/low is null).
  - **Score:** spec §5.1–5.4 verbatim; this plan's Task 3 pins every boundary.
- **Score timing:** the score (and `rs_vs_sector`) is computed for the **latest priced session only**, on each EOD run and at the end of a back-fill; history accrues one row per day. Risk/Levels uses the instrument's current effective levels.
- **Universe:** `NIFTY200` constituents + the 11 sector indices' constituents + Nifty 50, Bank Nifty, India VIX + watchlist stocks. Stock history back-fill starts **2019-01-01** (enough for EMA 200, 52-week and a multi-year chart; keeps the free Supabase database well under its 500 MB limit). Indices and sectors keep history from 2015.
- **Sector priority** when a stock belongs to several sector indices (spec §6.3): `NIFTY_BANK`, `NIFTY_FIN`, `NIFTY_PVT_BANK`, `NIFTY_PSU_BANK`, `NIFTY_IT`, `NIFTY_PHARMA`, `NIFTY_HEALTHCARE`, `NIFTY_AUTO`, `NIFTY_FMCG`, `NIFTY_METAL`, `NIFTY_MEDIA` — first match wins.
- **niftyindices.com files (owner downloads)** go in `data/niftyindices/`, named by key so no filename guessing is needed:
  - `constituents/NIFTY200.csv` and `constituents/<SECTOR_KEY>.csv` for the 11 sectors (the site's "Download list of constituents" CSV; columns `Company Name, Industry, Symbol, Series, ISIN Code`).
  - `history/<SECTOR_KEY>*.csv` for the 8 thin sectors (`NIFTY_AUTO`, `NIFTY_FIN`, `NIFTY_FMCG`, `NIFTY_MEDIA`, `NIFTY_METAL`, `NIFTY_PSU_BANK`, `NIFTY_PVT_BANK`, `NIFTY_HEALTHCARE`); several files per key allowed (the site limits each download's date range), e.g. `NIFTY_AUTO_2015-2019.csv`.
- EOD budget: 60 s Vercel limit; if a measured full run exceeds 45 s, adopt the two-part split (Task 8).

## Review Focus

1. **Stocks with short history** (recent listings, < 200 sessions) — EMA 200 / 52-week / MACD signal null; score must still compute with `partial: true` and half points for the missing sub-rules, never NaN. Pinned in Task 3.
2. **Index volume is zero or null** (Yahoo returns 0 for `^NSEI`) — Volume component 7.5, not 0 or 15, and not `partial`. Pinned in Task 3.
3. **niftyindices CSV quirks** — trailing spaces in headers, quoted names with commas, dates like `17-Oct-2026` or `17 Oct 2026`, a symbol Yahoo does not know — dry run reports, import skips, nothing crashes. Pinned in Task 5.
4. **Score dependency order** — a stock scored before its sector or Nifty gets a null label input; EOD must score Nifty, then indices/sectors, then stocks. Pinned in Task 7.
5. **Pop-up for an unknown key or a key with no priced bars** (`?stock=NOPE`) — shows "Stock not found" or "Not enough price history" inside the pop-up, never a blank overlay or crash. Pinned in Task 9.

---

## File Structure

```
src/lib/calc/macd.ts          macdSeries
src/lib/calc/bollinger.ts     bollingerSeries
src/lib/calc/volume.ts        volAvgPrev
src/lib/calc/range52.ts       range52Series
src/lib/calc/patterns.ts      detectPatterns, PatternHit
src/lib/calc/score.ts         scoreInstrument, labelFor, confidenceFor, signalLine
src/lib/calc/levelsDetail.ts  levelStrength (touch counts for S/R strength)
src/lib/calc/indicators.ts    (extended)
src/lib/universe/sectors.ts   SECTOR_PRIORITY, primarySector
src/lib/import/niftyindices.ts parseConstituentsCsv, parseIndexHistoryCsv
scripts/import-niftyindices.ts [--dry-run]
src/lib/jobs/score.ts         scorePass
src/lib/jobs/eod.ts           (extended targets, score pass, split)
src/lib/jobs/backfill.ts      (extended: universe back-fill)
scripts/backfill.ts           (+ --universe flag)
supabase/migrations/0004_indicators_score_universe.sql
src/lib/db/{types,repo,supabaseRepo,memoryRepo}.ts  (new columns + constituents)
src/lib/view/popup.ts         buildPopupData (+ signal, S/R cards, tailwinds, indicator table)
src/app/api/instrument/[key]/route.ts   GET pop-up payload
src/app/api/reports/route.ts            POST request report
src/app/components/popup/{StockModal,StockLink,ScoreBadge,ChartSetupTab,DeepDiveTab,PatternsTab,IndicatorTab}.tsx
src/app/components/shell/SearchBox.tsx
src/app/components/chart/PriceChart.tsx (+ MACD pane, Bollinger overlay)
tests/calc/{macd,bollinger,volume,range52,patterns,score,levelsDetail}.test.ts
tests/import/niftyindices.test.ts, tests/universe/sectors.test.ts, tests/jobs/score.test.ts (+ eod/backfill extensions), tests/view/popup.test.ts
```

---

### Task 1: MACD, Bollinger, volume average, 52-week range

**Files:** Create `src/lib/calc/{macd,bollinger,volume,range52}.ts`; Test `tests/calc/{macd,bollinger,volume,range52}.test.ts`

**Interfaces (Produces):**
- `macdSeries(closes: number[], fast = 12, slow = 26, signal = 9): { macd: (number|null)[]; signal: (number|null)[]; hist: (number|null)[] }` — same length as input.
- `bollingerSeries(closes: number[], period = 20, mult = 2): { upper: (number|null)[]; middle: (number|null)[]; lower: (number|null)[] }`
- `volAvgPrev(volumes: (number|null)[], period = 20): (number|null)[]` — value at i = mean of volumes i−20..i−1.
- `range52Series(bars: { high: number|null; low: number|null; close: number }[], window = 252): { high: number[]; low: number[] }`

- [ ] **Step 1: Write failing tests**
  - MACD on 60 closes `100 + i`: `macd[24]` null, `macd[25]` = EMA12[25] − EMA26[25] (compute both with `emaSeries` in the test); `signal[32]` null and `signal[33]` = mean of `macd[25..33]`; `hist[33] = macd[33] − signal[33]`. Constant closes (all 100) → macd, signal, hist all 0 from their first non-null index.
  - Bollinger on closes 1..20: `middle[19] = 10.5`, upper − middle = 2 × population SD of 1..20 (`Math.sqrt(33.25)` × 2 = 11.5326 to 4 dp); `upper[18]` null; constant closes → upper = middle = lower.
  - `volAvgPrev`: volumes 1..25 → index 19 null, index 20 = mean(1..20) = 10.5; a null at index 5 makes indices 6..25 null.
  - `range52Series`: 300 bars (high = i + 1, low = i) → `high[299] = 300`, `low[299] = 48`; `high[10] = 11`, `low[10] = 0`; a bar with null high/low uses close.
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): MACD, Bollinger, volume average, 52-week range`

---

### Task 2: Candlestick patterns and S/R strength

**Files:** Create `src/lib/calc/patterns.ts`, `src/lib/calc/levelsDetail.ts`; Test `tests/calc/patterns.test.ts`, `tests/calc/levelsDetail.test.ts`

**Interfaces (Produces):**
- `type PatternBias = "bullish" | "bearish" | "neutral"`; `interface PatternHit { name: string; bias: PatternBias }`
- `detectPatterns(bars: { open: number; high: number; low: number; close: number }[], i: number): PatternHit[]` — patterns completing on bar `i` (uses bars up to i only).
- `levelStrength(bars: { high: number; low: number }[], level: number | null, tol = 0.01, lookback = 60): { touches: number; strength: "Strong" | "Weak" | null }` — touches = bars in the last `lookback` whose high (for a level above the last close) or low (below) is within `tol` of the level; Strong when ≥ 3; null strength when level is null.

Definitions (body = |c−o|, range = h−l, upper = h − max(o,c), lower = min(o,c) − l; a bar with range 0 matches nothing; trend5 = close[i−1] vs close[i−6], "down" if lower, "up" if higher, requires i ≥ 6):
| Name | Bias | Rule on bar i (p = i−1, q = i−2) |
|---|---|---|
| `doji` | neutral | body ≤ 0.1·range |
| `hammer` | bullish | lower ≥ 2·body, upper ≤ 0.1·range, body > 0, trend5 down |
| `hanging_man` | bearish | same shape as hammer, trend5 up |
| `inverted_hammer` | bullish | upper ≥ 2·body, lower ≤ 0.1·range, body > 0, trend5 down |
| `shooting_star` | bearish | same shape as inverted hammer, trend5 up |
| `bullish_engulfing` | bullish | p bearish (c<o), i bullish, o_i ≤ c_p, c_i ≥ o_p, body_i > body_p |
| `bearish_engulfing` | bearish | mirror |
| `piercing_line` | bullish | p bearish, i bullish, o_i < c_p, c_i > (o_p + c_p)/2, c_i < o_p |
| `dark_cloud_cover` | bearish | mirror: p bullish, i bearish, o_i > c_p, c_i < (o_p + c_p)/2, c_i > o_p |
| `morning_star` | bullish | q bearish with body_q ≥ 0.5·range_q; body_p ≤ 0.3·body_q; i bullish with c_i > (o_q + c_q)/2 |
| `evening_star` | bearish | mirror |

(Doji is not also reported as hammer/star: if `doji` matches, skip the four single-bar shape patterns.)

- [ ] **Step 1: Write failing tests** — one positive fixture and one near-miss negative fixture per pattern (e.g. engulfing where `body_i == body_p` → no match); a range-0 bar → `[]`; `i < 6` → no trend-dependent patterns. `levelStrength`: 60 bars with lows touching 100.5, 99.8, 100.9 and level 100, last close 105 → touches 3, Strong; two touches → Weak; null level → `{ touches: 0, strength: null }`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): candlestick patterns and level strength`

---

### Task 3: Technical Score

**Files:** Create `src/lib/calc/score.ts`; Test `tests/calc/score.test.ts`

**Interfaces (Produces):**
```ts
type ScoreLabel = "Strong Bullish" | "Bullish" | "Neutral" | "Bearish" | "Strong Bearish";
type InstrumentKind = "nifty" | "index" | "sector" | "stock";
interface ScoreInput {
  kind: InstrumentKind;
  close: number; prevClose: number | null;
  ema20: number | null; ema50: number | null; ema200: number | null;
  rsi14: number | null;
  macd: number | null; macdSignal: number | null; macdHist: number | null; prevMacdHist: number | null;
  volume: number | null; volAvg20: number | null;
  recentPatterns: PatternHit[];          // all hits on the last 3 sessions, flattened
  niftyLabel: ScoreLabel | null;         // ignored for kind "nifty"
  sectorLabel: ScoreLabel | null;        // stocks: their sector's label; index/sector: pass niftyLabel
  rs20: number | null;                   // rsVsNifty of the latest row
  support: number | null; resistance: number | null; // effective levels (null for non-stocks)
}
interface ScoreComponents { trend: number; momentum: number; volume: number; pattern: number; market: number; risk: number }
interface ScoreResult { score: number; components: ScoreComponents; partial: boolean; label: ScoreLabel; confidence: "High" | "Medium" | "Low"; signal: string }
const COMPONENT_MAX: ScoreComponents = { trend: 20, momentum: 20, volume: 15, pattern: 15, market: 20, risk: 10 };
function scoreInstrument(input: ScoreInput): ScoreResult
function labelFor(score: number): ScoreLabel
```
Rules (spec §5.1 with these pins):
- `score` = sum of components rounded to an integer; each component rounded to one decimal.
- Any sub-rule whose input is null scores half its points and sets `partial: true` — except Volume for kinds `nifty`/`index`/`sector` (null or 0 volume → 7.5, not partial) and Risk for non-stocks (always 5, not partial).
- Trend stack sub-rule: "exactly two of the three pairwise orders (20>50, 50>200, 20>200)" → 4; all three → 8; else 0. If any EMA null → stack half (4) and partial.
- Momentum RSI bands use `>=` on the lower bound: 55 ≤ r ≤ 70 → 12; 45 ≤ r < 55 → 8; 70 < r ≤ 80 → 6; 40 ≤ r < 45 → 4; r > 80 → 2; r < 40 → 0.
- Pattern: start 7.5; each bullish +3.75, each bearish −3.75; a `doji` counts bullish when `support` is non-null and `|close − support|/close ≤ 0.01`, bearish when the same holds for `resistance`, else ignored; clamp 0–15.
- Market: kind `nifty` → fixed 10 (not partial). Others: Nifty part 8/6/4/2/0, sector part 6/4.5/3/1.5/0 by label, RS part per spec; null label or rs → half of that part, partial.
- Risk (stocks): spec §5.1 table; up/down computed from `close`.
- `confidenceFor(components, label)` per spec §5.3 (share = points/max; bullish component share ≥ 0.6, bearish ≤ 0.4).
- `signal` = `<label words> · <phrase>`. Label words: Strong Bullish "Strong bullish momentum", Bullish "Bullish setup", Neutral "Range-bound", Bearish "Bearish weakness", Strong Bearish "Strong bearish pressure". Phrase source component: bullish labels → highest share; bearish labels → lowest share; Neutral → largest |share − 0.5|; ties broken in order trend, momentum, volume, pattern, market, risk. Phrases (high = share ≥ 0.5): trend "price above key EMAs" / "below key EMAs"; momentum "strong RSI & MACD" / "fading momentum"; volume "accumulation on high volume" / "supply pressure"; pattern "bullish reversal pattern" / "bearish reversal pattern"; market "market & sector tailwinds" / "market & sector headwinds"; risk "near support with room to run" / "pressing against resistance".

- [ ] **Step 1: Write failing tests** (table-driven; one test per row):
  - Trend: close above all three with 20>50>200 → 20; above 20 and 50 only, orders 20>50 and 20>200 true, 50>200 false → 4+4+0+4 = 12; ema200 null → partial true, stack 4, above-200 sub-rule 2.
  - RSI boundaries 39.99→0, 40→4, 45→8, 55→12, 70→12, 70.01→6, 80→6, 80.01→2.
  - MACD: macd 1 > signal 0.5, > 0, hist 0.5 > prev 0.3 → 8; all false → 0.
  - Volume stock: up day ratio 2.0 → 15, 1.5 → 12, 1.0 → 9, 0.9 → 7; down day 2.0 → 0, 1.5 → 3, 1.0 → 5, 0.9 → 7; unchanged → 7. Index with volume 0 → 7.5 and `partial` false.
  - Pattern: two bullish hits → 15; one bearish → 3.75; three bearish → 0; doji with close within 1% of support → 11.25; doji far from both → 7.5.
  - Market: nifty kind → 10; stock with niftyLabel Bullish (6), sectorLabel Neutral (3), rs20 0.03 (4.5) → 13.5; rs20 −0.06 → 0 for that part.
  - Risk: support 95, resistance 115, close 100 → up 0.15, down 0.05, ratio 3 → 10; ratio 0.4 → 0; only support at 2% below → 7; only resistance 1% above → 3; neither → 5; index kind → 5.
  - Labels: 75 Strong Bullish, 74 Bullish, 60 Bullish, 59 Neutral, 45 Neutral, 44 Bearish, 30 Bearish, 29 Strong Bearish.
  - Confidence: Bullish label with one bearish component → High; with two → Medium; three → Low; Neutral with 4 bullish components → Medium; Neutral otherwise → Low.
  - Signal: a Bearish result whose lowest share is volume on a down day → `"Bearish weakness · supply pressure"`.
  - Full fixture: an all-null stock input → no NaN anywhere, `partial` true, score is a finite integer.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): Technical Score with labels, confidence and signal`

---

### Task 4: Schema and repository changes

**Files:** Create `supabase/migrations/0004_indicators_score_universe.sql`; Modify `src/lib/db/{types,repo,supabaseRepo,memoryRepo}.ts`, `src/lib/calc/indicators.ts`; Test `tests/db/memoryRepo.test.ts`, `tests/calc/indicators.test.ts`

**Migration:**
```sql
alter table daily_prices
  add column if not exists macd numeric, add column if not exists macd_signal numeric, add column if not exists macd_hist numeric,
  add column if not exists bb_upper numeric, add column if not exists bb_middle numeric, add column if not exists bb_lower numeric,
  add column if not exists vol_avg20 numeric, add column if not exists high_52w numeric, add column if not exists low_52w numeric,
  add column if not exists patterns jsonb, add column if not exists rs_vs_sector numeric,
  add column if not exists score numeric, add column if not exists score_components jsonb,
  add column if not exists score_label text, add column if not exists score_confidence text, add column if not exists score_signal text;
create table if not exists index_constituents (
  index_key text not null, instrument_id bigint not null references instruments on delete cascade,
  primary key (index_key, instrument_id));
alter table index_constituents enable row level security;
create index if not exists daily_prices_score_idx on daily_prices (date, score);
```

**Interfaces (Produces):**
- `StoredDay` and `IndicatorRow` gain: `macd, macdSignal, macdHist, bbUpper, bbMiddle, bbLower, volAvg20, high52w, low52w: number | null; patterns: PatternHit[] | null`.
- `StoredDay` also gains `rsVsSector, score: number | null; scoreComponents: (ScoreComponents & { partial: boolean }) | null; scoreLabel: ScoreLabel | null; scoreConfidence: "High"|"Medium"|"Low" | null; scoreSignal: string | null`.
- `interface ScoreRow { date: string; rsVsSector: number | null; score: number; scoreComponents: ScoreComponents & { partial: boolean }; scoreLabel: ScoreLabel; scoreConfidence: "High"|"Medium"|"Low"; scoreSignal: string }`
- `PriceBar` gains `open: number | null; volume: number | null` (`getPriceBars` reads them).
- `computeIndicators(days: { date; open: number|null; high: number|null; low: number|null; close: number; volume: number|null }[], nifty)` — signature change; all existing call sites pass the richer bars (they already come from `getPriceBars`). Patterns computed only where open/high/low are non-null.
- Repo additions:
  - `upsertScore(instrumentId: number, row: ScoreRow): Promise<void>` — writes only the score columns + rs_vs_sector.
  - `replaceConstituents(indexKey: string, instrumentIds: number[]): Promise<void>` — delete then insert for that key.
  - `listConstituents(indexKey: string): Promise<Instrument[]>`
  - `listMemberships(): Promise<{ indexKey: string; instrumentId: number }[]>`
  - `getLatestDay(instrumentId: number): Promise<StoredDay | null>` — newest row with non-null close.

- [ ] **Step 1: Write failing tests** — memory repo: `upsertScore` then `upsertIndicators` on the same date keeps both; `replaceConstituents("NIFTY_IT", [a, b])` then `[b]` leaves only b; `listMemberships` returns both keys for a stock in two indices. Indicators: the 250-bar fixture now yields non-null `macd` at 25, `bbMiddle` at 19, `volAvg20` at 20, `high52w` at 0, and `patterns` an array on every bar.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (types, compute, Supabase column mapping in the one mapping block, memory repo). **Step 4: Run** `npm test`, `npm run typecheck` — PASS.
- [ ] **Step 5: Apply migration 0004** to Tracker1. Verify `select count(*) from information_schema.columns where table_name='daily_prices' and column_name in ('macd','score','patterns')` = 3 and `index_constituents` exists.
- [ ] **Step 6: Commit** `feat(db): indicator, score and constituent storage`

---

### Task 5: niftyindices.com imports

**Files:** Create `src/lib/universe/sectors.ts`, `src/lib/import/niftyindices.ts`, `scripts/import-niftyindices.ts`; add npm script `"import-niftyindices": "tsx scripts/import-niftyindices.ts"`; Test `tests/universe/sectors.test.ts`, `tests/import/niftyindices.test.ts`

**Interfaces (Produces):**
- `SECTOR_PRIORITY: string[]` (Global Constraints order); `primarySector(indexKeys: string[]): string | null`.
- `parseConstituentsCsv(csv: string): { symbol: string; name: string; series: string }[]` — header match after trim, case-insensitive (`Symbol`, `Company Name`, `Series`); quoted fields; blank lines skipped; reuses `parseCsvLine` (export it from `instruments.ts`).
- `parseIndexHistoryCsv(csv: string): { date: string; open: number; high: number; low: number; close: number }[]` — headers matched case-insensitively after trim on `Date`, `Open`, `High`, `Low`, `Close` (other columns ignored); dates `DD-MMM-YYYY`, `DD MMM YYYY` or `YYYY-MM-DD` → ISO; numbers may contain commas; rows with a `-` or blank OHLC skipped; result sorted ascending, de-duplicated by date (last wins).
- Script `npm run import-niftyindices -- [--dry-run]`:
  1. For each `data/niftyindices/constituents/<KEY>.csv` (KEY ∈ `NIFTY200` + `SECTOR_KEYS`): parse; for each symbol ensure an `instruments` row (`type: stock`, `yahooTicker: SYMBOL.NS`, name from the file) via `upsertInstruments`; then `replaceConstituents(KEY, ids)`.
  2. For each history file `data/niftyindices/history/<KEY>*.csv` (KEY must be one of the 8 thin sectors): parse, `upsertCandles` with `volume: 0`.
  3. Report per file: rows, new instruments, unknown keys (files whose KEY is not recognised), parse errors. `--dry-run` prints the report without writing.
  4. Missing folder or file → listed as "missing" in the report, not an error.

- [ ] **Step 1: Write failing tests** — `primarySector(["NIFTY_FIN","NIFTY_BANK"]) === "NIFTY_BANK"`, `primarySector(["NIFTY_MEDIA"]) === "NIFTY_MEDIA"`, `primarySector([]) === null`, `primarySector(["NIFTY200"]) === null`. Constituents fixture with `"Company Name ,Industry,Symbol,Series,ISIN Code"` header and a quoted name containing a comma → 2 rows with trimmed symbol. History fixtures: `"Date ,Open ,High ,Low ,Close ,Shares Traded"` with `17-Oct-2026` and `"18,245.30"` → `{ date: "2026-10-17", open: 18245.3, … }`; `17 Oct 2026` format; a `-` row skipped; two files' duplicate date keeps the later one when concatenated.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5 (owner):** download from niftyindices.com into `data/niftyindices/` with the file names above.
- [ ] **Step 6:** `npm run import-niftyindices -- --dry-run`. Expected: NIFTY200 ≈ 200 rows; each sector 10–50 rows; 8 history keys present with ≥ 1,500 rows each; no parse errors. Show the report to the owner; then run without `--dry-run`. Verify: `select index_key, count(*) from index_constituents group by 1` → 12 rows.
- [ ] **Step 7: Commit** `feat(import): niftyindices constituents and sector history`

---

### Task 6: Score pass

**Files:** Create `src/lib/jobs/score.ts`; Test `tests/jobs/score.test.ts`

**Interfaces:**
- Consumes: `scoreInstrument`, `labelFor` (Task 3), `primarySector` (Task 5), Repo additions (Task 4), `effectiveLevel` (existing).
- Produces: `scorePass(repo: Repo, opts?: { onlyIds?: Set<number> }): Promise<{ scored: number; skipped: string[] }>`
  1. Load memberships once; build `sectorOf(instrumentId)` via `primarySector`.
  2. Score Nifty (kind `nifty`) from its latest day (+ previous day for prevClose/prevMacdHist, last 3 days' patterns). Keep `niftyLabel`.
  3. Score every active index and sector (kind `index`/`sector`; `sectorLabel = niftyLabel`; levels null). Keep a map `sectorLabel[key]` and each sector's 4-week return.
  4. Score every stock in `NIFTY200` ∪ watchlist (∪ `onlyIds` filter when given): kind `stock`, sector label from its primary sector (null if none), effective levels, `rsVsSector` = stock 20-session return − its sector's 20-session return (null if either missing).
  5. `upsertScore` on the latest priced day of each. Instruments with no priced day are listed in `skipped`.
- [ ] **Step 1: Write failing tests** (memory repo seeded with synthetic 260-bar series for NIFTY50, NIFTY_IT, and stock TCS in NIFTY200 + NIFTY_IT):
  - After `scorePass`, NIFTY50, NIFTY_IT and TCS have a score on their latest date; TCS's `scoreComponents.market` reflects NIFTY_IT's label (assert by recomputing with `scoreInstrument` using the stored sector label).
  - Nifty is scored before sectors: spy on `upsertScore` order — NIFTY50 first, stocks last.
  - A stock with no priced bars → appears in `skipped`, no throw.
  - Re-running produces identical stored rows (idempotent).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(jobs): Technical Score pass in dependency order`

---

### Task 7: Universe back-fill and EOD extension

**Files:** Modify `src/lib/jobs/eod.ts`, `src/lib/jobs/backfill.ts`, `scripts/backfill.ts`, `src/app/api/cron/eod/route.ts`; Test `tests/jobs/eod.test.ts`, `tests/jobs/backfill.test.ts`

**Interfaces:**
- EOD targets: active indices and sectors + `listConstituents("NIFTY200")` + watchlist stocks, de-duplicated; default concurrency 8. After all ingests/recomputes: `scorePass(repo)`; its `skipped` count goes into the run message. Thin sectors whose Yahoo ticker returns only today's bar still get today's candle appended to the imported history.
- `backfill.ts`: `backfillUniverse(deps, { from: string; onProgress?: (key: string, n: number) => void }): Promise<{ done: number; failed: string[] }>` — NIFTY200 constituents + watchlist stocks, sequential with concurrency 4, each via `backfillInstrument`, then one `scorePass`.
- `scripts/backfill.ts`: new flag `--universe` → runs `backfillUniverse` with `--from` default `2019-01-01`; without the flag, unchanged behaviour (indices/sectors) followed by `scorePass`.
- `addStock` (existing) calls `scorePass(repo, { onlyIds: new Set([inst.id]) })` after storing, so a newly added stock has a score immediately.

- [ ] **Step 1: Write failing tests** — EOD with a memory repo containing NIFTY200 constituents: every constituent gets today's row and a score; a failing constituent → `partial` with its key in the message, others scored; Nifty scored before stocks (reuse Task 6 spy). Back-fill: `backfillUniverse` stores candles for all constituents and calls `scorePass` once. `addStock` result stock has a stored score.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Run real back-fills:** `npm run backfill -- --from 2015-01-01` (indices/sectors, recomputes new indicators over full history), then `npm run backfill -- --universe` (≈200 stocks from 2019; expect 15–30 minutes). Verify: `select count(distinct instrument_id) from daily_prices where score is not null` ≥ 210; `select pg_size_pretty(pg_database_size(current_database()))` < 300 MB.
- [ ] **Step 6: Time a real EOD** (`npx tsx` one-off calling `runEod` with real deps, or `curl.exe -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/eod` with `npm run dev`). Record duration in the commit message.
- [ ] **Step 7: Commit** `feat(jobs): Nifty 200 universe in back-fill and EOD with scoring (EOD <N> s)`

---

### Task 8: EOD split (only if Task 7 measured > 45 s)

**Files:** Modify `src/lib/jobs/eod.ts`, `src/app/api/cron/eod/route.ts`; Test `tests/jobs/eod.test.ts`

**Interfaces:** `runEod(deps & { part?: 1 | 2 })` — part 1: indices, sectors, watchlist stocks, and the first half of NIFTY200 (sorted by key); part 2: the second half, then `scorePass`. Part 1 ends by firing `fetch(`${origin}/api/cron/eod?part=2`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })` without awaiting the response body (await only the request being sent, with a 2 s timeout). Each part logs its own `job_runs` row with job names `eod` and `eod:2`; the stale badge treats a failed or partial `eod:2` as stale too.

- [ ] **Step 1:** Skip this task and note "not needed (EOD <N> s)" in the progress ledger if Task 7's run was ≤ 45 s.
- [ ] **Step 2 (if needed):** tests — part 1 processes exactly its half and calls the part-2 trigger once; part 2 processes the other half and runs `scorePass`; `buildAsOf` stale on a partial `eod:2`. Implement, run, commit `feat(jobs): split EOD into two parts`.

---

### Task 9: Pop-up data API

**Files:** Create `src/lib/view/popup.ts`, `src/app/api/instrument/[key]/route.ts`, `src/app/api/reports/route.ts`; Test `tests/view/popup.test.ts`

**Interfaces (Produces):**
```ts
interface PopupData {
  instrument: { key: string; name: string; type: InstrumentType; sectorKey: string | null; sectorName: string | null };
  days: StoredDay[];                      // full stored history (ascending)
  latest: StoredDay | null;
  score: { value: number; label: ScoreLabel; confidence: string; signal: string; components: ScoreComponents; partial: boolean } | null;
  levels: { support: number | null; resistance: number | null; supportManual: boolean; resistanceManual: boolean;
            supportStrength: "Strong" | "Weak" | null; resistanceStrength: "Strong" | "Weak" | null };
  range52: { high: number | null; low: number | null; fromHigh: number | null; fromLow: number | null };
  tailwinds: { niftyLabel: ScoreLabel | null; niftyLine: string; sectorRs: number | null; sectorLine: string | null };
  patterns: { date: string; name: string; bias: PatternBias; effect: number }[]; // last 10 sessions, newest first
  indicatorTable: { label: string; value: string }[];
  onWatchlist: boolean;
  reports: { id: number; status: string; requestedAt: string; completedAt: string | null; content: unknown; error: string | null }[];
}
function buildPopupData(input: { instrument; sector: Instrument | null; days: StoredDay[]; levels: Levels; niftyLatest: StoredDay | null; onWatchlist: boolean; reports: … }): PopupData
```
Pins:
- `fromHigh = (close − high52)/high52`, `fromLow = (close − low52)/low52`.
- `niftyLine`: Strong Bullish/Bullish "Broad market trend supports longs"; Neutral "Market is range-bound"; Bearish/Strong Bearish "Broad market weakness"; null "Market score not available".
- `sectorLine`: rs ≥ 0 "Outperforming its sector by x.x%" else "Underperforming its sector by x.x%"; null for non-stocks.
- Pattern `effect`: bullish +3.75, bearish −3.75, doji 0 (shown as "at level" only when it scored).
- `indicatorTable` rows in order: CMP, EMA 20, EMA 50, EMA 200 (each with "(±x.xx%)" distance), RSI 14, MACD, MACD signal, MACD histogram, BB upper, BB middle, BB lower, Volume vs 20-day avg ("1.82×"), 52W high, 52W low, RS vs Nifty (4W), RS vs sector (4W). Missing → "—".
- `GET /api/instrument/[key]` → 200 `PopupData`; unknown key → 404 `{ error: "not_found" }`.
- `POST /api/reports` body `{ key }` → inserts a `pending` row with `requested_via: "site"`; returns the row; unknown key → 404. (Add `requestReport(instrumentId)` and `listReports(instrumentId)` to the Repo.)

- [ ] **Step 1: Write failing tests** for `buildPopupData`: 52-week distances; strengths from `levelStrength`; niftyLine per label; sectorLine sign and text (`0.024` → "Outperforming its sector by 2.4%"); patterns newest first limited to 10 sessions; indicator table length 16 with "—" for nulls; a stock with zero priced days → `latest` null and `score` null without throwing.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** builder, repo report methods (memory + Supabase), routes. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(api): stock pop-up payload and report requests`

---

### Task 10: Stock pop-up UI, links and search

**Files:** Create `src/app/components/popup/{StockModal,StockLink,ScoreBadge,ChartSetupTab,DeepDiveTab,PatternsTab,IndicatorTab}.tsx`, `src/app/components/shell/SearchBox.tsx`; Modify `src/app/components/chart/PriceChart.tsx`, `src/lib/view/chart.ts`, `src/app/(app)/layout.tsx`, `TopBar.tsx`, `NiftyCard.tsx`, `WatchlistTable.tsx`, `SectorHeatmap.tsx`; Test `tests/view/chart.test.ts` (extend)

**Interfaces:**
- `StockLink({ stockKey, children, className? })` — `next/link` to the current path with `?stock=KEY` merged into existing search params (keeps `?s=` on /sectors).
- `StockModal` (client, rendered once in `(app)/layout.tsx`): reads `useSearchParams().get("stock")`; when set, fetches `/api/instrument/KEY` and renders a full-screen overlay (`bg-black/60`, panel `max-w-5xl`, scrollable, focus-trapped, Esc and ✕ close by removing the param with `router.replace`, browser back also closes). Loading skeleton; 404 → "Stock not found"; no days → "Not enough price history".
  - Header (spec §4.2): name, `NSE` chip, sector name, CMP + day change (live overlay from `useQuotes` when the ticker is quoted), `ScoreBadge`, "Add to Watchlist" (POST `/api/watchlist`; shows "On watchlist" when `onWatchlist`), ✕. Indices/sectors: no watchlist button.
  - Tabs: Chart & Setup (default), AI Deep Dive, Patterns (n), Indicator Table.
- `ScoreBadge({ score, label, partial, size? })` — panel with `AI TECHNICAL SCORE`, big `49/100`, label chip; colours per spec §3 (Strong Bullish emerald-400, Bullish green-400, Neutral slate-400, Bearish orange-400, Strong Bearish rose-400); "partial data" note when partial; null score → "—".
- ChartSetupTab: `PriceChart` + three cards (Primary signal with confidence chip and six component rows `points / max`; Support & Resistance with Strong/Weak chips and M badge and 52W rows; Market & Sector tailwinds).
- PriceChart extension: overlay toggle `Bollinger` (off by default; three thin lines, upper/lower `--muted`, middle dashed); lower pane `VOLUME | RSI | MACD` (MACD line `--ema20`, signal `--ema50`, histogram coloured up/down). `buildChartData` adds `bbUpper`, `bbMiddle`, `bbLower`, `macd`, `macdSignal`, `macdHist` series (non-null points only).
- DeepDiveTab: list of reports (status chip, dates, `content` rendered as sections when `done`, error when `failed`); "Request new report" → POST `/api/reports`; disabled while a `pending` one exists.
- PatternsTab: table date / pattern (title-cased) / bias chip / effect.
- IndicatorTab: two-column table from `indicatorTable`.
- SearchBox (top bar, desktop; icon button opening an input on phones): debounced 250 ms `/api/instruments/search?q=`, extended to include indices and sectors; Enter or click → `?stock=KEY`.
- NiftyCard: `ScoreBadge` beside the trend chip (from Nifty's latest `score*` columns); the card's name opens the Nifty pop-up via `StockLink`.
- WatchlistTable and SectorHeatmap: the stock / sector name becomes a `StockLink`.

- [ ] **Step 1: Write failing tests** — `buildChartData` returns `macdHist` points only where non-null and `bbUpper` length equals non-null count in range.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** all components. **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS.
- [ ] **Step 5: Verify manually** (`npm run dev`, signed in):
  - Search "reli" → Reliance Industries → pop-up opens with chart, score badge, three cards; Esc closes; browser back closes; refresh with `?stock=RELIANCE` reopens it.
  - Every tab renders; MACD and Bollinger toggles work; Patterns count matches the tab label.
  - Watchlist row name and sector heatmap row name open the pop-up; Nifty card shows its score badge.
  - "Request new report" creates a pending report (visible in the tab) and disables the button.
  - `?stock=NOPE` → "Stock not found".
  - 390 px width: pop-up fills the screen, scrolls, no horizontal page scroll.
- [ ] **Step 6: Commit** `feat(ui): stock pop-up with score, chart setup, patterns and indicators; top-bar search`

---

### Task 11: Docs and owner check

- [ ] **Step 1:** README: niftyindices download instructions (folder layout and names), `import-niftyindices`, `backfill --universe`, EOD duration, migration 0004. Commit `docs: stage 2 setup`.
- [ ] **Step 2 (owner):** spot-check 3 stocks' scores in the pop-up against intuition (a strong uptrend stock should score Bullish or higher; a stock below all EMAs should score Bearish or lower) and confirm the pop-up matches the reference screenshot's layout before stage 3 is planned.
