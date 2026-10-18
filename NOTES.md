# Progress notes — Nifty dashboard

_Updated 2026-10-18 — paused by the owner during stage 5 (Portfolio), Task 4 fix round_

## Branches
- `main` now carries stage 5 (it holds what was `feat/redesign-stage5`, plus an "Initial commit" adding NOTES.md and RUN_LOCALLY.txt). Remote: `origin` = github.com/jeetkamal991/portfolio-tracker; pushed up to `f7acd48`, Task 4 (`863b0e0`) and its fix round not pushed.
- Older branches still local: `feat/foundation-dashboard` → `feat/redesign-stage2` (stages 2–4) → `feat/daily-sector-log` (reviewed).

## Done
- **Foundation + redesign stage 1**: dark "Nifty Pulse" look, six tabs, Nifty card, chart, sector strip.
- **Stage 2**: stored indicators (EMA 20, MACD, Bollinger, 20-day avg volume, 52-week high/low, candle patterns), the Technical Score (0–100, five labels, computed nightly), the stock pop-up (four tabs, `?stock=KEY` links), the Nifty 200 universe and the niftyindices import.
- **Stage 3**: redesigned Watchlist tab (EMA 20/50/200, trend chip, RSI, levels, score, 1-month sparkline, sort by any column); `/api/movers` and the MARKET MOVERS panel on the Dashboard (Nifty 200 top 5 gainers/losers + breadth).
- **Stage 4**: Sector Analysis tab — 11 sector tiles with a top-3 hover preview, the selected sector's detail and constituent table (`?s=KEY`), the sector rotation ranking; thin sectors' placeholder score is dimmed; the jobs also price the 30 sector stocks outside the Nifty 200.
- **Daily Sector Log** (stage 4 addendum, branch `feat/daily-sector-log`): your spreadsheet reproduced on the Sectors tab — 6 month tabs, Total row, one row per trading day, NIFTY + 11 sectors in the sheet's order, green/red cells (`?m=2026-10`). Checked against `data/history.xlsx`: every Oct/Sep/Aug cell matches; the Oct NIFTY Total is +2.36% vs the sheet's +2.37% (the app sums full-precision values, the sheet its rounded entries). Task reviews and the final review are clean.
- **Data (Supabase Tracker1)**:
  - Migrations 0001–0005 applied (0005 = the empty `holdings` table, applied 2026-10-18; row-level security on, no policies — server only, like the other tables).
  - All 12 niftyindices constituent lists imported; `backfill --universe` covers 230 stocks (Nifty 200 + 30 sector-only), all priced and scored for 16 Oct.
- **Stage 5 (Portfolio) — Tasks 1–3 done and reviewed** on `feat/redesign-stage5`:
  - Task 1 `6b978d9`, `734daf1`: portfolio maths — P/L, day P/L (buy-date-today rule), totals, merge averaging, status (SL hit / near SL / target hit / near target), input validation and warnings. One review fix: impossible dates like 30 Feb are rejected.
  - Task 2 `dbd6322`: `holdings` storage; holdings join the data universe (priced and scored nightly); `addHolding` job (fetches history for a new stock, merges a repeat add); live quotes include holdings.
  - Task 3 `9d969f5`: `POST /api/holdings`, `PUT`/`DELETE /api/holdings/[key]`, `GET /api/holdings/prefill/[key]`, the portfolio view model, sorting, and ₹ formatters.
  - Checked live against Tracker1 (with a test RELIANCE holding, since deleted): prefill, add, merge (10 + 5 shares → exact weighted average ₹1,170.83), warnings, field errors and "Unknown stock" all behave correctly.

## In progress — stage 5, Task 4 (Portfolio tab UI)
- Built in `863b0e0`: summary cards, risk-alerts bar, sortable holdings table, add/edit form (modal) with stock search, prefill and "Use suggested levels"; the form opens from `?add=1`, `?add=KEY`, `?edit=KEY`. Tests 418/418, typecheck, lint and build pass.
- Browser check (headless, real data, test holding): summary, table, "STOP LOSS NEAR" alert chip, day P/L, no NaN; Esc closes the form and clears the URL; 390 px — table scrolls with the stock column pinned, no page scroll.
- **Fix round 1 (uncommitted, in the work tree):** Esc and the Tab trap now listen on the document, so they keep working after a stock is picked; focus moves to Quantity after a pick and to the search box after "Change"; the dialog has `tabIndex={-1}`. The edit form shows Buy price to 2 decimals, and an untouched price still saves the exact stored average. The LIVE chip needs at least one priced holding. Tests 418/418, typecheck, lint and build pass.
- **Not yet checked in a browser:** the headless check needs a signed-in session (opening the page and APIs without auth for the check was refused).
- **Next step when resuming:** browser-check fix round 1, commit it, a scoped re-review, then Task 5 and Task 6. The plan's ledger, with every decision so far, is in `.superpowers/sdd/2026-10-18-redesign-stage5-portfolio/progress.md`. Resume with: "Execute docs/superpowers/plans/2026-10-18-redesign-stage5-portfolio.md using subagent-driven development".

## To do
1. **Stage 5, remaining:**
   - Task 4 fix round (above), then re-review.
   - Task 5: "YOUR PORTFOLIO" snapshot on the Dashboard; "Add to Portfolio" / "In portfolio · 10 @ ₹100" button in the stock pop-up (opens `/portfolio?add=KEY` or `?edit=KEY`).
   - Task 6: README (Portfolio features, P/L and status rules, migration 0005).
   - Final whole-branch review, then merge options.
2. **You — signed-in checks** (I can't sign in; the saved browser login expired):
   - Portfolio: search "reli" → prefill strip shows CMP, sector, score and levels; "Use suggested levels" fills SL/T1/T2; save; add the same stock again → merge message and new average; edit SL near/above CMP → status and alert chip; remove with the two-step confirm; the form fits a phone screen.
   - Sectors: clicking a tile selects it without jumping to the top; month tabs on the Daily Sector Log switch without a jump; a Dashboard sector-strip tile opens the right sector.
   - Dashboard: the movers panel sits between the chart and the sector strip.
   - Watchlist: add a stock, set and clear a manual level, remove a stock. Pop-up: "Add to Watchlist" and "Request new report".
3. **You — data:**
   - Download the 8 thin-sector **history** files from niftyindices.com by hand (the automated download is blocked) into `data/niftyindices/history/`, named with the key first (e.g. `NIFTY_AUTO_2015-2019.csv`): AUTO, FIN, FMCG, MEDIA, METAL, PSU_BANK, PVT_BANK, HEALTHCARE. Then `npm run import-niftyindices -- --dry-run`, and the real import. Until then those sectors show "—" for 1W/1M/3M, RSI and RS, a dimmed score of 50, no rotation rank, and "—" in the Daily Sector Log before October.
   - Time one EOD run (now ~230 stocks plus holdings). If it takes over 45 s, the two-part EOD split must be built before relying on the Vercel cron.
4. **Merge decision:** `feat/daily-sector-log` and `feat/redesign-stage5` are stacked on `feat/redesign-stage2`; decide once stage 5 is finished.
5. **Owner steps still open:**
   - Rotate the Supabase service-role key; it was pasted in chat.
   - Supabase Auth: turn off "Allow new users to sign up".
   - Deploy to Vercel.
6. **Git housekeeping:** a commit named "Initial commit" (`f7acd48`, 13:59) on `feat/redesign-stage5` added `NOTES.md` and `RUN_LOCALLY.txt`. It wasn't one of the plan's commits — keep it, or move those files out before merging, as you prefer.

## Known issues (minor, deferred)
- Stage 5 so far:
  - `dayPct <= -1` from a bad feed would make day P/L non-finite (treat as null).
  - A brand-new stock gets no SL/target warnings on add (no stored price yet).
  - The universe looks up each holding separately (fine at personal scale).
  - Some API/prefill details are only indirectly tested.
- Daily Sector Log: each month-tab or sector-tile click reloads the whole Sectors page data (~25 queries); picking a sector resets the month tab to the current month.
- Stage 4: the 8-week rank sparkline skips weeks with no rank; `hasConstituents` is unused; the hover preview isn't linked to its tile for screen readers; a tile's values can be from an older session than the header date.
- Stage 3: during market hours the Dashboard's first render waits on the ~200-stock Yahoo batch; in movers a stock Yahoo omits keeps yesterday's %; a watchlist stock with no prices can't be removed from the table; the live price replaces the sparkline's last point; watchlist day % can come from a newer imported-only row than the price.
- `npm run build` sometimes fails fetching Google Fonts (next/font) — re-run it.
- The pop-up shows pattern effects for 10 sessions but the score counts only 3; its payload is heavy (full history).
- The EOD job retries a symbol Yahoo doesn't know until the next `backfill --universe` marks it inactive.
- The dev server is stopped; start it with `npm run dev` (http://localhost:3000).
