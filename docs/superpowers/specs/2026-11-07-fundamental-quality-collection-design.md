# Fundamental Quality: collect-only (design)

Date: 2026-11-07. Status: draft for the owner's review. Nothing here is built.

## Goal
Find out whether Yahoo Finance's fundamentals for Indian stocks are complete and trustworthy enough to score. This step only **collects and measures**. It changes no score, ranking, alert or screen.

## Decisions already made
- Universe: the Nifty 200 plus all holdings and watchlist stocks (about 240).
- Fields: the 15 below, stored exactly as Yahoo returns them. Nothing is derived or defaulted.
- Run: a local script, run by the owner about once a week. A cron comes later only if the data proves worth scoring.
- Scoring starts only if per-field coverage is about 80% or better over several weeks, banks and NBFCs judged separately.

## Fields
Yahoo `quoteSummary` modules, field names as Yahoo gives them.

| Group | Fields | Module |
| --- | --- | --- |
| Profitability | returnOnEquity, returnOnAssets, profitMargins, operatingMargins | financialData |
| Growth | revenueGrowth, earningsGrowth (latest period vs the year-ago period) | financialData |
| Balance sheet | debtToEquity, currentRatio, totalDebt, totalCash | financialData |
| Cash flow | freeCashflow, operatingCashflow | financialData |
| Valuation | trailingPE, marketCap (summaryDetail), priceToBook (defaultKeyStatistics) | summaryDetail, defaultKeyStatistics |

Notes: Yahoo reports `debtToEquity` as a percentage-style number (45.3 means 0.453) and growth and margins as fractions. Store raw and record the units here; do not convert. `marketCap` is stored mainly as a test: the Rankings page says no current provider supplies it.

## Data model (migration 0021, to be applied only with the owner's yes)
Table `fundamentals_snapshots`:
- `instrument_id` (fk), `fetched_on` (date), primary key (`instrument_id`, `fetched_on`): one row per stock per day, so re-running the same day overwrites rather than duplicates.
- One typed numeric column per field above, null when Yahoo returned nothing.
- `missing text[]`: the field names that came back empty, so coverage is a simple count.
- `is_financial boolean`: true for banks, NBFCs and other financials (from the stock's sector membership), so coverage can be split.
- `raw jsonb`: the full Yahoo response for the three modules, so other fields can be read later without refetching.
- `fetched_at timestamptz`. RLS on with no policies, like the other tables.

## The script
`npm run collect-fundamentals` (`scripts/collect-fundamentals.ts`), reusing the repo's Supabase admin client and the `yahoo-finance2` package already installed.
1. List the universe (Nifty 200 constituents, holdings, watchlist), each with its Yahoo ticker.
2. Fetch the three modules per stock, 4 at a time with a short pause between batches, with up to 3 attempts on a transient error. A symbol Yahoo does not know is recorded with every field missing, not skipped silently.
3. Upsert rows in batches of 100.
4. Print a coverage report: per field, how many stocks returned a value, for financials and non-financials separately, plus the stocks with the most missing fields.
Flags: `--dry-run` (fetch and report, write nothing), `--only TCS,INFY` (a few symbols), `--report` (coverage from stored rows for the latest fetch date, no fetching).

## Pure logic and tests
`src/lib/calc/fundamentals.ts` (pure): turn a Yahoo response into a row (typed columns, `missing`, `raw`) and compute coverage from rows. Unit tests: a full response, a response with some modules absent, nulls and non-numeric values becoming missing, the financials split, and coverage maths. The script itself has no test beyond a dry run against a few real symbols.

## Out of scope
Scoring, UI, alerts, quarterly statements and history, promoter and shareholding data (already collected separately), scraping any site, and converting units.

## Risks
- Yahoo may return empty or stale fundamentals for many Indian stocks. That is exactly what this step measures.
- Yahoo can throttle a heavy run. Mitigation: small batches, a pause, retries, and the script is safe to re-run.
- It uses an unofficial endpoint. Acceptable for a measurement; revisit before relying on it for scores.

## Success
After 3 to 4 weekly runs, the coverage report shows per field whether coverage is about 80% or better for non-financials and for financials. Only then does a scoring design start.

## Next
On the owner's approval of this spec: a short implementation plan, then tests first, then the script. The migration waits for a separate yes.
