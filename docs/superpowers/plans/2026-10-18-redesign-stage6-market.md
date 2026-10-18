# Redesign Stage 6 — Market: Screeners, Breadth, Claude Summary and Reports

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship redesign spec stage 6 (§4.7, plus the Claude tasks from the foundation spec §5): the Market tab with "Today by Claude" (summary, top 3 market happenings, watchlist & portfolio news), ten Nifty 200 screener lists, and a breadth panel; a fixed JSON format for Claude's daily summary and stock reports with proper rendering on the Market tab and in the pop-up's AI Deep Dive tab; and the instructions Claude follows to write them, ready to be installed as scheduled tasks and a chat skill on the owner's Claude subscription (no Claude API).

**Architecture:** Screeners are pure functions over each Nifty 200 stock's last 6 stored sessions, loaded in one range query. The Market page reads the latest `daily_summaries` row and parses it with a zod schema (malformed content degrades to plain text, never crashes). Claude writes to Supabase through the Supabase connector following versioned instruction files in `docs/claude-tasks/`; those files contain the exact SQL to read inputs and write outputs, and are verified against the live database before being handed to Claude.

**Tech Stack:** unchanged. Claude side: the owner's Claude subscription — scheduled tasks + a saved skill, using the Supabase connector already connected to the owner's account (project **Tracker1**, ref `shatrllqjurfjwykfhvk`).

**Spec:** `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md` §4.2 (AI Deep Dive), §4.7, §8; `docs/superpowers/specs/2026-10-16-nifty-dashboard-design.md` §5 (Claude tasks). Previous plans: stages 1–5.

**Not in this stage:** alerts and Telegram (stage 7); History page (later plan).

## Global Constraints

- All earlier constraints hold (fractions, IST dates, dark tokens, mono tabular numbers, Windows-compatible scripts). **No Claude API** — nothing in the app calls Anthropic; Claude only reads/writes Supabase from the owner's Claude account.
- **Screener universe:** `NIFTY200` constituents; **session** = NIFTY50's latest priced date; each stock's latest row must be on that date to qualify (stale stocks are skipped).
- **Screener rules (spec §4.7), exactly:**
  | Id | Title | Rule (on the session row unless stated) | Sort | Shows |
  |---|---|---|---|---|
  | `vol_up` | Volume shockers · up | `volume ≥ 2 × volAvg20` and day % > 0 | ratio desc | ratio `2.4×`, day % |
  | `vol_down` | Volume shockers · down | same, day % < 0 | ratio desc | ratio, day % |
  | `breakout` | 52-week breakout zone | `close ≥ 0.97 × high52w`, or `high52w` greater than the previous session's `high52w` (new high) | distance to high asc (new highs first) | % from high, `NEW HIGH` chip |
  | `breakdown` | 52-week breakdown zone | `close ≤ 1.03 × low52w`, or `low52w` less than the previous session's (new low) | distance to low asc (new lows first) | % from low, `NEW LOW` chip |
  | `golden` | Golden cross | within the last 5 sessions some day d with `ema50 > ema200` and on the session before d `ema50 ≤ ema200` | most recent cross first | cross date |
  | `death` | Death cross | mirror of golden | most recent first | cross date |
  | `rsi_high` | RSI overbought | `rsi14 > 70` | RSI desc | RSI |
  | `rsi_low` | RSI oversold | `rsi14 < 30` | RSI asc | RSI |
  | `score_top` / `score_bottom` | Top / bottom scores | non-null score | desc / asc | score chip |
  Each list shows up to 10 rows and the total match count; ties by key ascending.
- **Breadth:** advances / declines / unchanged over constituents with a session day % (same rule as stage 3); `% above EMA 200` = constituents with `close > ema200` ÷ constituents with non-null `ema200`; India VIX latest close, day %, and last 21 closes for a sparkline.
- **Daily summary JSON** (stored in `daily_summaries`: `summary` text column + `market_events` and `watchlist_news` jsonb):
  - `summary`: 3–4 sentences, plain text.
  - `market_events`: exactly up to 3 items `{ "title": string, "explanation": string, "source_url": string }`.
  - `watchlist_news`: up to 5 items `{ "key": string, "title": string, "explanation": string, "source_url": string }`, keys of watchlist or portfolio stocks only; empty array when nothing relevant.
- **Report content JSON** (stored in `reports.content`):
  ```json
  { "summary": "2–3 sentences",
    "fundamentals": { "valuation": "...", "growth": "...", "balance_sheet": "...", "recent_results": "...", "news": "..." },
    "technicals": { "trend": "...", "momentum": "...", "volume": "...", "support": [number], "resistance": [number], "notes": "..." },
    "scenarios": { "bullish": { "case": "...", "confirm_above": number }, "bearish": { "case": "...", "invalidate_below": number } },
    "risks": ["...", "..."],
    "sources": [{ "title": "...", "url": "..." }],
    "disclaimer": "Analysis to inform your own decision, not investment advice." }
  ```
  No buy/sell recommendation, no price targets framed as advice (scenario levels only).
- **Claude task schedule** (owner's Claude account, Asia/Kolkata): daily summary Mon–Fri **18:00 IST** (after the EOD cron's 16:30–17:29 window); report queue **hourly 09:00–22:00 IST**, every day.

## Review Focus

1. **Summary row with malformed or partial JSON** (Claude wrote a string instead of an array, missing `source_url`) — card shows what parses, drops bad items, never throws. Pinned in Task 3.
2. **Screener stock missing the session row or with null `volAvg20`/`high52w`** (thin history) — skipped by that screener, not shown with `NaN×`. Pinned in Task 1.
3. **Golden/death cross counting** — a cross 6 sessions ago must not appear; a cross on the session itself must. Pinned in Task 1.
4. **Report written by Claude for a key that isn't in `instruments`** or a pending report never picked up — the instruction SQL inserts by key lookup and the Deep Dive tab shows "Pending since …"; a `failed` row shows its error. Pinned in Tasks 3 and 5.
5. **SQL in the instruction files drifts from the real schema** — every query is run once against Tracker1 (read-only parts as-is, write parts inside a rolled-back transaction) before the files are committed. Pinned in Task 5.

---

## File Structure

```
src/lib/calc/screeners.ts          runScreeners, SCREENERS
src/lib/view/breadth.ts            buildBreadth
src/lib/content/claude.ts          parseDailySummary, parseReportContent (zod)
src/lib/api/market.ts              loadMarket
src/lib/db/{repo,supabaseRepo,memoryRepo}.ts   + getDaysRange
src/app/(app)/market/page.tsx      rewritten
src/app/components/market/{ClaudeSummaryCard,ScreenerGrid,BreadthPanel}.tsx
src/app/components/ClaudeCard.tsx  (deleted; replaced by ClaudeSummaryCard)
src/app/components/popup/DeepDiveTab.tsx      structured report rendering
docs/claude-tasks/daily-summary.md
docs/claude-tasks/report-queue.md
docs/claude-tasks/stock-report.md             (shared report-writing procedure, used by the queue and by chat)
tests/calc/screeners.test.ts, tests/view/breadth.test.ts, tests/content/claude.test.ts, tests/api/market.test.ts
```

---

### Task 1: Screeners

**Files:** Create `src/lib/calc/screeners.ts`; Test `tests/calc/screeners.test.ts`

**Interfaces (Produces):**
```ts
type ScreenerId = "vol_up" | "vol_down" | "breakout" | "breakdown" | "golden" | "death" | "rsi_high" | "rsi_low" | "score_top" | "score_bottom";
interface ScreenerHit { key: string; name: string; close: number; dayPct: number | null; metric: number | null; flag: "NEW_HIGH" | "NEW_LOW" | null; date: string | null; scoreLabel: ScoreLabel | null }
interface ScreenerResult { id: ScreenerId; title: string; count: number; hits: ScreenerHit[] }   // hits ≤ 10
const SCREENERS: { id: ScreenerId; title: string }[]   // in table order
function runScreeners(stocks: { key: string; name: string; days: StoredDay[] }[], session: string, limit = 10): ScreenerResult[]
```
`days` ascending, up to 6 per stock; `metric` = ratio / % from high or low / RSI / score per the table; `date` = cross date for golden/death.

- [ ] **Step 1: Write failing tests** (one block per screener, synthetic rows):
  - Volume: volume 2.0× avg up 1% → in `vol_up` with metric 2; 1.99× → not; 2.5× down → `vol_down`; `volAvg20 null` → in neither.
  - Breakout: close 97 with high52w 100 → in, metric −0.03; close 96.9 → out; high52w 105 today vs 100 yesterday with close 101 → in with `NEW_HIGH`, listed before non-new rows.
  - Breakdown mirror at 1.03 and `NEW_LOW`.
  - Golden: ema50 ≤ ema200 on session −5 and > on −4 → in, date = session −4; cross between −6 and −5 → out; cross on the session itself → in.
  - Death mirror.
  - RSI 70 → out of `rsi_high`, 70.01 → in; 30 → out of `rsi_low`, 29.99 → in.
  - Score top/bottom: 12 scored stocks → `count 12`, hits 10, ordered; ties by key.
  - A stock whose last row is not on `session` → excluded from every screener.
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): Nifty 200 screeners`

---

### Task 2: Market loader and breadth

**Files:** Create `src/lib/view/breadth.ts`, `src/lib/api/market.ts`; Modify `src/lib/db/{repo,supabaseRepo,memoryRepo}.ts`; Test `tests/view/breadth.test.ts`, `tests/api/market.test.ts`, `tests/db/memoryRepo.test.ts`

**Interfaces (Produces):**
- Repo: `getDaysRange(instrumentIds: number[], fromDate: string, toDate: string): Promise<Map<number, StoredDay[]>>` — one query (Supabase: `in` filter chunked by 300 ids, paging past 1000 rows), rows ascending per instrument.
- `buildBreadth(sessionRows: StoredDay[], vixDays: StoredDay[]): { advances: number; declines: number; unchanged: number; total: number; adRatio: number | null; aboveEma200: number | null; aboveEma200Count: number; ema200Count: number; vix: { close: number | null; dayPct: number | null; spark: number[] } }` — `adRatio = advances / declines` (null when declines is 0).
- `loadMarket(repo: Repo, today: string): Promise<{ session: string | null; summary: ParsedSummary | null; screeners: ScreenerResult[]; breadth: ReturnType<typeof buildBreadth> | null; hasUniverse: boolean }>` — session from NIFTY50; constituents of `NIFTY200`; `getDaysRange(ids, sessionsBack(6 sessions on the Nifty calendar), session)`; VIX `getDays(id, 25)`; summary = `getDailySummary(session)` parsed with Task 3's parser (the summary is keyed by trading date, so on a weekend the Friday summary shows).

- [ ] **Step 1: Write failing tests** — breadth counts and `aboveEma200` = 2/3 for rows with ema200 `[below, above, above, null]`; `adRatio` null with no declines; VIX spark = last 21 closes. `loadMarket` with a memory repo: no constituents → `hasUniverse false`, empty screeners; with data → 10 screener results in `SCREENERS` order; `getDaysRange` called once (spy); weekend `today` still returns Friday's summary.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(api): market loader, breadth and range query`

---

### Task 3: Claude content formats

**Files:** Create `src/lib/content/claude.ts`; Modify `src/lib/view/popup.ts` (reports carry `parsed`); Test `tests/content/claude.test.ts`

**Interfaces (Produces):**
```ts
interface MarketEvent { title: string; explanation: string; sourceUrl: string | null }
interface WatchNews extends MarketEvent { key: string }
interface ParsedSummary { date: string; summary: string; events: MarketEvent[]; news: WatchNews[] }
function parseDailySummary(row: DailySummary): ParsedSummary
interface ReportContent { summary: string | null; fundamentals: Record<string, string>; technicals: { trend?: string; momentum?: string; volume?: string; support: number[]; resistance: number[]; notes?: string };
  scenarios: { bullish: { case: string; confirmAbove: number | null } | null; bearish: { case: string; invalidateBelow: number | null } | null };
  risks: string[]; sources: { title: string; url: string }[]; disclaimer: string }
function parseReportContent(raw: unknown): { ok: true; value: ReportContent } | { ok: false; raw: unknown }
```
Rules: items are validated one by one with zod (`safeParse`); invalid items are dropped; `events` capped at 3 and `news` at 5; a `source_url` that is not `http(s)://` becomes null; a JSON string column (Claude wrote `"[...]"` as text) is `JSON.parse`d once before validation; `disclaimer` defaults to "Analysis to inform your own decision, not investment advice."; unknown extra fields ignored. `parseReportContent` returns `ok: false` only when the root is not an object.

- [ ] **Step 1: Write failing tests** — a fully valid summary round-trips; `market_events` stored as a JSON string parses; an event missing `title` is dropped while the others stay; 5 events → 3; `source_url: "javascript:alert(1)"` → null; valid report parses with snake_case → camelCase; report missing `scenarios` → both null; report root a string → `ok: false`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(content): Claude summary and report formats`

---

### Task 4: Market tab and Deep Dive rendering

**Files:** Rewrite `src/app/(app)/market/page.tsx`; Create `src/app/components/market/{ClaudeSummaryCard,ScreenerGrid,BreadthPanel}.tsx`; Modify `src/app/components/popup/DeepDiveTab.tsx`; Delete `src/app/components/ClaudeCard.tsx` when unused

**Interfaces:**
- Page: `loadMarket(getRepo(), istDate(new Date()))`. Layout: `ClaudeSummaryCard` (full width) → two-column on desktop: `ScreenerGrid` (2/3) and `BreadthPanel` (1/3); stacks on phones.
- **ClaudeSummaryCard:** Panel `TODAY BY CLAUDE` with the session date and a small `Claude` chip; summary paragraph (max ~65ch); `TOP 3 HAPPENINGS` numbered 1–3 (this is a real ranked list): bold title, explanation, source link (`source ↗`, opens new tab, `rel="noopener noreferrer"`); `YOUR STOCKS` list: stock key as `StockLink`, title, explanation, source; hidden when empty. No summary → "No summary for today. Claude writes it on trading days around 6 PM IST."
- **ScreenerGrid:** Panel `SCREENERS · NIFTY 200 · as of DD Mon`; a 2-column grid of compact cards (one per screener) with title, count chip, and up to 5 rows visible (`Show all n` expands to 10); row = `StockLink` name, metric formatted per screener (`2.4×`, `−1.8% from high`, `RSI 74.2`, `Crossed 14 Oct`, score chip), day % with `PctText`; flags as Chips. Empty screener → "No stocks match today". No universe → the stage 3 import message.
- **BreadthPanel:** advance/decline bar (reuse the MoversPanel bar component; extract it if it is inline), `A/D 1.42`; `% ABOVE EMA 200` big number with a thin progress bar and `142 / 198`; `INDIA VIX` close, day %, `Sparkline`.
- **DeepDiveTab:** for `done` reports with `parsed.ok`, render sections: Summary; Fundamentals (label/value list using the keys title-cased); Technicals (trend/momentum/volume text, Support and Resistance as mono price chips, notes); Scenarios (two side-by-side cards: Bullish — "confirms above ₹x", Bearish — "invalidates below ₹y"); Risks (bullets); Sources (links); disclaimer in muted small text. `ok: false` → keep the existing generic renderer. Pending → "Pending since <IST time> — Claude checks for new requests every hour (9 AM–10 PM)". Failed → error text and "Request again".

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS.
- [ ] **Step 3: Seed and verify manually:** insert one sample `daily_summaries` row for the latest session and one `done` report for RELIANCE using the SQL in `docs/claude-tasks/` (Task 5) with sample text; check the Market tab card, links, `YOUR STOCKS` links to the pop-up, all ten screeners populated or showing their empty message, breadth numbers; pop-up AI Deep Dive renders every section; 390 px layout stacks. Delete the sample rows afterwards.
- [ ] **Step 4: Commit** `feat(ui): Market tab with Claude summary, screeners and breadth; structured reports`

---

### Task 5: Claude instruction files (verified SQL)

**Files:** Create `docs/claude-tasks/daily-summary.md`, `docs/claude-tasks/report-queue.md`, `docs/claude-tasks/stock-report.md`

Each file is written for Claude running in the owner's Claude account with the Supabase connector, and must contain: purpose; the Supabase project (Tracker1, ref `shatrllqjurfjwykfhvk`); exact read SQL; research steps; the exact JSON shape (Global Constraints); exact write SQL; failure handling; and "never give buy/sell advice".

- **daily-summary.md**
  1. Session: `select max(d.date) from daily_prices d join instruments i on i.id = d.instrument_id where i.key = 'NIFTY50' and d.close is not null;` — if it is not today (IST), stop: no session today.
  2. If a row already exists for that date in `daily_summaries`, stop (idempotent).
  3. Inputs (one query each): Nifty 50 / Bank Nifty / VIX close, day %, score label; the 11 sectors' day % and score label; top 5 gainers and losers of NIFTY200 on the session; watchlist and holdings keys with day %, score label.
  4. Web search for that day's Indian market news (Nifty move drivers, FII/DII flow headlines, sector news) and for each watchlist/portfolio stock's news dated that day.
  5. Write: `insert into daily_summaries (date, summary, market_events, watchlist_news) values ($date, $summary, $events::jsonb, $news::jsonb) on conflict (date) do nothing;` (with the JSON built per the format; dollar-quoted strings to avoid quote escaping).
- **stock-report.md** (shared procedure): given an instrument key and an optional report id — read the stock's latest 60 sessions' close/EMAs/RSI/MACD/score/levels and its sector; research fundamentals (valuation vs sector, growth, debt, latest results, news) on the web; produce content per the report JSON; write either `update reports set status='done', completed_at=now(), content=$json::jsonb where id=$id;` or, from chat, `insert into reports (instrument_id, status, requested_at, completed_at, requested_via, content) select id, 'done', now(), now(), 'chat', $json::jsonb from instruments where key = $key;`. On failure: `update reports set status='failed', error=$message where id=$id;`.
- **report-queue.md**: `select r.id, i.key from reports r join instruments i on i.id = r.instrument_id where r.status = 'pending' order by r.requested_at limit 3;` — none → stop quietly; else run `stock-report.md` for each, oldest first.

- [ ] **Step 1: Write the three files.**
- [ ] **Step 2: Verify every SQL statement against Tracker1** with the Supabase MCP `execute_sql`: run the read queries as written (they must return rows today, or an empty set with no error); run each write inside `begin; … ; rollback;` with sample values and confirm no error.
- [ ] **Step 3: Commit** `docs: Claude task instructions for daily summary and stock reports`

---

### Task 6: Install on the owner's Claude account (done in the Claude chat, not by Claude Code)

- [ ] **Step 1 (owner, in the Claude chat):** say "stage 6 is built, set up the Claude tasks". Claude then, from `docs/claude-tasks/`:
  - proposes a saved skill **nifty-dashboard-report** (contents of `stock-report.md`) so any chat can run "Dashboard report for RELIANCE";
  - creates scheduled task **Nifty daily summary** — `CRON_TZ=Asia/Kolkata 0 18 * * 1-5`, prompt = `daily-summary.md`;
  - creates scheduled task **Nifty report queue** — `CRON_TZ=Asia/Kolkata 0 9-22 * * *`, prompt = `report-queue.md`.
- [ ] **Step 2 (owner):** in each scheduled task's settings, turn on automatic approval if the plan allows it, so runs can write to Supabase without waiting.
- [ ] **Step 3:** trigger the daily-summary task once on a trading day after the EOD job has run and check the Market tab; request a report from a pop-up and check it appears within the hour.
- [ ] **Step 4:** README: how the Claude tasks work, where their instructions live, how to change them (edit the file, then ask Claude to update the scheduled task). Commit `docs: stage 6`.
