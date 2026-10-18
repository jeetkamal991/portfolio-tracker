# Progress notes — Nifty dashboard

_Updated 2026-10-18 — stage 4 complete and reviewed_

## Done
- **Foundation + redesign stage 1**: on `feat/foundation-dashboard`. This covers the dark "Nifty Pulse" look, the six tabs, the Nifty card, the chart and the sector strip.
- **Redesign stage 2**: built, reviewed and fixed on `feat/redesign-stage2`, with 311 tests passing.
  - Stored indicators: EMA 20, MACD, Bollinger, 20-day average volume, 52-week high/low, candlestick patterns.
  - **Technical Score** (0–100, five labels), computed nightly in order: Nifty, then sectors, then stocks.
  - **Stock pop-up**: four tabs, opened from the top-bar search, the Nifty card, watchlist names and sector names. It opens and closes instantly, and `?stock=KEY` links work.
  - Code for the Nifty 200 universe and the niftyindices import.
- **Supabase (Tracker1)**:
  - Migrations 0003 and 0004 are applied.
  - Index/sector back-fill from 2015 has run, so EMA 20 is filled (Nifty 22,892) and 14 instruments are scored.
  - JIOFIN has been back-filled from 2019.
- **Stage 3 (watchlist redesign + movers)**: merged into `feat/redesign-stage2` (fast-forward; the stage 3 branch is deleted). All 5 tasks are done, reviewed and fixed (339 tests):
  - the watchlist row model;
  - the redesigned Watchlist tab: EMA 20/50/200 coloured by price, trend chip, RSI, levels, score chip, 1-month sparkline, sorting by any column;
  - `/api/movers`: Nifty 200 top 5 gainers/losers + breadth, live during market hours;
  - the MARKET MOVERS panel on the Dashboard, between the chart and the sector strip;
  - README sections for both.
- **niftyindices import**: all 12 constituent lists downloaded and imported; `backfill --universe` re-run after the stage 4 fix: 230/230 stocks (Nifty 200 + 30 sector-only), no failures; all 127 sector members priced and scored for 16 Oct.
- **Stage 4 (Sector Analysis)**: merged into `feat/redesign-stage2` (fast-forward; the stage 4 branch is deleted). All 5 tasks done, reviewed and fixed (362 tests):
  - 11 sector tiles (day %, score, RSI) with a hover/focus preview of the top 3 gainers and losers;
  - selected-sector detail (`?s=KEY`): 1D/1W/1M/3M, trend, RS vs Nifty 4W, score, View chart, constituent table;
  - sector rotation ranking from weekly RS with week change and an 8-week rank sparkline;
  - fix: thin sectors' placeholder score of 50 is dimmed ("partial data");
  - fix (stage 2 bug): the backfill, EOD and score jobs now include sector constituents outside the Nifty 200 (30 stocks, e.g. most of Nifty Media), as the stage 2 plan intended.

## In progress
- Nothing. Stages 2–4 are all on `feat/redesign-stage2`; the work tree is clean apart from these notes.

## Pending
1. **Stage 3, wrap-up**:
   - **You:** look at the Dashboard and confirm the movers panel sits between the chart and the sector strip. I couldn't sign in to check: the saved browser login had expired. Until the Nifty 200 import it shows "Market movers appear after the Nifty 200 list is imported."
   - **You:** check the Watchlist tab and movers panel at full width and phone width, and confirm before stage 4 (Sector Analysis) is planned.
2. **You: niftyindices downloads.** Put files into `data/niftyindices/`:
   - **Stock lists** go in `constituents/`: `NIFTY200.csv`, `NIFTY_AUTO.csv`, `NIFTY_BANK.csv`, `NIFTY_FIN.csv`, `NIFTY_FMCG.csv`, `NIFTY_IT.csv`, `NIFTY_MEDIA.csv`, `NIFTY_METAL.csv`, `NIFTY_PHARMA.csv`, `NIFTY_PSU_BANK.csv`, `NIFTY_PVT_BANK.csv`, `NIFTY_HEALTHCARE.csv`.
   - **Sector history** goes in `history/`. Name each file with the sector key first, e.g. `NIFTY_AUTO_2015-2019.csv`. Only these 8 need it: AUTO, FIN, FMCG, MEDIA, METAL, PSU_BANK, PVT_BANK, HEALTHCARE.
   - Then run `npm run import-niftyindices -- --dry-run` and send me the report before the real import.
3. **After the import:**
   - Download the 8 thin-sector **history** files by hand (automated download is blocked); until then those sectors show "—" for 1W/1M/3M, RSI and RS and are unranked in rotation.
   - Run `npm run backfill -- --universe` (about 200 stocks, 15–30 min).
   - Then time one EOD run (now ~230 stocks). If it takes over 45 s, the two-part EOD split (stage 2 Task 8) must be built before relying on the Vercel cron.
4. **You: click-through checks** (I skipped these because they write to your live data):
   - Sectors tab (signed in): clicking a tile selects it without jumping to the top; a Dashboard sector-strip tile lands on the right sector.
   - On the Watchlist tab: add a stock, set and clear a manual level, remove a stock.
   - In a pop-up: "Add to Watchlist" should fill in the score and chart, and "Request new report" should create a pending report.
5. **Merge / publish.** Nothing is pushed:
   - `feat/foundation-dashboard` → `feat/redesign-stage2` (which now holds stages 3 and 4) are stacked, neither merged to `main`.
   - The repo has no GitHub remote, and the `gh` CLI isn't installed.
6. **Owner steps still open:**
   - Rotate the Supabase service-role key; it was pasted in chat.
   - Supabase Auth: turn off "Allow new users to sign up".
   - Deploy to Vercel.

## Known issues (minor, deferred)
- Stage 4 review minors:
  - Each sector-tile click reloads the whole page's data (~25 queries); selecting on the client would be faster.
  - The 8-week rank sparkline skips weeks with no rank instead of showing a gap.
  - `hasConstituents` in the sector loader is unused.
  - The hover preview isn't linked to its tile for screen readers; tabbing away hides it even while hovered.
  - A tile's score/RSI/RS can be from an older session than the header date, with no cue.
- Stage 3 review minors:
  - During market hours the Dashboard's first render waits on the ~200-stock Yahoo batch (up to ~3 s more if Yahoo is slow).
  - In the movers lists, a stock Yahoo omits keeps yesterday's %; a quote with no % counts as "unchanged" in breadth.
  - A watchlist stock with no prices at all doesn't show in the table, so it can't be removed there.
  - During market hours the sparkline's last point is replaced by the live price rather than a new point added.
  - Watchlist day % can come from a newer imported-only row than the price.
- `npm run build` sometimes fails while fetching Google Fonts (next/font). Re-run it. If it keeps happening, host the fonts in the repo.
- The 8 thin sectors have only 1–2 days of Yahoo data until their history is imported, so they score a partial 50 ("limited data").
- Pop-up: pattern effects are shown for 10 sessions, but the score counts only the last 3. The payload is heavy (full history). 52-week values come from short history on thin sectors.
- The EOD job still retries a symbol Yahoo doesn't know until the next `backfill --universe` marks it inactive.
