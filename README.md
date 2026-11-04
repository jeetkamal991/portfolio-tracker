# Nifty Pulse

A private, single-user dark trading-terminal dashboard for Indian market data (Nifty indices, sector analysis with rotation, watchlist with level overrides). It runs on free tiers of Vercel and Supabase. Prices come from Yahoo Finance (`yahoo-finance2`), and a daily Vercel cron stores the end-of-day candles. It does not call the Claude API.

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
| `TELEGRAM_BOT_TOKEN` | yes | Optional. Your alert bot's token from @BotFather (see Alerts) |
| `TELEGRAM_CHAT_ID` | no | Optional. Your chat with the bot; `npm run telegram-setup` prints it |

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
   - `supabase/migrations/0005_holdings.sql` - adds the `holdings` table (one row per stock: quantity, average price, buy date, optional stop loss and targets). Row level security is on with no policies, like the other tables. Apply it **before** deploying stage 5 code.
   - `supabase/migrations/0006_alerts.sql` - adds the `alerts` (rules) and `alert_events` (fired alerts) tables, RLS on with no policies. Apply it **before** deploying stage 7 code.
   - `supabase/migrations/0007_report_functions.sql` - adds `complete_report` / `fail_report`, which the scheduled Claude report task calls with a plain `select` (the Supabase connector stops for approval before a direct `update`). Not callable from the site's API roles.
   - `supabase/migrations/0008_shareholding.sql` - adds the `shareholding` table (FII, DII and promoter percent per stock per quarter), RLS on with no policies. Apply it **before** deploying stage 6b code.
   - `supabase/migrations/0009_record_shareholding.sql` - adds `record_shareholding`, which the scheduled shareholding task calls with a plain `select`. Not callable from the site's API roles.
   - `supabase/migrations/0010_backtest_runs.sql` - adds the `backtest_runs` table (one row per saved backtest), RLS on with no policies. Apply it **before** the first `npm run backtest` that saves, and before opening the Backtests tab.
   - `supabase/migrations/0012_report_ready_events.sql` - adds a trigger on `reports`: every report that reaches `done` writes an unread `alert_events` row ("📄 TCS report is ready to read"), so the bell tells the owner a requested report can be read.
   A new project applies all twelve in order. The owner's Tracker1 project has 0003 to 0012 applied (0012 on 2026-11-02).
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

The cron route's `maxDuration` is 300 seconds (the most Vercel Hobby allows). If a run takes more than about 4 minutes, build the two-part EOD split (Task 8 of `docs/superpowers/plans/2026-10-18-redesign-stage2-score-universe-popup.md`) before relying on the Vercel cron.

## Screens

The app shell has seven tabs, each a route; `/login` sits outside the shell.

| Route | Tab | Contents |
| --- | --- | --- |
| `/` | Dashboard | Nifty card (price, day move, prev close, day and 52-week high/low, EMA 20/50/200 above/below with trend), interactive Nifty chart, Nifty 200 market movers, YOUR PORTFOLIO snapshot, sector strip |
| `/portfolio` | Portfolio | Summary cards, risk alerts, sortable holdings table, add/edit form (`?add=1`, `?add=<KEY>`, `?edit=<KEY>`) |
| `/watchlist` | Watchlist | Add stock, sortable watchlist table with score, EMAs, RSI, levels (manual overrides) and a 1-month sparkline |
| `/sectors` | Sector Analysis | Sector tiles with top-mover previews, the selected sector's detail and constituents (`?s=<KEY>`), sector rotation ranking, daily sector log (`?m=<YYYY-MM>`) |
| `/market` | Market | Today by Claude |
| `/alerts` | Alerts | Coming soon |

The top bar holds the tabs (a horizontal scroller under 1024 px). The status strip under it shows the market phase (PRE-OPEN / OPEN / CLOSED) with the IST clock, Nifty, Bank Nifty and India VIX (live during market hours), and the "Data as of" badge (amber when stale).

The chart uses TradingView [`lightweight-charts`](https://github.com/tradingview/lightweight-charts) v5 (Apache-2.0): candlesticks, ranges 1D-ALL on daily bars, EMA 20/50/200 overlays, and a Volume (with 20-day average) or RSI lower pane.

### Portfolio

The Portfolio tab tracks the owner's holdings, one position per stock.

- **Adding.** "Add holding" opens a form with a stock search. Picking a stock fills in the current price, score, and suggested stop loss and targets from recent swing lows and highs ("Use suggested levels"). Quantity must be a whole number above 0, the buy date can't be in the future, and stop loss / targets are optional. The form warns, without blocking, when the stop loss is at or above the buy price, Target 1 is already below the current price, or Target 2 is not above Target 1. Adding a stock you already hold merges into one position: the quantities add, the average price is the weighted average, the earlier buy date is kept, and any new stop loss or target replaces the old one.
- **New stocks.** A stock with no stored prices gets its history fetched when it is added. From then on, holdings are priced and scored by the nightly EOD job and included in the live quotes during market hours.
- **P/L.** Invested = quantity × average price; current value = quantity × CMP (the live price during market hours, else the last close); P/L = value − invested, and P/L % is against invested. Today's P/L is measured from the previous close, or from the buy price for a stock bought today. Totals leave out holdings with no price yet (shown as "without price").
- **Status and alerts.** Only the stop loss and Target 1 drive the status: SL hit (CMP at or below the stop loss), Target hit (CMP at or above Target 1), Near SL / Near target (within 2% of CMP), otherwise OK. Hits come before near warnings in the risk-alerts bar.
- **Elsewhere.** The Dashboard's YOUR PORTFOLIO panel shows the same totals and the top 4 holdings by value, or an "Add your first holding" button when empty. In the stock pop-up, "Add to Portfolio" opens the add form with the stock picked; for a held stock the button reads "In portfolio · 10 @ ₹100" and opens the edit form.

### Alerts

The Alerts tab sets alerts on any stock, index or sector, lists every rule, and shows the feed of fired alerts. "Set alert" in the stock pop-up opens the form with that stock picked.

| Condition | Fires when | Checked |
| --- | --- | --- |
| Price goes above / below a price | the price crosses to the other side of it | live during market hours, and at end of day on the close |
| Crosses EMA 20 / 50 / 200 | the close moves from one side of the EMA to the other, either way | end of day |
| RSI goes above 70 / below 30 | RSI 14 moves past the level | end of day |
| Score turns Bullish / Bearish | the label becomes Bullish or Strong Bullish (Bearish or Strong Bearish) | end of day |
| Holding stop loss / target (automatic) | the price comes within 2% of the holding's stop loss or Target 1, or reaches it | live and end of day |

- **When an alert fires.** An alert fires only on a change. A stock that stays above its EMA 200 for weeks fires once, on the day it crosses. A new rule records where things stand now and doesn't fire; if the condition is already true, the form says so, and the alert fires the next time it becomes true. If data is missing (no price, no EMA yet), the alert is skipped and keeps its last state.
- **Once / Every time.** "Once" switches the rule off after it fires; resume it from the list. "Every time" fires again only after the condition has gone false and then true again. A rule fires at most once every 15 minutes.
- **Holdings.** Every holding with a stop loss or Target 1 gets its own rules automatically, listed under "From your portfolio". They follow the holding: editing the stop loss changes the rule, and removing the holding removes them. They can't be paused or deleted from the Alerts tab. A holding rule fires each time its level rises: from clear to near, and from near to hit (straight to hit counts too). Falling back doesn't fire, so a price sitting near the stop loss all afternoon fires once.
- **Live and end of day.** During market hours the price and holding rules are checked against live quotes at most once a minute, but only while the dashboard is open somewhere, because the check runs inside the live quotes request. The nightly EOD run (after the scores) checks every rule on the close, so nothing is missed when the site is closed. The EOD run message reports `alerts fired N, telegram failed N`.
- **Feed and bell.** The bell in the top bar shows the unread count, refreshed every minute and when you come back to the tab, and lists the latest five alerts. Opening the bell doesn't mark them read; click an alert in the feed, or "Mark all read".
- **Telegram.** Each alert is also sent to your own Telegram bot. A failed send is recorded on the alert (⚠ in the feed, with the reason on hover) and never stops other alerts. To connect:
  1. In Telegram, open **@BotFather**, send `/newbot`, choose a name and a username ending in `bot`, and copy the token. Open your new bot and send it any message.
  2. Add `TELEGRAM_BOT_TOKEN=<token>` to `.env.local` and run `npm run telegram-setup`. It prints your chat id.
  3. Add `TELEGRAM_CHAT_ID=<id>` to `.env.local` and run `npm run telegram-setup` again: "✅ Nifty Pulse alerts are connected" arrives in Telegram.
  4. Add both settings in Vercel (Settings > Environment Variables) and redeploy. The Alerts tab then shows "Telegram connected".

### Watchlist

Columns: stock, price, day %, EMA 20/50/200 (each green when the price is at or above it, red below; EMA 200 shows "—" with a "not enough history" tooltip for a stock with too few sessions), trend chip (above all / mixed / below all three EMAs), RSI 14, support and resistance (a manual value overrides the auto one), Technical Score with its label, and a 1-month sparkline. Click any column header to sort; click it again to reverse. Empty values always sort last, ties sort by stock key, and the default is score, highest first. During market hours the price and day % update from live quotes every 60 s; a stock Yahoo omits keeps its stored values.

### Market movers

The Dashboard's MARKET MOVERS panel lists the five biggest Nifty 200 gainers and losers by day % and an advance/decline breadth bar with the A/D ratio. It comes from `GET /api/movers`. During market hours it overlays one batched live quote call (refreshed every 60 s and labelled LIVE, or "at close" if the tab stays open past 15:30 IST; on a weekday NSE holiday Yahoo's quotes are the last session's, so it is not labelled LIVE); otherwise it shows the newest stored session, dated from NIFTY 50, so weekends and holidays show the last trading day. A stock with a zero move counts as unchanged and appears in neither list.

The panel depends on the Nifty 200 import (Stage 2 above). Until `NIFTY200.csv` has been imported it says "Market movers appear after the Nifty 200 list is imported."; with the list but no prices for the session date it says "No session data yet."

### Alpha ranks

Below the screeners, the Market tab shows an "Alpha rank" card and six alpha cards. Each alpha scores every Nifty 200 stock priced on the session from its last 30 sessions of open, high, low, close and volume, and the card lists the ten highest and ten lowest. The formulas are alphas #1, 2, 6, 12, 54 and 101 from Z. Kakushadze (2015), "101 Formulaic Alphas" (arXiv:1601.00991), written in `src/lib/calc/alpha/`. The "Alpha rank" card is each stock's mean rank across the alphas that scored it (0 to 100, only for stocks scored by at least three).

These are short-horizon (about five-day) statistical ranks, not a buy or sell call. Two limits to know: alphas #1 and #54 take only a few distinct values, so many stocks tie and the lists show an alphabetical slice of the tied group; and a stock needs an alpha's minimum history (25 sessions for #1, 10 for #2 and #6) to be scored by it, so recently listed stocks drop out of those cards. The alphas are computed on each Market page load from stored candles, with no stored results and no new table.

### Stake-increase screeners

Below the screeners, the Market tab shows "FII increased stake" and "DII increased stake": the ten Nifty 200 stocks whose holding rose most in percentage points versus the previous quarter (for example `48.1% -> 49.6%`, `+1.5 pts`). Only stocks with a row for both quarters count, and the sub-header shows how many of the 200 have reported for the latest quarter (`164 / 200 reported`), so a half-collected quarter is visible. The stock pop-up's indicator table also gets FII holding and DII holding rows with the change versus the previous quarter. Until the first collection the cards say "Shareholding data appears after the quarterly update runs."

The data is collected by a Claude scheduled task that follows `docs/claude-tasks/shareholding.md` (about 50 stocks per run; it writes through `record_shareholding`, and a re-run replaces, never duplicates). To fill or refresh a quarter by hand, tell Claude "run the shareholding task".

### Sector Analysis

The tab shows the 11 sectors as tiles: day % (tile colour by direction, saturating at a 2% move), Technical Score and RSI. On a desktop, hovering or tabbing to a tile previews its top 3 gainers and losers. Clicking a tile selects it (`/sectors?s=NIFTY_IT`, also where the Dashboard's sector strip lands) and opens the detail panel: 1D/1W/1M/3M returns, trend vs EMA 50/200, RS vs Nifty over 4 weeks, score, a View chart button, and the constituent table sorted by day %. An unknown `?s=` selects nothing. All values come from the last stored session (no live quotes on this tab).

**Rotation.** Sectors are ranked by RS vs Nifty (20 sessions) at the last session of each week: Friday, or the last trading day before a Friday holiday, and the latest session for the current week. Week change is last week's rank minus this week's, so ▲ means the sector moved up. The sparkline shows the rank over the last 8 weeks. Because this is computed from the stored daily RS, it needs no weekly job and has history from day one.

Constituents come from the niftyindices import (Stage 2). Until then the previews and the table say "Constituents appear after the niftyindices import." The 8 thin sectors (Auto, Fin, FMCG, Media, Metal, PSU Bank, Pvt Bank, Healthcare) need their niftyindices **history** files for 1W/1M/3M returns, trend, RSI and RS; without them those show "—" and the score is a partial 50 and sit unranked at the bottom of the rotation list.

**Daily sector log.** A DAILY SECTOR LOG panel at the bottom of the tab reproduces the owner's manual spreadsheet automatically. It has one tab per month for the last 6 months, newest first, shown along the bottom like spreadsheet sheet tabs. Each month starts with a Total row (the sum of its daily %; hovering shows the compounded figure), followed by one row per trading day, with columns for NIFTY and the 11 sectors in the sheet's order. Cells are green or red, and the colour strengthens with the move, saturating at 3% for a day and 10% for a total. The selected month is kept in the URL (`/sectors?m=2026-10`, alongside `?s=`); an unknown month shows the current one. Values are the stored daily % (`pct_change`), falling back to the owner's imported manual log (`data/history.xlsx`), so imported months match the sheet cell for cell and days the manual log lacked are filled from Yahoo. Totals can differ from the sheet by a rounding hair because the app sums full-precision values. Thin sectors show "—" in months before their niftyindices history files are imported.

### Stock pop-up

Clicking a stock opens a pop-up with its score, chart setup, patterns and indicators. It opens from the top-bar search, the Nifty card, watchlist names, market-mover names, sector constituent names and a sector's View chart button. The URL gets `?stock=<KEY>`, so a pop-up can be bookmarked or shared (it still needs the owner's sign-in).

## Backtests

A backtest runs on your PC, not on the site. `npm run backtest -- <strategy> [options]` reads the stored history from Supabase once, simulates the strategy, and saves one row to `backtest_runs`; the Backtests tab only displays saved runs. It needs `.env.local` (like the other scripts) and migration `0010` applied.

```
npm run backtest -- alpha --alpha a101 --top 10 --hold 5 [--stop 7] [--from 2020-01-01] [--name "..."]
npm run backtest -- rule  --rule golden --hold 10 --stop 8 [--max-positions 10]
npm run backtest -- hold  --key NIFTY50 --max-positions 1 --hold 100000     # control: buy and hold
npm run backtest -- random --seed 1                                         # control: seeded random picks
npm run backtest -- ... --dry-run                                           # print the result, save nothing
```

- **Strategies.** `alpha` buys the top N stocks by one of the six alphas (a001, a002, a006, a012, a054, a101); `rule` buys the stocks a screener rule fires on (`vol_up`, `vol_down`, `breakout`, `breakdown`, `golden`, `death`, `rsi_high`, `rsi_low`); `hold` and `random` are controls. The Technical Score rules are left out: the stored score is on 0% of the history rows.
- **Rules of the simulation.** A stock the strategy still wants when its hold ends is kept and the hold restarts, so it is not sold and bought back. A signal on the close of day t is bought at the open of day t+1, so a strategy never sees a later row. Defaults: 1,000,000 rupees, up to 10 positions (`--max-positions`), sold at the open 5 sessions later (`--hold`), optional stop loss `--stop` percent below entry checked against each day's low (a gap below fills at the open). Each position gets about 1/K of current equity. Costs on every fill are the NSE delivery charges (STT, exchange, SEBI, stamp duty, GST) plus 0.1% slippage; the rates are constants in `src/lib/calc/backtest/costs.ts` and should be checked against your broker's current schedule.
- **Results.** CAGR, total return, max drawdown, volatility, Sharpe (risk-free rate 0), hit rate, average win and loss, trades, turnover and time invested, next to Nifty 50 buy-and-hold over the same dates (price only, no costs).
- **Read with care.** Only today's Nifty 200 members are tested, so stocks that left the index or were delisted are missing (survivorship bias flatters results). Prices only, no dividends. No circuit limits and no liquidity cap. Alphas #1 and #54 take few distinct values, so a top-N pick among ties is arbitrary (stock-key order). Every run's page repeats these. A trade that spans a daily move of 35% or more is marked "check data" on the page, and the run's note counts them. A run with more than 10,000 trades is refused for saving (add `--dry-run` to see it, or use a longer `--hold` or fewer `--max-positions`).
- **Data check.** Each run prints a data report. It flags daily moves of 35% or more, a sign of splits or demergers Yahoo did not adjust: on the owner's data PATANJALI (2020-01-27), MOTILALOFS (2024-01-01) and VEDL (2026-04-30) look unadjusted, so a run that holds them can show a fake crash.
- **Time.** About 45 s for an alpha or random run and about 90 s for a rule run, over roughly 1,700 sessions and 200 stocks.
- **Controls to trust a result.** `hold --key NIFTY50` should land within about 2 points of the benchmark's total return, and `random` should not beat Nifty 50 by a wide margin; if either does, suspect a bug.

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
3. Set the env vars from the table above (use the generated `CRON_SECRET`; the two Telegram ones are optional).
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
