# Nifty Market Dashboard — Design Spec

**Date:** 2026-10-16
**Status:** Draft for review
**Owner:** RealWebArts (private, single user)

## 1. Purpose

Replace the manual daily log of Nifty % change with an automated private dashboard, and extend it with watchlist tracking, sector momentum, rotation, history stats, and Claude-written daily summaries and stock reports — all running on free tiers plus the owner's existing Claude subscription (no Claude API).

**Success criteria**
- Daily Nifty / Bank Nifty / sector % changes are logged automatically every trading day with no manual input, and match the owner's manual log during a first-week check.
- Imported manual history plus new data appear as one continuous record in the calendar and stats.
- Watchlist and sectors show EMA 50/200 position, support/resistance and rotation without manual calculation.
- A Claude day summary appears each trading evening; stock reports can be requested from the site or a Claude chat.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Audience | Private, single user |
| Data freshness | Hybrid: EOD for analysis; delayed (~15 min) live strip |
| Data source | Free (Yahoo Finance) behind a swappable provider interface; broker can be added later |
| Stack | Next.js on Vercel (free plan) + Supabase (Postgres, auth) |
| History | Import owner's manual sheet `data/history.xlsx` (Aug 13 2026 onward); back-fill earlier years from the provider |
| v1 extras | Calendar heatmap + monthly/yearly stats. Breadth, alerts, derivatives deferred |
| Watchlist | Edited in the app; type-to-search by stock name; auto back-fill |
| Support/resistance | Auto swing levels + manual override (manual wins) |
| Claude | Subscription only: scheduled tasks + chat via Supabase connector. No API |
| Claude advice | Analysis and scenarios only; no buy/sell calls |

## 3. Architecture

### 3.1 Components
1. **Next.js app (Vercel)** — pages, API routes, scheduled EOD function. Protected by Supabase auth (one account).
2. **Supabase** — Postgres database + auth. Row-level security restricts all tables to the owner.
3. **Data provider module** — single interface:
   - `getDailyHistory(symbol, from, to) → candles[]`
   - `getQuotes(symbols[]) → quotes[]`
   - `searchSymbols(text)` is served from the local `instruments` table, not the provider.
   v1 implementation: Yahoo Finance. A broker implementation can replace it without other changes.
4. **Calculations module** — pure functions: % change, EMA, RSI(14), relative strength, swing levels, streaks, monthly/yearly returns. No I/O.
5. **Claude scheduled tasks** (owner's Claude account) — daily summary task and report-queue task, reading and writing Supabase through the Supabase connector.

### 3.2 Data model
- `instruments` — id, symbol, provider ticker, name, type (`index` | `sector` | `stock`), active flag. Seeded with Nifty 50, Bank Nifty, India VIX, the 11 sectoral indices the owner already tracks (Auto, Bank, Financial Services, FMCG, IT, Media, Metal, Pharma, PSU Bank, Private Bank, Healthcare), and the NSE equity list for search.
- `daily_prices` — instrument_id, date, open, high, low, close, volume, pct_change, ema50, ema200, rsi14, rs_vs_nifty. Unique on (instrument_id, date). Source column marks `import` vs `provider`.
- `watchlist` — instrument_id, added_at.
- `levels` — instrument_id, auto_support, auto_resistance, manual_support (nullable), manual_resistance (nullable), updated_at. Effective level = manual if set, else auto.
- `rotation_snapshots` — week_ending, instrument_id, rs_score, rank, group (`sector` | `watchlist`).
- `daily_summaries` — date, summary, market_events (jsonb: title, explanation, source_url ×3), watchlist_news (jsonb, ≤5 items, may be empty), created_at.
- `reports` — id, instrument_id, status (`pending` | `done` | `failed`), requested_at, completed_at, requested_via (`site` | `chat`), content (jsonb sections), error.
- `job_runs` — job name, started_at, finished_at, status, message.

### 3.3 Data flow
- **EOD job** — Vercel scheduled function, Mon–Fri 4:30 PM IST (11:00 UTC). For every active index, sector and watchlist stock: fetch the latest candle, upsert `daily_prices`, compute indicators, update auto `levels`. On Fridays, write `rotation_snapshots`. Retries each fetch up to 3 times. Logs to `job_runs`.
- **Live strip** — dashboard polls an API route every 60 s during market hours (9:15 AM–3:30 PM IST). The route caches provider quotes ~60 s. Outside market hours the strip shows the last close.
- **Add stock** — search autocompletes from `instruments`; on save, back-fill ~2 years of daily history, compute indicators and levels immediately.
- **History import** — one-time script maps `data/history.xlsx` into `daily_prices` (source = `import`). Supports a dry run that reports row count, date gaps and outliers before writing.
  - File layout: one sheet per month (`AUG`, `SEP`, `OCT`…). Row 1 = headers (`Date`, `NIFTY`, `AUTO`, `BANK`, `Financial`, `FMCG`, `IT`, `MEDIA`, `METAL`, `PHARMA`, `PSU BANK`, `PVT BANK`, `HEALTHCARE`; trailing spaces trimmed). Row 2 = `Total` (skipped). Data rows are those whose first cell is a date. Values are fractions (−0.0088 = −0.88%).
  - Column → instrument mapping: `BANK` = Nifty Bank, `Financial` = Nifty Financial Services, the rest map to the Nifty index of the same name.
  - Blank cells are skipped, not stored as zero (the AUG sheet has one partly blank row).
  - Imported rows carry pct_change only; the provider back-fill supplies OHLC for the same dates. Where both exist, the provider close is stored and the imported % is kept for the first-week comparison.
- **Earlier history** — the manual log starts 13 Aug 2026, so the calendar and stats back-fill Nifty and the 11 sectors from the provider for prior years (default: from 2015).

### 3.4 Calculation definitions
- **% change** = (close − previous close) / previous close × 100.
- **EMA 50 / 200** on daily closes, standard smoothing 2/(n+1), seeded with the SMA of the first n closes.
- **Trend tag** — above both EMAs / between / below both.
- **RSI** — 14-period, Wilder smoothing.
- **Relative strength score** — instrument's trailing 4-week return minus Nifty 50's trailing 4-week return. Used for rotation ranking; snapshot each Friday close.
- **Swing levels** — over the last 60 trading days, a swing high/low is a bar whose high/low is the extreme of the 5 bars on each side. Levels within 1% of each other are merged. Auto support = nearest merged swing low below CMP; auto resistance = nearest merged swing high above CMP.
- **Near-level highlight** — CMP within 1% of effective support or resistance.

## 4. Screens

### 4.1 Dashboard (home)
- **Live strip** — Nifty, Bank Nifty, VIX, watchlist: price and day %.
- **Today by Claude** card — day summary, top 3 market happenings with sources, watchlist news (hidden when empty). Shows "No summary for today" if absent.
- **Today's summary** — Nifty and Bank Nifty % change.
- **Sector momentum heatmap** — rows = sectors; columns 1D / 1W / 1M / 3M returns, colour-scaled; trend tag per sector.
- **Watchlist table** — stock, CMP, day %, EMA 50, EMA 200, % from each EMA, trend tag, support, resistance, % distance to each; near-level rows highlighted; manual levels marked "M"; levels editable inline (clear to revert to auto).
- **Add stock** box with type-to-search; remove action per row.
- "Data as of" badge, amber when data is stale.

### 4.2 Rotation
- Toggle: sectors / watchlist stocks.
- Ranked by latest RS score; arrow + number for rank change since last week; 8-week rank sparkline per row.

### 4.3 History
- Calendar heatmap of Nifty daily % change, one grid per year, imported history to today; hover shows value; clicking a day opens that day's Claude summary when one exists.
- Monthly and yearly returns table. Monthly "Total" = sum of daily % changes, matching the owner's sheet; the compounded return is shown alongside.
- Stats: best/worst days, current and longest win/loss streaks, average move by weekday.

### 4.4 Search
- Type a stock name → instant computed numbers: CMP, EMA 50/200, % from each, RSI, trend tag, swing support/resistance, 52-week high/low and distance.
- **Analyse** button → creates a `pending` report.
- Report view sections: fundamentals (valuation vs sector, growth, debt, recent results, news), technicals (trend, momentum, EMA position, volume, Claude's own support/resistance), scenarios (bullish and bearish case with confirming/invalidating levels), key risks. A note states it is analysis, not investment advice.
- Past reports listed per stock, newest first.

Layout is desktop-first; tables scroll horizontally on phones.

## 5. Claude tasks (subscription, no API)

1. **Daily summary** — scheduled task, Mon–Fri ~5:15 PM IST. Reads the day's rows from Supabase, searches the web for market news and watchlist-stock news, writes one `daily_summaries` row. Skips on days with no session.
2. **Report queue** — scheduled task, hourly (9 AM–10 PM IST). Picks `pending` reports, researches, writes content, marks `done` or `failed` with an error message.
3. **Chat-triggered report** — in any Claude chat, "Dashboard report for SYMBOL" produces the same report and saves it with `requested_via = chat`.

Notes: runs count toward subscription usage. Scheduled runs may pause for approval before writing to Supabase unless the task is switched to automatic approval (where the plan allows). The prompts for these tasks live in the repo so they can be versioned.

## 6. Error handling
- Provider fetch failure → 3 retries → keep last good data, stale badge, `job_runs` entry.
- Holiday / no new candle → logged as "no session", no rows written.
- Insufficient history (<200 days) → EMA 200 shown as "not enough history".
- Unknown or delisted symbol on add → clear error, nothing saved.
- Claude task missing/failed → "No summary for today" / "Pending since …" / "Failed — request again".
- All jobs idempotent: re-running a day upserts the same rows.

## 7. Testing
- Unit tests for every calculation against known reference values.
- Provider mocked in all tests.
- Import dry-run validated against the source file before writing.
- First-week check: app % changes compared against the owner's manual log.

## 8. Build order
1. Foundation — schema, auth, provider module, EOD job, history import.
2. Dashboard — live strip, today's summary, sector heatmap, watchlist with levels.
3. History — calendar heatmap, monthly/yearly table, stats.
4. Rotation.
5. Search tab — instant numbers and report storage/view.
6. Claude tasks — daily summary, report queue, chat-triggered report.

## 9. Out of scope for v1
Market breadth (A/D, % above 200 EMA), FII/DII flows, derivatives (PCR, OI), alerts (Telegram/email), broker live data, public access.

## 10. Open items
- Watchlist size not yet stated; design assumes up to ~50 stocks for the 60 s live strip.
- Exact provider tickers for each sectoral index confirmed during build.
