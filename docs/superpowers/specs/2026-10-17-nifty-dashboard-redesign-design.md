# Nifty Dashboard — Redesign & Expansion Spec

**Date:** 2026-10-17
**Status:** Draft for review
**Builds on:** `docs/superpowers/specs/2026-10-16-nifty-dashboard-design.md` (foundation, built and merged-ready: 16 tasks, 134 tests)
**Owner:** RealWebArts (private, single user)

## 1. Purpose

Keep everything the foundation does (real Yahoo data, Supabase history, EOD job, imported manual log, watchlist with levels) and replace how it looks and what it shows: a dark trading-terminal UI modelled on the reference repo `shawn91frost-lab/portfolio1`, a stock detail pop-up modelled on the owner's screenshot, a computed Technical Score, and four new areas — Portfolio, Sector Analysis with constituents, Market (Claude summary + screeners), and Alerts with Telegram.

**The reference repo is a design reference only.** Its prices are random (`Math.random` in `marketData.ts`); none of its data code is reused.

**Success criteria**
- Every page uses the new look; any stock or sector anywhere opens the same pop-up.
- The Technical Score and its breakdown are computed nightly for Nifty, all 11 sectors and every Nifty 200 stock, and match the formula in §5 exactly (unit-tested).
- Top gainers/losers, sector constituents and screeners reflect real Nifty 200 data as of the last session.
- Portfolio P/L, stop-loss and target status are correct against CMP.
- A triggered alert appears in the app bell and arrives on Telegram.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Visual reference | `shawn91frost-lab/portfolio1` look and layout; owner's RELIANCE screenshot for the pop-up |
| Tabs | Dashboard · Portfolio · Watchlist · Sector Analysis · Market · Alerts. No Transactions, Reports, Settings or Admin |
| Stock detail | Pop-up over the current page; opens from every stock or sector anywhere |
| Score | Computed by the app with a fixed formula (§5); Claude explains it in reports, never sets it |
| Universe | Nifty 200 + the 11 sector indices + Nifty 50, Bank Nifty, India VIX |
| Alerts | In-app bell + Telegram bot |
| Data | Unchanged: Yahoo (delayed) via the provider interface; Supabase; no Claude API |
| Chart | TradingView `lightweight-charts` (free, Apache-2.0) |

## 3. Visual system

- **Palette:** slate-950 page, slate-900 panels, slate-800 borders; emerald-400 up/accent, rose-400 down, amber-400 warning; tinted chip backgrounds (emerald-950/40, rose-950/40, amber-950/70). One accent (emerald) for active tab and links.
- **Type:** Plus Jakarta Sans (text, 400–800), JetBrains Mono (all numbers, tickers, labels), tabular numerals everywhere digits align. Small uppercase mono labels with letter-spacing (`TOTAL INVESTED`, `EMA 50`).
- **EMA colours (chart lines and chips):** EMA 20 cyan, EMA 50 amber, EMA 200 violet.
- **Score badge colours:** Strong Bullish emerald, Bullish green, Neutral slate, Bearish orange, Strong Bearish rose.
- **Panels:** `rounded-xl`, 1px border, no shadows except the pop-up. Tables: dense rows, hover tint, sticky header.
- **Dark only.** The app is a terminal; no light theme.
- **Responsive:** tabs collapse to a horizontal scroller under 1024px; grids stack; tables scroll horizontally inside their panel.

## 4. Screens

### 4.1 Shell
- **Top bar (sticky):** wordmark, the six tabs, stock search (type-ahead over the instrument list; Enter opens the pop-up), alert bell with unread count, sign out.
- **Market status strip:** OPEN / CLOSED / PRE-OPEN with IST clock, Nifty, Bank Nifty, VIX (price + day %, live during market hours), "Data as of" badge (amber when stale, as today).
- Tabs are routes (`/`, `/portfolio`, `/watchlist`, `/sectors`, `/market`, `/alerts`) so the browser back button and bookmarks work. The pop-up is shown via a `?stock=KEY` query parameter so it survives refresh and back closes it.

### 4.2 Stock pop-up
- **Header:** name, `NSE` chip, sector name, CMP with day change, **Technical Score badge** (score/100 + label), Add to Watchlist (or "On watchlist"), Add to Portfolio, close ✕.
- **Tabs:**
  1. **Chart & Setup** — candlestick chart; timeframe 1D 1W 1M 3M 6M 1Y ALL (daily bars; 1D/1W show the last 5/10 bars); overlay toggles EMA 20 / EMA 50 / EMA 200 / Bollinger; lower pane toggle Volume (with 20-day avg line) / RSI / MACD; OHLC + EMA values strip that follows the crosshair. Below the chart three cards:
     - **Primary signal:** one-line verdict from the score label and strongest component (e.g. "Bearish weakness & supply pressure"), confidence (§5.3), score breakdown (six rows, points / max).
     - **Support & resistance:** immediate resistance and support with strength (Strong when ≥3 touches merged into the level, else Weak; manual overrides marked M), 52-week high/low with % distance.
     - **Market & sector tailwinds:** Nifty regime (Bullish/Neutral/Bearish from Nifty's score label) with one line; sector relative strength (stock 4-week return minus its sector's) with one line.
  2. **AI Deep Dive** — the saved Claude report for this stock (from the report queue in the original spec), newest first, with "Request new report". Shows "No report yet" otherwise.
  3. **Patterns** — candlestick patterns detected in the last 10 sessions: name, date, bullish/bearish, points effect. Count shown in the tab label.
  4. **Indicator Table** — every stored indicator for the latest session: CMP, EMA 20/50/200 and % from each, RSI 14, MACD/signal/histogram, Bollinger upper/middle/lower, volume vs 20-day avg, 52-week high/low, RS vs Nifty, RS vs sector.
- For a **sector or index**, the same pop-up without Add buttons and without the sector tailwind row; the Patterns tab is still shown.

### 4.3 Dashboard (`/`)
1. **Nifty card:** large price and day move; prev close, day high/low, 52-week high/low; right side: EMA 20/50/200 cards (green above / red below with value), Nifty Technical Score badge, trend badge (above all / mixed / below all).
2. **Nifty interactive chart** (same chart component as the pop-up).
3. **Top 5 gainers / top 5 losers** of the Nifty 200 (last session or live during market hours), side by side; market breadth bar (advances / declines / unchanged).
4. **Portfolio snapshot:** invested, current value, overall P/L (₹, %), today's P/L, top 4 holdings by value; link to Portfolio. Empty state: "Add your first holding" button.
5. **Sector strip:** 11 tiles (name, day %, score), coloured by day %; tile click goes to Sector Analysis with that sector selected.

### 4.4 Portfolio (`/portfolio`)
- **Summary cards:** total invested, current value, overall P/L (₹, %), today's P/L, holdings count.
- **Warnings bar** (only when non-empty): one chip per holding in Near SL / SL Hit / Near Target / Target Hit with CMP and the level.
- **Holdings table:** stock, qty, avg buy, CMP, invested, current value, P/L (₹, %), day P/L, SL, T1, T2, status chip, score badge, edit / remove. Sortable.
- **Add / edit holding pop-up:** stock search ("reli" → Reliance Industries (RELIANCE)); on pick shows CMP, sector, score, auto support/resistance; inputs: quantity, buy price (defaults to CMP), buy date (defaults to today), stop loss, target 1, target 2 (optional; placeholders suggest auto support / resistance / next resistance). Adding a stock already held merges: quantity summed, average price weighted.
- **Status rules:** for SL: `cmp <= sl` → SL Hit; `(cmp - sl)/cmp <= 0.02` → Near SL. For T1: `cmp >= t1` → Target Hit; `(t1 - cmp)/cmp <= 0.02` → Near Target. Hit outranks Near; SL outranks Target; else OK.

### 4.5 Watchlist (`/watchlist`)
- Add box (same search) at the top.
- Columns: stock, CMP, day %, EMA 20, EMA 50, EMA 200 (each cell green when CMP above, red when below), trend chip, RSI, support, resistance (M badge for manual; click to edit as today), score badge, 1-month sparkline, remove. Near-level rows highlighted (within 1%, as today). Sortable; default sort score descending.

### 4.6 Sector Analysis (`/sectors`)
- **Tile grid** of the 11 sectors: name, day %, score, RSI; background intensity by |day %| (saturating at 2%).
- **Hover** (desktop) shows a preview: top 3 gainers and top 3 losers among its constituents today.
- **Select** a tile (click/tap) to open the detail panel below the grid: 1D/1W/1M/3M returns, trend vs EMA 50/200, RS vs Nifty, a "View chart" button (opens pop-up), and the **constituent table** (stock, CMP, day %, score, trend chip, RSI) sorted by day % descending, rows open the pop-up.
- **Rotation** sub-section: sectors ranked by RS vs Nifty (4-week), with rank change vs last week's Friday snapshot and an 8-week rank sparkline. This replaces the separate Rotation page in the original spec's build order.
- Selected sector is kept in the URL (`/sectors?s=NIFTY_IT`).

### 4.7 Market (`/market`)
- **Today by Claude:** summary, top 3 market happenings with source links, watchlist & portfolio news (≤5 items). Written by the daily Claude scheduled task (original spec §5) — the task now also covers portfolio stocks. Empty: "No summary for today".
- **Screeners** (Nifty 200, last session), each a compact list of up to 10 rows that open the pop-up, with a count:
  - Volume shockers — volume ≥ 2× 20-day average; split into up-day and down-day.
  - 52-week breakout zone — close within 3% of the 52-week high, or a new 52-week high today.
  - 52-week breakdown zone — close within 3% of the 52-week low, or a new low today.
  - Golden cross / death cross — EMA 50 crossed EMA 200 in the last 5 sessions.
  - RSI overbought (>70) / oversold (<30).
  - Top 10 / bottom 10 Technical Scores.
- **Breadth:** advances / declines / unchanged; % of Nifty 200 above EMA 200; India VIX with 1-month sparkline.

### 4.8 Alerts (`/alerts`)
- **Create alert:** instrument (search, incl. indices), condition, value where needed, mode once / repeat:
  - `price_above`, `price_below` (value)
  - `cross_ema20`, `cross_ema50`, `cross_ema200` (either direction)
  - `rsi_above_70`, `rsi_below_30`
  - `score_turns_bullish` (label moves from Neutral or below to Bullish or above), `score_turns_bearish` (mirror)
  - `holding_sl` / `holding_target` — created automatically for each holding with SL / T1, fire on Near and on Hit.
- **Rules list:** active / paused toggle, delete, last fired.
- **Feed:** triggered events (time, instrument, condition, price), unread first, mark read / mark all read. The top-bar bell shows the unread count and the latest 5.
- **Evaluation:** in the EOD job for all active rules (closing values). During market hours the app also evaluates `price_*` and holding rules on each live-quote refresh while a page is open (every 60 s, at most once per rule per 15 min). A once-only rule deactivates after firing; a repeat rule fires again only after its condition has become false and then true again.
- **Telegram:** each event is also sent as a message: `🔔 RELIANCE crossed above EMA 200 · ₹1,352.40 · 17 Oct 15:30`. Failure to send is logged on the event and does not block the in-app event.

## 5. Technical Score

Computed per instrument per session from stored daily data. Total 100. All thresholds are inclusive of the lower bound.

### 5.1 Components
| Component | Max | Rule |
|---|---|---|
| Trend | 20 | +4 each for close > EMA 20, > EMA 50, > EMA 200. Stack: +8 if EMA20 > EMA50 > EMA200; +4 if exactly two of the three pairwise orders (20>50, 50>200, 20>200) hold; else 0 |
| Momentum | 20 | RSI 14 (max 12): 55–70 → 12; 45–55 → 8; 70–80 → 6; 40–45 → 4; >80 → 2; <40 → 0. MACD (max 8): MACD > signal +4; MACD > 0 +2; histogram > previous histogram +2 |
| Volume | 15 | ratio = volume / 20-day average volume. Up day (close > prev close): ratio ≥ 2 → 15; ≥ 1.5 → 12; ≥ 1 → 9; else 7. Down day: ratio ≥ 2 → 0; ≥ 1.5 → 3; ≥ 1 → 5; else 7. Unchanged → 7. No volume (indices) → 7.5 |
| Pattern | 15 | Start 7.5; for each pattern detected in the last 3 sessions: bullish +3.75, bearish −3.75; clamp 0–15 |
| Market & Sector | 20 | Nifty label (max 8): Strong Bullish 8, Bullish 6, Neutral 4, Bearish 2, Strong Bearish 0. Sector label (max 6): same scale 6/4.5/3/1.5/0 (indices and sectors themselves use Nifty's label here). RS vs Nifty 4-week (max 6): ≥ +5% → 6; ≥ +2% → 4.5; ≥ −2% → 3; ≥ −5% → 1.5; else 0 |
| Risk/Levels | 10 | up = (resistance − close)/close, down = (close − support)/close using effective levels. Neither → 5. Only support → 7 if down ≤ 3% else 5. Only resistance → 3 if up ≤ 2% else 5. Both: ratio = up/down; ≥ 3 → 10; ≥ 2 → 8; ≥ 1 → 6; ≥ 0.5 → 3; else 0 |

Nifty itself is scored with its own trend, momentum, volume and pattern parts; its Market & Sector part is fixed at 10 (neutral) to avoid self-reference, and its label is computed before any other instrument.

Missing inputs (e.g. EMA 200 not yet available): that sub-rule scores half its points and the score is flagged `partial` (shown as "49/100 · partial data").

### 5.2 Labels
75–100 Strong Bullish · 60–74 Bullish · 45–59 Neutral · 30–44 Bearish · 0–29 Strong Bearish. Score is rounded to an integer for display; components keep one decimal.

### 5.3 Confidence
Each component's share = points/max. Count components with share ≥ 0.6 (bullish) and ≤ 0.4 (bearish). If the score label is bullish and bearish components ≤ 1, or bearish and bullish components ≤ 1 → High; if the opposing count is 2 → Medium; ≥ 3 → Low. Neutral label → Medium if one side has ≥ 4 components, else Low.

### 5.4 Primary signal line
`<Label words> · <strongest component phrase>`, where the strongest contributing phrase comes from a fixed table, e.g. Trend high → "price above all key EMAs", Trend low → "below all key EMAs", Volume low on a down day → "supply pressure", Volume high on an up day → "accumulation", Pattern high → "bullish reversal pattern", Risk high → "near support with room to run", Risk low → "pressing against resistance". The table lives in code next to the score.

### 5.5 Candlestick patterns
Detected on daily bars with standard definitions: bullish/bearish engulfing, hammer, inverted hammer, shooting star, hanging man, morning star, evening star, doji (counts only when within 1% of an effective support (bullish) or resistance (bearish) level), piercing line, dark cloud cover. Hammer/hanging man and inverted hammer/shooting star are distinguished by the prior 5-bar trend (close vs close 5 bars back).

## 6. Data changes

### 6.1 New indicators (stored on `daily_prices`)
`ema20`, `macd`, `macd_signal`, `macd_hist` (12, 26, 9 on closes, EMA seeding as existing), `bb_upper`, `bb_middle`, `bb_lower` (20-period SMA ± 2 population SD), `vol_avg20` (SMA of volume over the previous 20 sessions excluding today), `high_52w`, `low_52w` (max high / min low of the last 252 sessions including today), `rs_vs_sector`, `score`, `score_components` (jsonb: six parts + `partial` flag), `score_label`, `score_confidence`, `patterns` (jsonb array of `{name, bias}` detected on that bar). All computed over full stored history, same as the existing indicators.

### 6.2 New tables
- `index_constituents(index_key text, instrument_id bigint, primary key (index_key, instrument_id))` — `NIFTY200` plus the 11 sector keys.
- `holdings(id, instrument_id, quantity numeric, avg_price numeric, buy_date date, stop_loss, target1, target2 numeric null, created_at, updated_at)` — one row per instrument (merge on add).
- `alerts(id, instrument_id, condition text, value numeric null, mode text check in ('once','repeat'), active boolean, source text check in ('user','holding'), last_state boolean, last_fired_at timestamptz, created_at)`.
- `alert_events(id, alert_id, instrument_id, fired_at, price numeric, message text, read boolean default false, telegram_status text)`.
- RLS on, no policies (same model as migration 0002).

### 6.3 Universe and imports (owner downloads from niftyindices.com into `data/`)
- Nifty 200 constituent list (CSV) → `index_constituents('NIFTY200', …)`; missing stocks are added to `instruments`.
- One constituent CSV per sector index (11 files) → `index_constituents(<sector key>, …)`. A stock's **sector** is the sector index it belongs to, in `SECTOR_KEYS` order of priority when it belongs to several (Bank before Financial Services before Private/PSU Bank).
- Historical daily data for the 8 THIN sectors (Auto, Financial Services, FMCG, Media, Metal, PSU Bank, Private Bank, Healthcare) → `daily_prices` OHLC, then indicators recomputed. Yahoo keeps supplying new days.
- An import script with a dry run (same pattern as the history import) for all three file kinds; file names and columns confirmed against the real downloads during the build.
- One-time back-fill of all Nifty 200 stocks from 2015.

### 6.4 EOD job
- Processes Nifty → sectors → indices → Nifty 200 stocks + any watchlist/holding stocks outside it, about 215 instruments, concurrency raised to 8, computing all indicators, then scores in dependency order (Nifty, then sectors, then stocks).
- Then: rotation snapshot on Fridays, alert evaluation, Telegram sends.
- **Time budget:** if a measured run exceeds 45 s, the job splits: the cron route processes indices + sectors + portfolio/watchlist stocks, and a second chunk of the Nifty 200 is processed by a follow-up request the first run fires to itself (`/api/cron/eod?part=2`, same secret). The build measures a real run and adopts the split only if needed.

### 6.5 Telegram
Env vars `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Owner creates the bot with BotFather and gets the chat ID by messaging the bot once; README documents the two steps. Sends via `https://api.telegram.org/bot<token>/sendMessage`. If either variable is missing, alerts stay in-app only and the Alerts page says "Telegram not connected".

## 7. Error handling
- Missing data for a stock (new listing, thin history): indicators null → score `partial`; pop-up and tables show "—" with a tooltip "not enough history".
- Constituent CSV symbol unknown to Yahoo: reported by the import dry run; skipped.
- Screener with no matches: "No stocks match today".
- Chart with fewer than 2 bars: "Not enough price history to chart".
- Portfolio with SL above CMP at entry, or T1 below CMP: allowed, with an inline warning.
- Telegram failure: event saved with `telegram_status = 'failed: <reason>'`; shown as a small warning on the event.
- EOD over budget: run is logged `partial` with the unprocessed keys (existing stale-badge rule applies).

## 8. Testing
- Unit tests for every new calculation against reference values: EMA 20, MACD, Bollinger, volume average, 52-week high/low, each candlestick pattern (positive and negative fixture per pattern), every score component boundary in §5.1, labels, confidence, primary-signal phrasing, portfolio status rules and merge-averaging, alert condition evaluation including once/repeat state.
- EOD job tests extended with the fake provider and memory repo: score dependency order, alert firing, Telegram sender mocked (success and failure).
- Import dry-run tests with fixtures shaped like the niftyindices.com files.
- Visual check of every page and the pop-up at desktop and 390 px width in the owner checklist.

## 9. Build order
1. **Shell + Dashboard:** visual system, top bar and tabs (routes), status strip, Nifty card, chart component with EMA 20/50/200 overlays.
2. **Indicators + score + universe + pop-up:** new indicator columns, patterns, Technical Score, niftyindices imports, Nifty 200 back-fill, EOD job extension, stock pop-up (all four tabs).
3. **Watchlist redesign + gainers/losers + breadth.**
4. **Sector Analysis** (tiles, hover, constituents, rotation).
5. **Portfolio.**
6. **Market** (screeners, breadth, Claude summary card; Claude task updated to include portfolio).
7. **Alerts + Telegram.**

Each stage gets its own implementation plan. The original spec's remaining build items (History page; Search tab → now the top-bar search and pop-up; Claude summary/report tasks) are folded in: History calendar and stats move into a later plan; the Claude scheduled tasks are set up in stage 6.

## 10. Out of scope
Transactions, reports, CSV import of holdings, multi-user, admin, light theme, intraday bars, broker integration, derivatives data, FII/DII.

## 11. Owner checklist (new)
- Download from niftyindices.com: Nifty 200 constituents, 11 sector constituent lists, historical data for the 8 thin sectors.
- Create a Telegram bot (BotFather), send it one message, add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to `.env.local` and Vercel.
- Visual check of each stage while signed in.
