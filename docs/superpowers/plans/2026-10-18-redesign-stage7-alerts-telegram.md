# Redesign Stage 7 — Alerts and Telegram

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship redesign spec stage 7 (§4.8, §6.5): alert rules on any stock or index (price above/below, EMA 20/50/200 cross, RSI above 70 / below 30, score turns bullish/bearish), automatic stop-loss/target alerts for every holding, evaluation at end of day and on live quotes during market hours, an in-app feed with an unread bell in the top bar, and Telegram delivery through the owner's own bot.

**Architecture:** One pure evaluator (`src/lib/calc/alerts.ts`) decides, from a rule's stored state and a market snapshot, whether the rule is true now and whether it fires. One engine (`src/lib/jobs/alerts.ts`) loads rules, builds snapshots, evaluates, saves state, records events and sends Telegram messages; it runs at the end of the EOD job and, for price and holding rules only, inside the `/api/quotes` request during market hours. Holding rules are derived from holdings by a sync function, never edited by hand.

**Tech Stack:** unchanged; Telegram Bot API over `fetch` (no library).

**Spec:** `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md` §4.1 (bell), §4.4 (status rules), §4.8, §6.2 (`alerts`, `alert_events`), §6.5, §7. Previous plans: stages 1–6.

## Global Constraints

- All earlier constraints hold (fractions, IST dates, dark tokens, mono numbers, no Claude API, Windows-compatible scripts).
- **Conditions and their state** (state = is the condition true now):
  | Condition | Value | State | Fires when | Uses |
  |---|---|---|---|---|
  | `price_above` | price | `price > value` | state goes false → true | live price intraday, close at EOD |
  | `price_below` | price | `price < value` | false → true | same |
  | `cross_ema20` / `cross_ema50` / `cross_ema200` | — | `close > ema` | state changes either way (true→false or false→true) | EOD only |
  | `rsi_above_70` | — | `rsi14 > 70` | false → true | EOD only |
  | `rsi_below_30` | — | `rsi14 < 30` | false → true | EOD only |
  | `score_turns_bullish` | — | label ∈ {Bullish, Strong Bullish} | false → true | EOD only |
  | `score_turns_bearish` | — | label ∈ {Bearish, Strong Bearish} | false → true | EOD only |
  | `holding_sl` | holding's SL | level: `hit` if price ≤ SL, `near` if (price − SL)/price ≤ 0.02, else `none` | level rises (none→near, none→hit, near→hit) | live intraday + EOD |
  | `holding_target` | holding's T1 | `hit` if price ≥ T1, `near` if (T1 − price)/price ≤ 0.02, else `none` | level rises | live intraday + EOD |
- **No firing on creation:** a new rule stores its current state without firing (the form tells the owner when the condition is already true). A rule whose state is unknown (missing data) never fires and keeps its previous state.
- **Modes:** `once` → deactivated after it fires; `repeat` → fires again only after its state has gone back to false (or the holding level back to `none`) and then true again. Holding rules are always `repeat`.
- **Intraday throttle:** a rule fires at most once per 15 minutes (`last_fired_at`); intraday evaluation runs only while `isMarketOpen(now)` and at most once per 60 s per server instance.
- **Messages** (one line, used for the feed and Telegram), price with `en-IN` 2 decimals, time `DD Mon HH:mm` IST:
  - `🔔 RELIANCE crossed above ₹1,350.00 · ₹1,352.40 · 17 Oct 15:30` (price_above), `… fell below …` (price_below)
  - `🔔 RELIANCE crossed above EMA 200 · ₹1,352.40 · 17 Oct 15:30` / `… crossed below EMA 50 …`
  - `🔔 RELIANCE RSI above 70 (72.4) · ₹1,352.40 · 17 Oct 15:30` / `RSI below 30 (28.1)`
  - `🔔 RELIANCE score turned Bullish (64) · …` / `… turned Bearish (41) · …`
  - `⚠️ TCS near stop loss ₹3,400.00 · ₹3,412.00 · …`, `🛑 TCS stop loss hit ₹3,400.00 · …`, `🎯 INFY near target ₹1,700.00 · …`, `🎯 INFY target hit ₹1,700.00 · …`
- **Telegram:** env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; `POST https://api.telegram.org/bot<token>/sendMessage` with `{ chat_id, text, disable_web_page_preview: true }`, 5 s timeout. Event `telegram_status`: `sent`, `failed: <reason>` (≤ 200 chars), or `not_configured`. A Telegram failure never stops the event from being saved or other rules from running.
- **EOD time budget:** raise `maxDuration` on `/api/cron/eod` to 300 (Vercel Hobby allows 5 minutes); the alert pass runs after the score pass.

## Review Focus

1. **Repeated firing** — a stock sitting above EMA 200 for weeks, or a holding sitting near its SL all afternoon, must produce one event, not one per EOD run or per minute. Pinned in Task 1 (state machine) and Task 4 (throttle).
2. **Missing data** (stock with no row today, null EMA/RSI/score) — no event, previous state kept, no crash. Pinned in Task 1.
3. **Holding edited or removed** — its SL/target rules follow (new level values, deleted with the holding) without duplicating rules. Pinned in Task 2.
4. **Telegram down or misconfigured** — events still saved with the failure reason; the run continues. Pinned in Tasks 3 and 4.
5. **Quotes route latency** — intraday evaluation must not slow `/api/quotes` noticeably: one rules query, no per-rule queries, Telegram sends in parallel with a 5 s cap. Pinned in Task 4.

---

## File Structure

```
supabase/migrations/0006_alerts.sql
src/lib/calc/alerts.ts            evaluateRule, alertMessage, CONDITIONS
src/lib/db/{types,repo,supabaseRepo,memoryRepo}.ts   + AlertRule, AlertEvent and methods
src/lib/notify/telegram.ts        createTelegramSender
scripts/telegram-setup.ts         find chat id / send test message
src/lib/jobs/alerts.ts            runAlerts, syncHoldingAlerts
src/lib/jobs/eod.ts               + alert pass
src/lib/api/quotes.ts             + intraday alert pass
src/lib/api/portfolio.ts          + syncHoldingAlerts after add/edit/delete
src/lib/api/alerts.ts             handlers
src/app/api/alerts/route.ts       GET list / POST create
src/app/api/alerts/[id]/route.ts  PATCH (active) / DELETE
src/app/api/alerts/feed/route.ts  GET bell data
src/app/api/alerts/read/route.ts  POST mark read
src/app/(app)/alerts/page.tsx
src/app/components/alerts/{AlertForm,RulesList,EventFeed,Bell}.tsx
src/app/components/shell/TopBar.tsx       + Bell
src/app/components/popup/StockModal.tsx   + "Set alert" button
tests/calc/alerts.test.ts, tests/notify/telegram.test.ts, tests/jobs/alerts.test.ts, tests/api/alerts.test.ts, tests/db/memoryRepo.test.ts (+alerts)
```

---

### Task 1: Alert evaluator and messages

**Files:** Create `src/lib/calc/alerts.ts`; Test `tests/calc/alerts.test.ts`

**Interfaces (Produces):**
```ts
type AlertCondition = "price_above" | "price_below" | "cross_ema20" | "cross_ema50" | "cross_ema200" | "rsi_above_70" | "rsi_below_30" | "score_turns_bullish" | "score_turns_bearish" | "holding_sl" | "holding_target";
type HoldingLevel = "none" | "near" | "hit";
const CONDITIONS: { id: AlertCondition; label: string; needsValue: boolean; intraday: boolean; userCreatable: boolean }[];
interface Snapshot { key: string; price: number | null; ema20: number | null; ema50: number | null; ema200: number | null; rsi14: number | null; score: number | null; scoreLabel: ScoreLabel | null; at: Date; live: boolean }
interface RuleState { condition: AlertCondition; value: number | null; mode: "once" | "repeat"; lastState: boolean | null; lastLevel: HoldingLevel | null; lastFiredAt: Date | null }
interface Evaluation { known: boolean; state: boolean | null; level: HoldingLevel | null; fire: boolean; direction: "above" | "below" | null }
function evaluateRule(rule: RuleState, snap: Snapshot, opts: { throttleMs?: number /*15 min*/ }): Evaluation
function initialState(condition: AlertCondition, value: number | null, snap: Snapshot): { state: boolean | null; level: HoldingLevel | null }
function alertMessage(key: string, condition: AlertCondition, ev: Evaluation, snap: Snapshot, value: number | null): string
```
`fire` is false when `known` is false, when the throttle window since `lastFiredAt` has not passed, and for intraday-only evaluation of EOD-only conditions (`snap.live` true and condition not `intraday`).

- [ ] **Step 1: Write failing tests**
  - `price_above 1350`: lastState false, price 1352.4 → fire; lastState true, price 1360 → no fire; lastState null (fresh) → no fire, state true; price null → `known false`, no fire.
  - `cross_ema200`: lastState false → price above EMA → fire with direction `above`; lastState true → below → fire `below`; unchanged → no fire; ema200 null → unknown.
  - `rsi_above_70` boundary: 70 → state false; 70.01 → true.
  - `score_turns_bullish`: Neutral → Bullish fires; Bullish → Strong Bullish does not (already true).
  - Holding SL 3400: price 3412 (0.35%) → level `near` fires from `none`; next eval still near → no fire; price 3399 → `hit` fires; back to 3600 → `none` (no fire); then near again → fires.
  - Holding target 1700: price 1667 → near (1.98%); 1700 → hit.
  - Throttle: price_above fired 10 min ago, state went false then true → no fire; 16 min → fire.
  - EOD-only condition with `snap.live true` → no fire, state unchanged.
  - `alertMessage` for each condition equals the Global Constraints examples given matching snapshots (e.g. `🔔 RELIANCE crossed above EMA 200 · ₹1,352.40 · 17 Oct 15:30` for `at = 2026-10-17T10:00:00Z`).
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): alert conditions, state machine and messages`

---

### Task 2: Alert storage and holding sync

**Files:** Create `supabase/migrations/0006_alerts.sql`; Modify `src/lib/db/{types,repo,supabaseRepo,memoryRepo}.ts`; Create `src/lib/jobs/alerts.ts` (sync part); Modify `src/lib/api/portfolio.ts`; Test `tests/db/memoryRepo.test.ts`, `tests/jobs/alerts.test.ts`

**Migration:**
```sql
create table if not exists alerts (
  id bigserial primary key,
  instrument_id bigint not null references instruments on delete cascade,
  condition text not null,
  value numeric,
  mode text not null default 'once' check (mode in ('once','repeat')),
  active boolean not null default true,
  source text not null default 'user' check (source in ('user','holding')),
  last_state boolean, last_level text check (last_level in ('none','near','hit')),
  last_fired_at timestamptz,
  created_at timestamptz not null default now());
create unique index if not exists alerts_holding_unique on alerts (instrument_id, condition) where source = 'holding';
create table if not exists alert_events (
  id bigserial primary key,
  alert_id bigint references alerts on delete set null,
  instrument_id bigint not null references instruments on delete cascade,
  fired_at timestamptz not null default now(),
  price numeric, message text not null,
  read boolean not null default false,
  telegram_status text);
create index if not exists alert_events_fired_idx on alert_events (fired_at desc);
alter table alerts enable row level security;
alter table alert_events enable row level security;
```

**Interfaces (Produces):**
- Types `AlertRule { id; instrumentId; key; name; yahooTicker; condition; value; mode; active; source; lastState; lastLevel; lastFiredAt: string | null; createdAt }`, `AlertEvent { id; alertId; instrumentId; key; name; firedAt; price; message; read; telegramStatus }`.
- Repo: `listAlertRules(f?: { activeOnly?: boolean; conditions?: AlertCondition[] }): Promise<AlertRule[]>`, `createAlertRule(r: { instrumentId; condition; value; mode; source; lastState; lastLevel }): Promise<AlertRule>`, `setAlertActive(id, active)`, `deleteAlertRule(id)`, `saveAlertStates(updates: { id; lastState; lastLevel; lastFiredAt?: string; active?: boolean }[]): Promise<void>` (one batched write), `insertAlertEvents(events: Omit<AlertEvent, "id" | "key" | "name" | "read">[]): Promise<void>`, `listAlertEvents(limit: number): Promise<AlertEvent[]>` (unread first, then newest), `unreadAlertCount(): Promise<number>`, `markAlertsRead(ids: number[] | "all"): Promise<void>`.
- `syncHoldingAlerts(repo: Repo, snapshotFor: (instrumentId: number) => Promise<Snapshot | null>): Promise<void>` — for every holding: SL set → ensure one `holding_sl` rule with `value = SL` (update value if changed, re-initialising `lastLevel` from the snapshot without firing); SL cleared → delete that rule; same for T1 → `holding_target`; delete holding rules whose instrument is no longer held. `handleHoldingPost/Put/Delete` call it after a successful write.

- [ ] **Step 1: Write failing tests** — memory repo CRUD and `listAlertEvents` ordering (unread first); `saveAlertStates` batched; holding unique index honoured by memory repo; `syncHoldingAlerts`: new holding with SL and T1 → 2 rules (`repeat`, `source holding`); edit SL → same rule id with new value and no event; clear T1 → its rule removed; delete holding → both removed; running sync twice → no duplicates.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Apply migration 0006** to Tracker1; verify both tables exist.
- [ ] **Step 6: Commit** `feat(db): alert rules and events; holding alert sync`

---

### Task 3: Telegram sender and setup script

**Files:** Create `src/lib/notify/telegram.ts`, `scripts/telegram-setup.ts`; add npm script `"telegram-setup": "tsx scripts/telegram-setup.ts"`; Modify `.env.example` (+ `TELEGRAM_BOT_TOKEN=`, `TELEGRAM_CHAT_ID=`); Test `tests/notify/telegram.test.ts`

**Interfaces (Produces):**
- `type Sender = (text: string) => Promise<"sent" | `failed: ${string}` | "not_configured">`
- `createTelegramSender(env: { token?: string; chatId?: string }, fetchImpl = fetch, timeoutMs = 5000): Sender` — missing token or chat id → `not_configured` without a request; non-2xx or Telegram `ok: false` → `failed: <description or status>`; network error/timeout → `failed: <message>`; never throws.
- Script: loads `.env.local`; with no `TELEGRAM_CHAT_ID`, calls `getUpdates` and prints each chat's id and name ("Send any message to your bot first, then run this again" when empty); with both set, sends `✅ Nifty Pulse alerts are connected` and prints the result.

- [ ] **Step 1: Write failing tests** with a fake `fetch`: correct URL and JSON body; `ok: true` → `sent`; `{ ok: false, description: "chat not found" }` → `failed: chat not found`; fetch throws → `failed: …`; slow fetch beyond timeout → `failed`; no token → `not_configured` and fetch not called.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(notify): Telegram sender and setup script`

---

### Task 4: Alert engine (EOD and intraday)

**Files:** Modify `src/lib/jobs/alerts.ts`, `src/lib/jobs/eod.ts`, `src/lib/api/quotes.ts`, `src/app/api/cron/eod/route.ts` (`maxDuration = 300`), `src/lib/api/server.ts` (shared sender); Test `tests/jobs/alerts.test.ts`, `tests/jobs/eod.test.ts`, `tests/api/quotes.test.ts`

**Interfaces (Produces):**
```ts
function runAlerts(deps: { repo: Repo; send: Sender; now: Date; mode: "eod" | "intraday"; quotes?: Record<string, { price: number }> }): Promise<{ evaluated: number; fired: number; telegramFailed: number }>
```
- `eod`: all active rules; snapshot per instrument from `getLatestDay` (one `getDaysOn`/latest-day batch for all rule instruments, not per rule): price = close, indicators and score from that row; `at = now`, `live false`.
- `intraday`: only rules with `CONDITIONS[c].intraday`; snapshot price from `quotes` by ticker (rules whose ticker has no quote are skipped as unknown); `live true`.
- For each rule: `evaluateRule` → collect state updates; for fires build the message, deactivate `once` rules; `saveAlertStates` once; `insertAlertEvents` once; send Telegram for each fired event in parallel (`Promise.allSettled`), recording each result in the event's `telegram_status` (send before insert so the status is stored with the event).
- EOD: after the score pass, `runAlerts(mode: "eod")`; its counts go into the run message (`alerts fired 2, telegram failed 0`); an exception in the alert pass marks the run `partial` with the error, never `failed`.
- Quotes: when `isMarketOpen(now)` and the module-level `lastIntradayRun` is older than 60 s, run `runAlerts(mode: "intraday", quotes)` after fetching quotes, with errors swallowed (logged) so quotes still return.

- [ ] **Step 1: Write failing tests** — memory repo + fake sender:
  - EOD: a `cross_ema200` rule whose stock moved above EMA 200 → one event with the exact message, sender called once, `telegram_status sent`; running EOD again → no new event.
  - `once` rule → inactive after firing; `repeat` rule stays active.
  - Sender returns `failed: x` → event saved with that status, `telegramFailed 1`.
  - Intraday: holding near SL from a live quote → event; same minute again → throttled (no event); EOD-only rules untouched (their `lastState` unchanged).
  - Quotes handler during market hours runs the intraday pass once within 60 s (spy) and still returns quotes when `runAlerts` throws.
  - EOD run with a throwing alert pass → status `partial`, message contains the error.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(jobs): alert engine at end of day and on live quotes`

---

### Task 5: Alerts API

**Files:** Create `src/lib/api/alerts.ts`, `src/app/api/alerts/route.ts`, `src/app/api/alerts/[id]/route.ts`, `src/app/api/alerts/feed/route.ts`, `src/app/api/alerts/read/route.ts`; Test `tests/api/alerts.test.ts`

**Interfaces (Produces):**
- `GET /api/alerts` → `{ rules: AlertRule[]; events: AlertEvent[] (latest 100); telegram: "connected" | "not_configured" }`.
- `POST /api/alerts` body `{ key, condition, value?, mode }` (zod: user-creatable conditions only; `value` required and > 0 for price conditions; `mode` once|repeat) → resolves instrument (stocks, indices and sectors allowed), computes `initialState` from the latest day (and live quote when the market is open), creates the rule → 201 `{ rule, alreadyTrue: boolean }`; unknown key → 404; validation → 400 `{ errors }`.
- `PATCH /api/alerts/[id]` `{ active: boolean }`; `DELETE /api/alerts/[id]` → 204; holding rules → 409 `{ error: "managed_by_portfolio" }` for both.
- `GET /api/alerts/feed` → `{ unread: number; latest: AlertEvent[] (5) }`.
- `POST /api/alerts/read` `{ ids: number[] } | { all: true }` → 204.

- [ ] **Step 1: Write failing tests** for each route's handler: create returns `alreadyTrue` when price is already above the value; price rule without value → 400; `holding_sl` via POST → 400; PATCH/DELETE on a holding rule → 409; feed unread count after mark-read is 0.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(api): alert rules, feed and read state`

---

### Task 6: Alerts UI and bell

**Files:** Rewrite `src/app/(app)/alerts/page.tsx`; Create `src/app/components/alerts/{AlertForm,RulesList,EventFeed,Bell}.tsx`; Modify `src/app/components/shell/TopBar.tsx`, `src/app/components/popup/StockModal.tsx`

**Interfaces:**
- **Alerts page** (server loads `GET /api/alerts` data directly via the handler), layout: Telegram status banner (`Telegram connected` up chip, or warn Panel "Telegram not connected — alerts show here only. Run `npm run telegram-setup` and add the two settings to Vercel."), then two columns on desktop: left `AlertForm` + `RulesList`, right `EventFeed`; stacks on phones.
- **AlertForm:** stock/index search (same style as SearchBox, includes indices/sectors; `?new=KEY` pre-fills), condition select (user-creatable `CONDITIONS` with plain labels: "Price goes above", "Price goes below", "Crosses EMA 20 / 50 / 200", "RSI goes above 70", "RSI goes below 30", "Score turns Bullish", "Score turns Bearish"), value input only for price conditions (placeholder = current price), mode toggle `Once` / `Every time`; after picking a stock shows current price, EMAs, RSI and score; on save shows "Alert created" or, when `alreadyTrue`, "Alert created — this is already true now, so it will fire the next time it becomes true."
- **RulesList:** grouped `Your alerts` and `From your portfolio` (holding rules, read-only, "Edit in Portfolio" link); each row: `StockLink` key, condition text with value, mode chip, last fired time or "never", active toggle (user rules), delete with two-step confirm (user rules).
- **EventFeed:** Panel `ALERT FEED` with `Mark all read`; rows: message, time (IST), stock link, Telegram status icon (✓ sent, ⚠ failed with the reason as title, — not configured), unread rows highlighted with a left `--up` border; clicking a row marks it read. Empty: "No alerts have fired yet."
- **Bell** (TopBar, between search and sign-out): bell icon with unread count badge; polls `/api/alerts/feed` every 60 s (and on window focus); click opens a dropdown with the latest 5 messages and `See all alerts →` to `/alerts`; opening the dropdown does not mark them read.
- **StockModal header:** `Set alert` button → `/alerts?new=KEY`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS.
- [ ] **Step 3: Verify manually** (`npm run dev`, signed in):
  - Create "Price goes above" on a stock with a value just below its price → "already true" message; create one just above its last close.
  - Trigger EOD locally (`curl.exe -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/eod`) on a day when data has moved, or temporarily set a rule's `last_state` false in Supabase for a condition now true → event appears in the feed, bell count increases, Telegram message arrives (after Task 7 setup).
  - Holding with SL near CMP shows a `From your portfolio` rule; editing the SL updates the rule value; removing the holding removes the rule.
  - Pause/resume and delete a user rule; holding rules cannot be deleted here.
  - Mark read / mark all read updates the bell.
  - 390 px: columns stack, bell dropdown fits the screen.
- [ ] **Step 4: Commit** `feat(ui): Alerts tab, feed and top-bar bell`

---

### Task 7: Telegram setup, deploy settings and docs

- [ ] **Step 1 (owner):** in Telegram, open **@BotFather**, send `/newbot`, choose a name (e.g. "Nifty Pulse") and a username ending in `bot`; copy the token it gives. Open your new bot and send it any message (e.g. "hi").
- [ ] **Step 2:** add `TELEGRAM_BOT_TOKEN=<token>` to `.env.local`, run `npm run telegram-setup`, copy the printed chat id into `TELEGRAM_CHAT_ID=` in `.env.local`, run `npm run telegram-setup` again → "✅ Nifty Pulse alerts are connected" arrives in Telegram.
- [ ] **Step 3 (owner):** add both settings in Vercel → Settings → Environment Variables (Production, Preview, Development) and redeploy; apply migration 0006 if not done; the Alerts tab banner shows "Telegram connected".
- [ ] **Step 4:** README: alert conditions and when they fire, the 15-minute throttle, intraday vs end-of-day checks, Telegram setup, `maxDuration` 300. Commit `docs: stage 7`.
