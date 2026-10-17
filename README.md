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
2. In Supabase Auth, add the owner user, then turn off "Allow new users to sign up".

## Data scripts

Run in this order from the repo root. They read `.env.local`. The input files live in `data/`, which is git-ignored: download or copy them there locally; never commit them.

1. `npm run seed` - loads instruments from `data/EQUITY_L.csv` (download it from NSE into `data/`; it is not committed). Check that the instrument count looks right.
2. `npm run verify-tickers` - checks each Yahoo ticker against `data/history.xlsx` and prints OK or THIN per instrument. Look for any THIN or failed tickers.
3. `npm run backfill -- --from 2015-01-01` - downloads daily candles from the given date. It prints candles per instrument; instruments with fewer than 200 are marked THIN.
4. `npm run import-history -- --dry-run` - parses `data/history.xlsx` and prints the report without writing. Check the report, then run `npm run import-history` to write the rows.
5. `npm run compare-import` - compares imported history with the stored data. Look for differences; none should exceed 0.0005.

## Screens

The app shell has six tabs, each a route; `/login` sits outside the shell.

| Route | Tab | Contents |
| --- | --- | --- |
| `/` | Dashboard | Nifty card (price, day move, prev close, day and 52-week high/low, EMA 20/50/200 above/below with trend), interactive Nifty chart, sector strip |
| `/portfolio` | Portfolio | Coming soon |
| `/watchlist` | Watchlist | Add stock, watchlist table with manual level overrides |
| `/sectors` | Sector Analysis | Sector heatmap (`?s=<KEY>` outlines one sector) |
| `/market` | Market | Today by Claude |
| `/alerts` | Alerts | Coming soon |

The top bar holds the tabs (a horizontal scroller under 1024 px). The status strip under it shows the market phase (PRE-OPEN / OPEN / CLOSED) with the IST clock, Nifty, Bank Nifty and India VIX (live during market hours), and the "Data as of" badge (amber when stale).

The chart uses TradingView [`lightweight-charts`](https://github.com/tradingview/lightweight-charts) v5 (Apache-2.0): candlesticks, ranges 1D-ALL on daily bars, EMA 20/50/200 overlays, and a Volume (with 20-day average) or RSI lower pane.

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
