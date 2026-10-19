# Progress notes — Nifty dashboard

_Updated 2026-10-19 — stage 7 (Alerts + Telegram) built, Tasks 1–7 done; waiting on your Telegram/Vercel steps and checks, then merge_

## Branches
- `feat/redesign-stage7-alerts` (**checked out**) — stage 7, complete. On `origin` only up to `8cf377c`; the 6 new commits are local, not pushed.
- `main` — stages 1–6 plus the start of stage 7 (`9294ee6`, `009d808` with partial Task 2, `8cf377c` .gitignore), **pushed** to `origin` (github.com/jeetkamal991/portfolio-tracker).
- Merged and can be deleted: `feat/redesign-stage6-market`, `feat/redesign-stage5-finish`. Older local branches: `feat/foundation-dashboard` → `feat/redesign-stage2` → `feat/daily-sector-log`.

## Done
- **Foundation + redesign stage 1**: dark "Nifty Pulse" look, six tabs, Nifty card, chart, sector strip.
- **Stage 2**: stored indicators (EMA 20, MACD, Bollinger, 20-day avg volume, 52-week high/low, candle patterns), the Technical Score (0–100, five labels, computed nightly), the stock pop-up (four tabs, `?stock=KEY` links), the Nifty 200 universe and the niftyindices import.
- **Stage 3**: redesigned Watchlist tab and the MARKET MOVERS panel on the Dashboard (Nifty 200 top 5 gainers/losers + breadth).
- **Stage 4**: Sector Analysis tab (tiles, selected-sector detail, rotation ranking) and the **Daily Sector Log** (your spreadsheet on the Sectors tab, checked against `data/history.xlsx`).
- **Data (Supabase Tracker1)**: migrations 0001–0006 applied; all 12 niftyindices constituent lists imported; 230 stocks priced and scored for 16 Oct.
- **Stage 5 (Portfolio) — complete** (on `main`):
  - Tasks 1–3: portfolio maths, `holdings` storage, holdings API, prefill, view model. Checked live against Tracker1.
  - Task 4 `863b0e0` + fixes `adc0772`: the Portfolio tab (summary cards, risk alerts, sortable table, add/edit form). Fixes: Esc and Tab keep working after picking a stock, focus moves to Quantity / back to search, Buy price shows 2 decimals, LIVE chip needs a priced holding, the stock search list no longer gets clipped inside the form. You checked the form in your browser — good.
  - Task 5 `6dd489b`: YOUR PORTFOLIO snapshot on the Dashboard (same totals as the Portfolio tab, top 4 holdings by value, "Add your first holding" when empty); "Add to Portfolio" / "In portfolio · 10 @ ₹100" button in the stock pop-up (opens `/portfolio?add=KEY` / `?edit=KEY`). Task 6 `a070a48`: README Portfolio section and migration 0005. Final review (self-review): no blocking findings.
  - Also in `adc0772`: Daily Sector Log numbers are now light text on the green/red cells (strongest shades toned down so text stays readable).
- **Stage 6 (Market), Tasks 1–5 done and reviewed** (plan `docs/superpowers/plans/2026-10-18-redesign-stage6-market.md`, run in order 1, 3, 2, 4, 5):
  - Task 1 `addfd82`: the ten Nifty 200 screeners. Task 3 `1927a40`: safe readers for Claude's summary and reports. Task 2 `b2701a5`: Market loader and breadth.
  - Task 4 `5747644`: the Market tab (TODAY BY CLAUDE, screener grid, breadth panel) and the structured AI Deep Dive.
  - Task 5 `b207cf0`, `d3a945c`: `docs/claude-tasks/` (daily summary, report queue, stock report); every SQL statement tested on Tracker1 inside rolled-back transactions.
  - Final review fixes `26ee9b8`, `b5d96e9`: fundamentals always in spec order (jsonb reorders keys), raw view for off-shape reports, robust screener window; docs: quote-tag collision and one-statement rules, number placeholders, holdings usage, `returning date`.
  - 472 tests pass; typecheck, lint, build clean. Final whole-branch review clean.

- **Stage 6 Market-tab addendum — done**: `684f32d` + `cfc16a5`, merged in `2bc780f`. Your-stocks signals, today/upcoming "For your stocks" brief, redesigned TODAY BY CLAUDE card. You checked the look (good).

## Stage 7: Alerts and Telegram — built, not merged
Plan: `docs/superpowers/plans/2026-10-18-redesign-stage7-alerts-telegram.md`. Ledger with every decision: `.superpowers/sdd/2026-10-18-redesign-stage7-alerts-telegram/progress.md`.
- Task 1 `9294ee6`: evaluator, state machine, 15-min throttle, messages.
- Task 2 `009d808` + `9cf748e`: `alerts` / `alert_events` storage, holding rules follow add/edit/delete. **Migration 0006 applied to Tracker1.**
- Task 3 `96017c6`: Telegram sender, `npm run telegram-setup`.
- Task 4 `09e6539`: alert engine — EOD pass after scores (syncs holding rules first), intraday pass inside `/api/quotes` once a minute during market hours (also fetches quotes for rule stocks you don't watch/hold); EOD `maxDuration` 300.
- Task 5 `6c158e2`: `/api/alerts` (+ `[id]`, `feed`, `read`, `snapshot/[key]`).
- Task 6 `d429536`: Alerts tab (form, rules, feed), top-bar bell, "Set alert" in the pop-up (stocks and indices).
- Task 7 `6697ff4`: README Alerts section, env table, migration 0006.
- 551 tests; typecheck, lint, build clean. Supabase repo checked live on Tracker1 (create → fire → read → delete; test rows removed). Your holdings now have their rules: ACE SL + T1, RELIANCE T1.
- Visual: static render of the form, rules list and feed at desktop and 390 px — OK. The bell and the signed-in page are not seen yet.

## To do
1. **You — stage 7:**
   - Telegram: @BotFather `/newbot` → token into `.env.local` as `TELEGRAM_BOT_TOKEN` → message your bot → `npm run telegram-setup` → put the printed id in `TELEGRAM_CHAT_ID` → run it again (test message arrives). Then add both to Vercel and redeploy.
   - Signed in (`npm run dev`): create "Price goes above" just below a stock's price (should say "already true"); pause/resume/delete it; check "From your portfolio" rules follow an SL edit; bell count and dropdown; mark read / mark all read; 390 px.
   - Then: merge `feat/redesign-stage7-alerts` into `main` and push (ask me).
2. **You — Supabase** (the connector failed with "Invalid or expired requestState"; reconnect it and ask me, or run these in the Tracker1 SQL editor):
   - Delete the stage 6 samples: `delete from daily_summaries where date='2026-10-16' and summary like 'SAMPLE%'; delete from reports where id=6;`
3. **You — stage 6 Task 6**, in the Claude chat: "stage 6 is built, set up the Claude tasks" (6 PM summary + hourly report queue, and the report skill), then the README Market section.
4. **You — stage 5 check:** add a few real holdings and compare P/L for one stock with your broker app. Also look at the Dashboard snapshot and the pop-up's "Add to Portfolio" button signed in (I only checked them as a static render).
5. **You — signed-in checks:**
   - Sectors: the Daily Sector Log is readable; clicking a tile / month tab doesn't jump to the top; a Dashboard sector tile opens the right sector.
   - Watchlist: add a stock, set and clear a manual level, remove a stock. Pop-up: "Add to Watchlist" and "Request new report".
6. **You — data:**
   - Download the 8 thin-sector **history** files from niftyindices.com by hand into `data/niftyindices/history/`, named with the key first (e.g. `NIFTY_AUTO_2015-2019.csv`): AUTO, FIN, FMCG, MEDIA, METAL, PSU_BANK, PVT_BANK, HEALTHCARE. Then `npm run import-niftyindices -- --dry-run`, and the real import.
   - Time one EOD run (~230 stocks plus holdings). The cron limit is now 300 s; if it takes over ~4 min, the two-part EOD split must be built before relying on the Vercel cron.
7. **Git:** delete the merged branches when you like; decide what to do with the older stacked branches and the "Initial commit" (`f7acd48`).
8. **Owner steps still open:**
   - Rotate the Supabase service-role key; it was pasted in chat.
   - Supabase Auth: turn off "Allow new users to sign up".
   - Deploy to Vercel.
   - Optional: connect the Claude in Chrome extension so I can do the signed-in browser checks myself.

## Known issues (minor, deferred)
- Stage 7: live (intraday) alerts only run while the dashboard is open somewhere (they ride on the quotes poll); EOD catches everything else. The holding near/hit level is saved even when a fire is throttled, so a throttled "near" won't re-fire until the level falls and rises again. The feed's "latest 5" in the bell is unread-first.
- Stage 5:
  - The Dashboard snapshot doesn't mention holdings without a price (the Portfolio tab shows "· N without price").
  - A held stock marked inactive by `backfill --universe` stops being priced nightly.
  - `dayPct <= -1` from a bad feed would make day P/L non-finite (treat as null).
  - A brand-new stock gets no SL/target warnings on add (no stored price yet).
  - The universe looks up each holding separately (fine at personal scale).
  - Some API/prefill details are only indirectly tested.
- Daily Sector Log: each month-tab or sector-tile click reloads the whole Sectors page data (~25 queries); picking a sector resets the month tab to the current month.
- Stage 4: the 8-week rank sparkline skips weeks with no rank; `hasConstituents` is unused; the hover preview isn't linked to its tile for screen readers; a tile's values can be from an older session than the header date.
- Stage 3: during market hours the Dashboard's first render waits on the ~200-stock Yahoo batch; in movers a stock Yahoo omits keeps yesterday's %; a watchlist stock with no prices can't be removed from the table; the live price replaces the sparkline's last point; watchlist day % can come from a newer imported-only row than the price.
- Stage 6 so far (for the final review): equal EMA 50/200 counts as a death cross; a few untested edge cases in screeners, the Claude-format readers and the market loader; a Nifty row without a close price would shorten the screener window (doesn't happen in today's data).
- `npm run build` sometimes fails fetching Google Fonts (next/font) — re-run it.
- The pop-up shows pattern effects for 10 sessions but the score counts only 3; its payload is heavy (full history).
- The EOD job retries a symbol Yahoo doesn't know until the next `backfill --universe` marks it inactive.
- The dev server is stopped; start it with `npm run dev` (http://localhost:3000).
