# Progress notes — Nifty dashboard

_Updated 2026-11-04 - the Research assistant and Backtest reports are removed; speed fixes and the 25-row stake lists are pushed to `main`. Resume with: "continue from NOTES.md"_

## Status at a glance (2026-11-04)
**Done**
- `main` and `origin/main` are at `1d14c27`, pushed 4 Nov. Vercel deploys from `main`; I did not watch that deploy finish, so check the live site.
- Speed (4 Nov): the page was slow because every click made 6-7 sequential database round trips of about 300 ms each, from a Vercel function region far from the Supabase database (`ca-central-1`). `vercel.json` now pins `"regions": ["iad1"]`. The layout strip and Dashboard history are memoised for 60 s per lambda (`cached()` in `src/lib/api/server.ts`), and the middleware uses `getClaims()` instead of `getUser()`.
- New High delivery box on the Market tab (NSE delivery %, all stocks; top 30 by value, 60%+, 5 of 10 / 8 of 20 sessions). Migration **0014** applied; 24 sessions back-filled (30 Sep - 4 Nov). New cron `/api/cron/delivery` at 14:30 UTC (Hobby's 2nd and last cron slot). Details in README, Market section.
- Stake-increase lists on the Market tab show the top 25 (was 10), all visible.
- New AI Deep Dive tab (`/deepdive`): one tile per report (newest first) with status, date and a summary line. Clicking a tile opens the stock pop-up on its AI Deep Dive tab (`?stock=KEY&tab=deep`); Delete removes that one report with no confirm (`DELETE /api/reports/<id>`). The pop-up's own Deep Dive tab stays.
- Removed 4 Nov: the Research assistant (tab, API, `src/lib/assistant/`, `npm run tracker`, `assistant-check`, `assistant/CLAUDE.md`) and Backtest reports (tab, `src/lib/calc/backtest/`, `npm run backtest`), plus `react-markdown` and `remark-gfm`. Migration **0013** dropped `assistant_sessions` and `backtest_runs` on Tracker1 (1 row each). Migrations 0010 and 0011 stay in the folder as history.
- Cleaned 4 Nov: the two TEST bell events (`alert_events` ids 3 and 4) and 7 merged local branches. 612 tests, typecheck and lint clean.

**Open**
- Telegram: the last fired alert (3 Nov) was still logged `telegram_status = not_configured`, so I could not confirm Telegram works end to end. Check the next fired alert.
- Time one EOD run on the deployed site. If it takes over about 4 minutes it will hit Vercel's 300 s limit and the EOD job must be split in two (Task 8 of `docs/superpowers/plans/2026-10-18-redesign-stage2-score-universe-popup.md`).
- The 8 thin-sector history files (`NIFTY_AUTO`, `NIFTY_FIN`, `NIFTY_FMCG`, `NIFTY_MEDIA`, `NIFTY_METAL`, `NIFTY_PSU_BANK`, `NIFTY_PVT_BANK`, `NIFTY_HEALTHCARE`) must be downloaded by hand from niftyindices.com into `data/niftyindices/history/`, then run `npm run import-niftyindices -- --dry-run` and `npm run import-niftyindices`. The site refuses scripted downloads.
- Fixed 4 Nov: three unadjusted corporate actions in the stored prices (Yahoo serves them unadjusted too). Older open/high/low/close were multiplied by (close on the event day / last close before it), which assumes a 0% move that day: `MOTILALOFS` before 2024-01-01 (x0.254), `PATANJALI` before 2020-01-27 (x0.051), `VEDL` before 2026-04-30 (x0.351). Volume was not changed. Indicators and scores were recomputed for the three. The original rows are in table `daily_prices_splitfix_backup` (3,305 rows); drop it once you are happy. A full `npm run backfill` would overwrite the fix with Yahoo's raw prices, so re-run the rescale if you ever do one.
- Local branch `feat/redesign-stage7-alerts` is still there: it has no commits that `main` lacks, but git will not `-d` it because its remote copy differs. `origin/feat/redesign-stage7-alerts` also still exists.
- Older items: To do 1 and 3-8 below. The session notes below describe the assistant and backtests as they were before removal.

## Session 2026-10-19 evening
- **TODAY BY CLAUDE was empty** because the daily-summary task had never been scheduled (`daily_summaries` had no rows). I wrote the 19 Oct row by hand following `docs/claude-tasks/daily-summary.md` (Nifty −1.11%, PSU Bank the only green sector, 3 market events, no news for your stocks).
- **Cloud routines created** (claude.ai account has no GitHub access to the repo, so the task text is pasted into each routine; edits to `docs/claude-tasks/*.md` must be copied in by hand):
  - "Nifty daily market summary" `trig_01JfG2B9mnmZXgGCyWZJJXiQ` — Mon–Fri 18:07 IST, first run 20 Oct.
  - "Nifty stock report queue" `trig_013f5iVd6GeT8AGvy8RNr2Ly` — hourly 09:07–22:07 IST, every day.
  - Both: Sonnet 5.5, Supabase connector, tools WebSearch + WebFetch, environment "Default" `env_019JdYCs8cWx9CseN6U4yzN3`. Manage at https://claude.ai/code/routines.
- **Two problems found and fixed:**
  1. Cloud runs couldn't open web pages ("host not found") → you set the environment's network access to Full. Confirmed working.
  2. The Supabase connector stops for an approval prompt before any `UPDATE`, so unattended runs hung → **migration `0007_report_functions.sql`** adds `complete_report(id, content)` / `fail_report(id, error)` (only touch a `pending` row, return its id or null; `execute` revoked from anon/authenticated). Routine now writes via `select complete_report(...)`. `docs/claude-tasks/stock-report.md` and README updated to match.
- **Reports:** #7 INDHOTEL failed (network); #8 INDHOTEL written by me by hand; #9 ACE written by the cloud routine end to end with no prompt (its valuation/balance-sheet parts say "couldn't be verified"). One old run (`session_014388Ww8ajxvh7xXDjYSzDW`) is stuck on the old approval prompt — ignore it; it can't overwrite #9.
- **Stage 6 samples deleted** from Tracker1 (16 Oct sample summary, report 6).
- **Alerts tab:** the "New alert" panel only shows the search box until a stock is picked, and portfolio rules show "Edit in Portfolio" instead of Delete — you couldn't find the buttons. Added a hint line under the search box (`AlertForm.tsx`).
- **Bell:** shows a count only when there are unread events; there were none (live alerts only run in market hours, and an already-true rule waits for the next crossing). Inserted two **TEST** events (`alert_events` ids 3, 4, `alert_id` null) so you can see the badge — delete them after testing: `delete from alert_events where id in (3,4);`
- **Noticed:** all three holding rules still have `last_state` null — the alert pass has never evaluated them. Expected while the deployed EOD job runs `main` (no stage 7 code); check again after the merge/deploy.
- **Uncommitted:** `supabase/migrations/0007_report_functions.sql`, `src/app/components/alerts/AlertForm.tsx` (hint), `docs/claude-tasks/stock-report.md`, `README.md`, `NOTES.md`. A commit attempt was blocked by the permission check — ask me to commit.
- The local 17:47 reminder (session-only cron) never fired.

## Session 2026-10-26 — Stage 6b (FII/DII stake screeners) built
- Branch `feat/stage6b-shareholding`, stacked on stage 7 (4b19c1d, 8352cd2, 19c0004, 82b4a2a). Plan `docs/superpowers/plans/2026-10-20-stage6b-fii-dii-shareholding.md`. 563 tests; typecheck, lint, build clean.
- Migrations **0008** (`shareholding` table) and **0009** (`record_shareholding` function, so unattended runs avoid the update-approval prompt) applied to Tracker1; 0009 tested in a rolled-back block. Plan said 0007 for the table; renumbered because 0007 was taken.
- Added `upsertShareholding` to the repo (tests and sample data; the plan said read-only).
- Live loader check on Tracker1 with sample rows (removed). Cards rendered statically (dark only; the app has no light theme).
- **Task 4 done (2026-10-26):** two cloud routines (task text pasted in; edits to `docs/claude-tasks/shareholding.md` must be copied in by hand), same Supabase connector and "Default" environment, Sonnet 5.5: "Nifty shareholding update" `trig_017GAh5Z1tfkeuEyNCGZF5C9` (22–28 of Jan/Apr/Jul/Oct) and "(late filers)" `trig_01AZ2VZEjPwwZv4rZ5XQDRhn` (5–10 of Feb/May/Aug/Nov). Both run hourly 19:00–22:00 IST on those days (UTC cron `30 13-16`); each run does up to 50 stocks and stops quietly when none are missing, so the hourly runs cover all 200. First run 26 Oct about 21:07 IST (Jul–Sep 2026). Check afterwards: `select count(distinct instrument_id) from shareholding where quarter_end = '2026-09-30';`
- Stage 7 still unmerged; 6b sits on top of it, so merge stage 7 first.
- Also committed 0007 + the 6b plan (3418666).

## Session 2026-10-27 — Alpha ranks (Vibe-Trading sub-project 1 of 3)
- Spec `docs/superpowers/specs/2026-10-27-factor-alpha-screeners-design.md`, plan `docs/superpowers/plans/2026-10-27-factor-alpha-screeners.md`; branch `feat/alpha-screeners`, stacked on `feat/stage6b-shareholding` (stage 6b is not on `main`).
- Built: `src/lib/calc/alpha/` (operators, six alphas, runner), `Repo.getOhlcvRange`, `AlphaGrid` under the Screeners panel. No schema change.
- Load time, real Supabase, median of 5: 5.4 s before, 5.9 s after. A first version that reused `getDaysRange` for 30 sessions took 13.5 s (about 8 s slower), so the alphas read only OHLCV columns in parallel chunks instead.
- Seen: a static render (live data, headless Edge) at 1280 and 390 px, dark only (the app has no light theme). Not seen: the signed-in `/market` page itself.
- Next sub-projects: 2) backtesting (reuse `calc/alpha`; Vibe-Trading's `india_equity.py` engine is the reference for NSE costs), 3) research agent as a scheduled Claude task.

## Session 2026-10-27 — Backtesting (Vibe-Trading sub-project 2 of 3)
- Spec `docs/superpowers/specs/2026-10-27-backtesting-design.md`, plan `docs/superpowers/plans/2026-10-27-backtesting.md`; branch `feat/backtesting`, stacked on `feat/stage6b-shareholding` (stage 6b is not on `main`).
- Built: `src/lib/calc/backtest/` (costs, engine, metrics, strategies, caveats), `src/lib/jobs/backtest.ts` (history loading, run builder), `scripts/backtest.ts` (`npm run backtest`), migration `0010_backtest_runs.sql`, three `Repo` methods, the Backtests tab.
- Migration **0010 is applied** to Tracker1 (it was applied on 27 Oct when the sample run was saved; the note here and in the README saying otherwise was wrong, corrected 30 Oct).
- Checks on the real data (dry runs, after the review fixes): control `hold NIFTY50` +84.9% vs benchmark +86.7%; `random` seeds 1/2/3 CAGR +5.0/-1.5/+0.6% vs benchmark +9.6%; alpha a101 top 10 +4.1% (3,180 trades, turnover 92x a year); a054 top 10 stop 8% -10.3% and golden cross hold 10 stop 8% +6.1% (both measured before the re-buy fix). About 90 round trips a year at ~0.4% each is a large drag: a 5-session hold is dominated by costs.
- Data: 13 daily moves of 35% or more; PATANJALI 2020-01-27, MOTILALOFS 2024-01-01 and VEDL 2026-04-30 look like unadjusted splits or demergers (Yes Bank 2020 is real). Worth fixing or excluding before trusting stock-level results. The stored score is on 0% of rows, so score rules are excluded.
- Review fixes: a stock still wanted when its hold ends is kept and its hold restarts (it used to be sold and bought back at the same open, ~0.5% of cost for nothing); a trade that spans a daily move of 35% or more is marked `suspect` ("check data" chip) and the run's note says how many; a run with more than 10,000 trades is refused for saving (use `--dry-run` or a longer `--hold`); the detail page tolerates a missing table and an oversized id.
- A first wide read (10 ids per request) died with "TypeError: terminated"; wide rows now load 4 ids at a time with up to 3 attempts.
- Seen: a real-browser render (live a054 run, headless Edge) at 1280 and 358 px, dark only. Not seen: the signed-in tab itself.
- Next: sub-project 3, the research agent as a scheduled Claude task.

## Session 2026-10-28 to 30 - Research assistant (Vibe-Trading sub-project 3 of 3)
- Spec `docs/superpowers/specs/2026-10-27-research-assistant-design.md`, plan `docs/superpowers/plans/2026-10-28-research-assistant.md`; branch `feat/research-assistant`, stacked on the backtesting work.
- Built: `/api/assistant` spawns your local `claude.exe` with a locked-down argument set and relays its `stream-json` output as server-sent events; `src/lib/assistant/` (args, stream parser, runner, six read-only tools); `npm run tracker -- find|stock|screeners|alphas|market|portfolio`; `assistant_sessions` storage (migration **0011, applied**); the Research assistant tab (chat, steps, markdown answers, report cards, chat list); Backtests renamed "Backtest reports"; `npm run assistant-check` against the real CLI.
- Security split: research mode gets Bash (allow-listed `npm run tracker`/`backtest` only) plus WebSearch and WebFetch; holdings mode gets Bash only and never the web, decided from the `holdings` boolean alone. The CLI is spawned with no shell and a minimal environment, so the Supabase keys never reach it. The route answers 501 on Vercel - the assistant only runs on your PC.
- Checked by me: 747 tests, typecheck, lint, `npm run build`; `/assistant` redirects to the login page and `POST /api/assistant` answers 401 when signed out.
- Seen: static render (esbuild bundle + Tailwind + headless Edge) at 1280 and a true 390 px viewport, dark - empty state, a finished answer with steps, table, report card and cost line, and a stopped run. Edge will not open a window under ~500 px, so the phone width is rendered inside a 390 px iframe. Two fixes came out of it (`2ee4453`): the open chat was highlighted in a colour identical to the page background, and the error banner stretched the full width. **Not seen: the signed-in page, and no real end-to-end run through the browser.**

## Branches
- `feat/research-assistant` (**checked out**) — stage 6b + alpha ranks + backtesting + research assistant, stacked in one line on top of stage 7. 46 commits ahead of `main`, none of them pushed.
- `feat/redesign-stage7-alerts`, `feat/stage6b-shareholding` — older labels left behind on the same stacked line; the stage 7 work itself is on `main`.
- `main` — stages 1–7 complete, at `150a082`, **pushed** to `origin` (github.com/jeetkamal991/portfolio-tracker) and equal to `origin/main`.
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
   - ~~Then: merge `feat/redesign-stage7-alerts` into `main` and push~~ - that code is on `main` already; the branch label is just an older marker on the same line.
2. ~~Supabase stage 6 sample cleanup~~ — done 2026-10-19 (the 16 Oct sample summary and report 6 deleted from Tracker1).
3. **Stage 6 Task 6 — Claude tasks scheduled 2026-10-19** (details under "Session 2026-10-19 evening"). Still open: the README Market section.
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
