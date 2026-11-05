# Pre-deployment checklist

Nothing below has been deployed. Work top to bottom and stop at the first failure. The owner reviews before step 6.

## 0. What is already different in production (Supabase project Tracker1, `shatrllqjurfjwykfhvk`)

The database is ahead of the deployed app. All of this was approved on 2026-11-05 and is additive or audited:

| Change | Detail | How to undo |
|---|---|---|
| Tables `price_corrections`, `stock_score_snapshots`, `score_runs` | Migrations 0017, 0018, 0019, empty-safe, RLS on | Leave them; unused by the old app. Drop only if abandoning the feature |
| TRENT history corrected | 1,730 bars before 2026-01-01: open/high/low/close divided by 1.5; volume untouched; batch `fix-TRENT-2026-01-01-2026-11-05151538` (6,920 audit rows) | `npx tsx scripts/correct-price-history.ts --revert fix-TRENT-2026-01-01-2026-11-05151538 --apply` |
| TRENT legacy score on the latest day | 55 to 61 (recomputed from corrected prices) | Follows the revert above |
| 237 `enhanced_v2` snapshots for 2026-11-05 | Written, then re-written once with filter metrics and the TMPV reset (same keys, no duplicates) | Delete the rows for that date and version, or ignore them |
| Five sector indices backfilled | Auto, Financial Services, FMCG, Metal, PSU Bank: 17 to 698 sessions | Not reversible and not needed; data is the provider's own |

Not applied and must stay unapplied until step 7: `supabase/migrations/0016_drop_holdings_target2.sql`.

## 1. Code and tests (local)

- [ ] `git status` reviewed; nothing unintended (`.env.local` and `data/` are gitignored). Large uncommitted set: commit in logical pieces (price integrity, scoring v2, snapshots, UI, docs) so each can be reverted alone.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx eslint src scripts tests` clean.
- [ ] `npx vitest run` all green (last run before this checklist: 79 files, 748 tests).
- [ ] `npx next build` succeeds. A passing build does not catch the Vercel `maxDuration` rule: confirm every route has `maxDuration` of 300 or less (snapshots 300, delivery 60, eod 300).
- [ ] Manual browser pass on `npm run dev` with a real login:
  - Portfolio: holdings table has no horizontal scroll at laptop width, Edit/Remove visible, no T2 or Day P/L columns, add/edit a holding with stop loss and Target 1 only, position-size panel (valid input; stop above entry shows an error and no size).
  - Stock popup on a stock with a snapshot: **Evaluation** tab loads, categories expand, missing items are grey with a reason, TMPV shows the data-quality warning, a breakout stock shows "No valid target".
  - Rankings: each of the five views loads, filters apply, "not ranked" list shows reasons.
  - Dashboard, Watchlist, Sectors, Market, Alerts, AI Deep Dive load unchanged.
- [ ] Layout checked at phone width (the evaluation tab and rankings table scroll, nothing overflows the viewport).

## 2. Database backup (before any further production change)

- [ ] Confirm the Supabase plan's backup type: daily backups (retention?) or point-in-time recovery. Record it here: ______
- [ ] Take a fresh backup now. If the plan has none, take a logical dump: `pg_dump` of the `public` schema from the Supabase connection string (Settings, Database), stored outside the repo.
- [ ] Prove it restores: restore into a scratch Supabase project (or local Postgres) and compare row counts for `instruments`, `daily_prices`, `holdings`, `alert_rules`, `reports`, `stock_score_snapshots`. **A backup that has not been restored is not a backup.**
- [ ] Note the backup timestamp and keep it until step 8 passes.

## 3. Migrations

- [ ] `list_migrations` shows 0017, 0018, 0019 applied and 0016 absent (checked on 2026-11-05).
- [ ] The repository file names match what is applied (the project records them under timestamped names).
- [ ] Re-read `0016`: `alter table holdings drop column if exists target2;` Irreversible for the data in that column. Applied only at step 7.

## 4. Scheduled jobs and secrets

- [ ] Vercel env: `CRON_SECRET` set for Production (a long random value; `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Vercel sends it as `Authorization: Bearer ...` to cron routes. The snapshot chain reuses it, so it must exist or snapshots will not chain.
- [ ] Other env present and unchanged: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only, never `NEXT_PUBLIC_`), optional Telegram pair.
- [ ] `vercel.json` unchanged: two crons (`/api/cron/eod` 11:00 UTC weekdays, `/api/cron/delivery` 14:30 UTC weekdays). Hobby allows only a couple of cron jobs, so there is deliberately no third; snapshots start from the delivery cron. If Vercel's plan changes, a dedicated cron is cleaner.
- [ ] Understand the chain: delivery cron calls `/api/cron/snapshots?chain=1`, each call processes up to 80 stocks (about 30 s) and calls the next, at most 12 links, and `score_runs.max_batches = 12` is a second hard stop. A run that stops resumes from its cursor on the next call.
- [ ] The existing EOD and delivery jobs behave exactly as before (the only change to delivery is the best-effort kick after it finishes).
- [ ] Alert Telegram: unaffected.

## 5. External routines that read the database

- [ ] The live **stock-report Claude task** (scheduler configuration, not this repo): open it and confirm its SQL is `select h.quantity, h.avg_price, h.stop_loss, h.target1 from holdings h ...` with **no `h.target2`**. The repo doc `docs/claude-tasks/stock-report.md` is already updated; the live copy is what matters.
- [ ] List every scheduled task or routine that touches the database and confirm each uses updated SQL: ______
- [ ] Any ad-hoc SQL, dashboards or exports referencing `target2` (search Supabase SQL snippets and saved queries): none.

## 6. Deploy

Only after sections 1 to 5 pass and the owner approves.

- [ ] Push to `main` (this auto-deploys to production). The real domain is the one recorded in the project notes, not the `vercel project ls` URL.
- [ ] `npx vercel ls portfolio-tracker` shows the new deployment as Ready; if Error, read `errorCode` from the v13 deployments API (an invalid `maxDuration` shows only there).
- [ ] Smoke test production: login, portfolio, a stock popup, rankings.
- [ ] Verify the **deployed** app no longer reads Target 2. The deployed code cannot be searched, so check behaviour: add and edit a holding in production, and confirm in Supabase that the new row's `target2` is null and no request selects it (Supabase logs: query logs for `target2` over the last hour should show nothing from the app).

## 7. Apply migration 0016 (only after 6 passes and the backup is fresh)

- [ ] Re-confirm the backup timestamp is after the last production write you care about.
- [ ] Apply `0016_drop_holdings_target2.sql`.
- [ ] Immediately test: portfolio page, add holding, edit holding, remove holding, holdings API, the position-size panel, reports/deep dive, the next scheduled `eod` and `delivery` runs, and the stock-report routine once by hand.

## 8. First snapshot run in production

- [ ] After the first weekday delivery cron (about 20:00 IST), or by calling the route by hand with the secret (`curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/snapshots`):
  - `score_runs` has one row for the date and version with `status = completed`, `processed = total`, `failed = []`.
  - `stock_score_snapshots` has one row per eligible stock for that date; no duplicates (the unique key forbids them).
  - `npx tsx scripts/snapshot-report.ts` matches expectations (coverage, no LOW CONFIDENCE surprises).
- [ ] If it did not finish: `npx tsx scripts/run-snapshots.ts` resumes it from the stored cursor.
- [ ] Do not read performance into the snapshots: `scripts` and `src/lib/calc/backtest` are architecture only. Re-assess after months of history.

## 8b. Performance (verify on the deployed app, not on a laptop)

The audit and the before/after numbers were measured from a development machine about 300 ms from Supabase, so they show request
counts, bytes and waterfalls reliably but not Vercel's real timings. Confirm on production:

- [ ] Open the browser DevTools Network tab, filter Fetch/XHR, and open a stock popup. `/api/instrument/KEY` and `/api/evaluation/KEY`
      carry a `Server-Timing` header (`instrument;dur=...`, `evaluation;dur=...`): that is the handler time, separate from network.
      Expect roughly 100-300 ms for the popup handler (about 8-12 small reads in two steps on a server next to the database).
      If it is much higher, set `PERF_LOG=1` in Vercel, redeploy, and read the `[perf]` lines in the function logs.
- [ ] Hover a stock link, wait a moment, click it: the popup should open with content immediately (prefetched). The Evaluation tab
      should open with no spinner after the popup has loaded.
- [ ] Click each top tab: a pulsing dot appears on the tab and a skeleton shows at once; the page replaces it when ready.
- [ ] Chart: the popup and dashboard open on a 6-month view from one year of data. Choose **1Y** (instant) and then **ALL**:
      "Loading full history..." appears and the longer chart replaces the year within a second or two. The second time is instant.
- [ ] Re-run `npx tsx --tsconfig scripts/tsconfig.perf.json scripts/perf-audit.mts` from a machine in Vercel's region if possible
      (or compare against the table in the performance report) and confirm request counts did not creep back up.
- [ ] Cold start: the first request after idle is slower (new serverless instance, cold database cache). That is expected; it should
      not repeat on the next click.
- [ ] Private data: sign out, sign in as the same or another account in the same tab, open a stock you hold: the position shown
      must be that account's (the in-browser cache is cleared at sign-out and on the login page).
- [ ] Stale data: after the evening snapshot run, the Rankings page shows the new date within about a minute (server memo 60 s),
      and the Evaluation tab within 5 minutes (client cache) or immediately after a reload.

Cache budgets (all in one place each, short by design): `TTL_MS` in `src/lib/client/cache.ts` (popup 60 s, evaluation 5 min, history
10 min), `MARKET_UNIVERSE_TTL_MS` (60 s), and the 60 s / 10 min server memos in `src/lib/api/instrument.ts` and the Rankings page.
Live quotes are never cached (they poll `/api/quotes`).

## 9. Security

- [ ] Middleware: `/login` and `/api/cron/*` are public; everything else, including `/api/evaluation/*` and `/rankings`, needs a session (covered by `tests/auth/paths.test.ts`).
- [ ] `/api/cron/*` accepts only `Authorization: Bearer <CRON_SECRET>` and returns 401 otherwise, including when the secret is unset (covered by `tests/api/cronSnapshots.test.ts`).
- [ ] New tables have RLS enabled with no policies, so only the service role reads and writes them. Confirm with the Supabase security advisor (`get_advisors`) that no new table is exposed.
- [ ] The service-role key is used only in server code (`src/lib/supabase/admin.ts`); `grep -r "SERVICE_ROLE" src` shows no client component.
- [ ] No secrets in git history for this change set (`git diff` reviewed; `.env.local` ignored).
- [ ] `npm audit` reviewed; no new dependency was added by this work.
- [ ] The position-size panel stores only equity, risk %, allocation % and lot size in the browser (localStorage); nothing is sent to a server.

## 10. SEO and indexing

- [ ] This is a private, login-gated app. The goal is **not** to be indexed: `robots: { index: false, follow: false }` is set in `src/app/layout.tsx`. After deploy, view source on `/login` and confirm `<meta name="robots" content="noindex, nofollow">`.
- [ ] No sitemap or public content is added by this work. There is no `robots.txt` route: the middleware would send it to login, which crawlers treat as no access.

## 11. Rollback

| Problem | Action |
|---|---|
| Deployed app broken | Vercel dashboard: promote the previous deployment (instant). Database changes so far are compatible with the old app, as long as 0016 has not been applied |
| Snapshot job misbehaves | Remove the kick line in `src/app/api/cron/delivery/route.ts` and redeploy, or just stop calling the route; the scores in `daily_prices` and every existing page are unaffected |
| Bad TRENT data | `--revert` command in section 0 |
| 0016 applied and something needs the column | `alter table holdings add column target2 numeric;` restores the column only; the values come from the backup restore of `holdings` |
| Wrong snapshot rows | Delete by `(scoring_version, evaluation_date)`; the next run regenerates them |

## 12. After deployment

- [ ] Watch the next EOD, delivery and snapshot runs.
- [ ] Reconfirm the backup and keep it for at least a week.
- [ ] Open items that remain by decision: Media, Pvt Bank and Healthcare sector history (needs official CSVs in `data/niftyindices/history/` then `npm run import-niftyindices`), a fundamentals provider, event data, an NSE adjustment factor for TMPV.
