# Nifty Pulse

A private, single-user dark trading-terminal dashboard for Indian market data (Nifty indices, sector heatmap, watchlist with level overrides). It runs on free tiers of Vercel and Supabase. Prices come from Yahoo Finance (`yahoo-finance2`), and a daily Vercel cron stores the end-of-day candles. It does not call the Claude API.

## Prerequisites

- Node.js 20.12 or newer (the scripts use `process.loadEnvFile`)
- A Supabase project
- A Vercel account (for deploy)

## Environment

Copy the keys from `.env.example` into `.env.local` (never commit it):

| Key | Secret? | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | no | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no (public; RLS denies it all table access) | Supabase anon key, used only for sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server routes and `scripts/` only. Never expose it to the browser. |
| `CRON_SECRET` | yes | Bearer token for `/api/cron/eod` |

Generate `CRON_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Database setup

1. Apply the migrations in order to your project (Supabase SQL editor, or the Supabase CLI):
   - `supabase/migrations/0001_init.sql` - tables, with row level security enabled on all of them.
   - `supabase/migrations/0002_drop_open_policies.sql` - drops the `owner_all` policies. RLS stays enabled with no policies, so the anon key and signed-in sessions cannot read or write any table. All data access goes through server code with the service-role key, which bypasses RLS.
   - `supabase/migrations/0003_ema20.sql` - adds the stored `ema20` column. Apply it **before** deploying code that writes EMA 20 (the EOD job and back-fill fail on the unknown column otherwise), then re-run `npm run backfill -- --from 2015-01-01` to compute EMA 20 over full history for the indices and sectors.
   - `supabase/migrations/0004_indicators_score_universe.sql` - adds the new indicator columns (MACD, Bollinger, 52-week range, volume average), the stored Technical Score, and the `index_constituents` table. Apply it **before** deploying stage 2 code.
   A new project applies all four in order. The owner's Tracker1 project already has 0003 and 0004.
2. In Supabase Auth, add the owner user, then turn off "Allow new users to sign up".

## Data scripts

Run in this order from the repo root. They read `.env.local`. The input files live in `data/`, which is git-ignored: download or copy them there locally; never commit them.

1. `npm run seed` - loads instruments from `data/EQUITY_L.csv` (download it from NSE into `data/`; it is not committed). Check that the instrument count looks right.
2. `npm run verify-tickers` - checks each Yahoo ticker against `data/history.xlsx` and prints OK or THIN per instrument. Look for any THIN or failed tickers.
3. `npm run backfill -- --from 2015-01-01` - downloads daily candles from the given date. It prints candles per instrument; instruments with fewer than 200 are marked THIN.
4. `npm run import-history -- --dry-run` - parses `data/history.xlsx` and prints the report without writing. Check the report, then run `npm run import-history` to write the rows.
5. `npm run compare-import` - compares imported history with the stored data. Look for differences; none should exceed 0.0005.

### Stage 2: Nifty 200 universe, sector history and scores

Stage 2 adds stock data for the Nifty 200 and the sector constituents. The files come from niftyindices.com (download them by hand) and go in `data/niftyindices/`, which is git-ignored. Name them by key so the importer needs no guessing:

- `data/niftyindices/constituents/NIFTY200.csv` and `data/niftyindices/constituents/<KEY>.csv` for the 11 sectors: `NIFTY_BANK`, `NIFTY_FIN`, `NIFTY_PVT_BANK`, `NIFTY_PSU_BANK`, `NIFTY_IT`, `NIFTY_PHARMA`, `NIFTY_HEALTHCARE`, `NIFTY_AUTO`, `NIFTY_FMCG`, `NIFTY_METAL`, `NIFTY_MEDIA`. Use the site's "Download list of constituents" CSV (columns `Company Name, Industry, Symbol, Series, ISIN Code`). That is 12 files.
- `data/niftyindices/history/<KEY>*.csv` for the 8 sectors Yahoo has little history for: `NIFTY_AUTO`, `NIFTY_FIN`, `NIFTY_FMCG`, `NIFTY_MEDIA`, `NIFTY_METAL`, `NIFTY_PSU_BANK`, `NIFTY_PVT_BANK`, `NIFTY_HEALTHCARE`. Several files per key are fine because the site limits each download's date range, for example `NIFTY_AUTO_2015-2019.csv` and `NIFTY_AUTO_2020-2026.csv`.

Then, from the repo root:

1. `npm run import-niftyindices -- --dry-run` - parses every file and prints the report without writing. Check `missing`, `unknown keys` and `parse errors`; all three should say `none`. (`--dir <folder>` reads from a different folder than `data/niftyindices`.)
2. `npm run import-niftyindices` - writes the new stock instruments, the constituent lists and the sector history. Safe to re-run.
3. `npm run backfill -- --from 2015-01-01` - indices and sectors. It now also computes the new indicators and the Technical Score.
4. `npm run backfill -- --universe` - candles for the Nifty 200, the sector constituents and the watchlist stocks, from 2019-01-01 (`--from <date>` overrides). Expect roughly 15-30 minutes. It prints one line per instrument and lists any that failed; re-run to retry.

**Technical Score.** Each instrument gets a score from 0 to 100 and one of five labels: Strong Bullish (75 and up), Bullish (60-74), Neutral (45-59), Bearish (30-44), Strong Bearish (below 30). It is computed on each nightly EOD run for the latest session only, so history builds up one row per day. The components and weights are in section 5 of `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md`.

**EOD duration (to check).** The EOD run has not been timed over the full Nifty 200 universe, because the constituents were not imported yet. After the first full import, with the dev server running, time one run:

```powershell
Measure-Command { curl.exe -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/eod }
```

If it takes more than 45 seconds, build the two-part EOD split (Task 8 of `docs/superpowers/plans/2026-10-18-redesign-stage2-score-universe-popup.md`) before relying on the Vercel cron, which stops at 60 seconds.

## Screens

The app shell has six tabs, each a route; `/login` sits outside the shell.

| Route | Tab | Contents |
| --- | --- | --- |
| `/` | Dashboard | Nifty card (price, day move, prev close, day and 52-week high/low, EMA 20/50/200 above/below with trend), interactive Nifty chart, Nifty 200 market movers, sector strip |
| `/portfolio` | Portfolio | Coming soon |
| `/watchlist` | Watchlist | Add stock, sortable watchlist table with score, EMAs, RSI, levels (manual overrides) and a 1-month sparkline |
| `/sectors` | Sector Analysis | Sector heatmap (`?s=<KEY>` outlines one sector) |
| `/market` | Market | Today by Claude |
| `/alerts` | Alerts | Coming soon |

The top bar holds the tabs (a horizontal scroller under 1024 px). The status strip under it shows the market phase (PRE-OPEN / OPEN / CLOSED) with the IST clock, Nifty, Bank Nifty and India VIX (live during market hours), and the "Data as of" badge (amber when stale).

The chart uses TradingView [`lightweight-charts`](https://github.com/tradingview/lightweight-charts) v5 (Apache-2.0): candlesticks, ranges 1D-ALL on daily bars, EMA 20/50/200 overlays, and a Volume (with 20-day average) or RSI lower pane.

### Watchlist

Columns: stock, price, day %, EMA 20/50/200 (each green when the price is at or above it, red below; EMA 200 shows "—" with a "not enough history" tooltip for a stock with too few sessions), trend chip (above all / mixed / below all three EMAs), RSI 14, support and resistance (a manual value overrides the auto one), Technical Score with its label, and a 1-month sparkline. Click any column header to sort; click it again to reverse. Empty values always sort last, ties sort by stock key, and the default is score, highest first. During market hours the price and day % update from live quotes every 60 s; a stock Yahoo omits keeps its stored values.

### Market movers

The Dashboard's MARKET MOVERS panel lists the five biggest Nifty 200 gainers and losers by day % and an advance/decline breadth bar with the A/D ratio. It comes from `GET /api/movers`. During market hours it overlays one batched live quote call (refreshed every 60 s and labelled LIVE); otherwise it shows the newest stored session, dated from NIFTY 50, so weekends and holidays show the last trading day. A stock with a zero move counts as unchanged and appears in neither list.

The panel depends on the Nifty 200 import (Stage 2 above). Until `NIFTY200.csv` has been imported it says "Market movers appear after the Nifty 200 list is imported."; with the list but no prices for the session date it says "No session data yet."

### Stock pop-up

Clicking a stock opens a pop-up with its score, chart setup, patterns and indicators. It opens from the top-bar search, the Nifty card, watchlist names, market-mover names and sector heatmap names. The URL gets `?stock=<KEY>`, so a pop-up can be bookmarked or shared (it still needs the owner's sign-in).

## Known data caveat

Yahoo sometimes returns only the latest bar for several NSE sector indices. `verify-tickers` marks these THIN. The back-fill and the EOD job only upsert, so once `verify-tickers` shows them OK, re-run `npm run backfill -- --from 2015-01-01` to fill the history.

## Local dev

```powershell
npm run dev        # http://localhost:3000
npm test
npm run typecheck
npm run lint
npm run build
```

## Deploy (owner)

1. Create a private GitHub repo and push this project.
2. In Vercel, import the repo.
3. Set the four env vars from the table above (use the generated `CRON_SECRET`).
4. Deploy.
5. Verify the cron route:
   ```powershell
   curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://<app>.vercel.app/api/cron/eod
   ```
   It should return a JobRun with status `ok` (or `no_session` on a holiday or weekend). Without the header it should return 401:
   ```powershell
   curl.exe -i https://<app>.vercel.app/api/cron/eod
   ```
6. In Vercel, Settings > Cron Jobs should list `/api/cron/eod` at `0 11 * * 1-5` (11:00 UTC, 4:30 PM IST, Mon-Fri). On the Hobby plan the job can fire at any time within that hour.

## First-week check

For the next 5 trading days, after 4:30 PM IST, keep logging manually as before. Then update the sheet and run:

```powershell
npm run import-history
npm run compare-import
```

Expected: no differences above 0.0005. Investigate any larger mismatch before you stop the manual log.

## Security notes

- Rotate the Supabase service-role key if it was ever shared.
- The app is single-user: pages and API routes require the owner's sign-in (middleware), sign-ups are disabled, and RLS (with no policies after `0002`) blocks direct table access with the anon key. Keep sign-ups off.
