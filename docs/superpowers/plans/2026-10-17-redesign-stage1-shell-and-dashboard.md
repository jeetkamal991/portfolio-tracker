# Redesign Stage 1 — Shell + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship redesign spec build-order stage 1: the dark terminal visual system, the six-tab shell with the market status strip, and the new Dashboard (Nifty card with EMA 20/50/200 cards, interactive Nifty chart, sector strip), with the existing watchlist, heatmap and Claude card moved onto their tabs.

**Architecture:** A Next.js route group `(app)` holds the six tab routes under one server layout that renders the top bar, the status strip and the shared `QuotesProvider`. All numbers shown come from pure, unit-tested view-model builders in `src/lib/view/`; components only format and lay out. The chart is a client component wrapping TradingView `lightweight-charts` v5. EMA 20 joins the existing indicator pipeline as a stored column.

**Tech Stack:** existing (Next.js 15.5 App Router, React 19, Tailwind 4, Supabase, Vitest) + `lightweight-charts` v5, `next/font/google` (Plus Jakarta Sans, JetBrains Mono).

**Spec:** `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md` (stage 1 of §9). Foundation spec: `docs/superpowers/specs/2026-10-16-nifty-dashboard-design.md`.

**Not in this stage (later stages, do not build):** Technical Score badge, stock pop-up, top-bar search, alert bell (stages 2/7); gainers/losers, breadth (3); portfolio snapshot (5); MACD and Bollinger chart options (2). Leave no placeholders for them on the Dashboard; the Portfolio and Alerts routes show a one-line "Coming soon" panel.

## Global Constraints

- All existing constraints from the foundation plan still hold (fractions for %, IST dates, Windows-compatible npm scripts, service-role key server-only, no Claude API).
- **Dark only.** Remove the light palette and every `dark:` variant in touched files; `color-scheme: dark` on `:root`.
- **Palette (spec §3), as CSS variables in `globals.css` and Tailwind theme tokens:** `--bg` slate-950 `#020617`, `--panel` slate-900 `#0f172a`, `--panel-2` slate-950 inset `#020617`, `--border` slate-800 `#1e293b`, `--text` slate-100 `#f1f5f9`, `--muted` slate-400 `#94a3b8`, `--up` emerald-400 `#34d399`, `--down` rose-400 `#fb7185`, `--warn` amber-400 `#fbbf24`, `--accent` = `--up`. EMA colours: `--ema20` cyan-400 `#22d3ee`, `--ema50` amber-400 `#fbbf24`, `--ema200` violet-400 `#a78bfa`.
- **Type:** Plus Jakarta Sans (400–800) as `--font-sans`; JetBrains Mono (400–700) as `--font-mono`. Every price, %, ticker and uppercase label uses mono with `tabular-nums`.
- Tabs are routes: `/` Dashboard, `/portfolio`, `/watchlist`, `/sectors`, `/market`, `/alerts`. `/login` stays outside the shell.
- Layout must work at 390 px width with no horizontal page scroll; tables scroll inside their panel.

## Review Focus

1. **Nifty card on a day with no live quote** (weekend, after close, quotes API down) — must show the last stored close and its day %, never blank or 0.00. Pinned in Task 4.
2. **Nifty history shorter than 252 sessions or with null closes** (imported-only rows have `close` null) — 52-week high/low and EMAs must skip null-close rows and show "—" when absent. Pinned in Task 4.
3. **Chart range longer than available data** (ALL / 1Y on a short series) — return all bars, never an empty chart; fewer than 2 bars shows the "Not enough price history to chart" message. Pinned in Task 5.
4. **Market phase at the boundaries** (09:00, 09:15, 15:30, 15:31 IST, weekends) — wrong phase mislabels live data. Pinned in Task 3.
5. **Existing features lost in the move** — watchlist add/remove/level edits and the Claude card must still work on their new tabs. Pinned by Task 6's manual checks and the unchanged existing tests.

---

## File Structure

```
src/app/globals.css                         dark tokens, fonts, scrollbar
src/app/layout.tsx                          fonts wired, dark body
src/app/(app)/layout.tsx                    server: shell data → TopBar + StatusStrip + QuotesProvider
src/app/(app)/page.tsx                      Dashboard (moved from src/app/page.tsx and rewritten)
src/app/(app)/watchlist/page.tsx            existing AddStock + WatchlistTable
src/app/(app)/sectors/page.tsx              existing SectorHeatmap
src/app/(app)/market/page.tsx               existing ClaudeCard
src/app/(app)/portfolio/page.tsx            "Coming soon"
src/app/(app)/alerts/page.tsx               "Coming soon"
src/app/components/ui.tsx                   Panel, Label, Chip, PctText primitives
src/app/components/shell/TopBar.tsx         wordmark, tabs (client, uses pathname), sign out
src/app/components/shell/StatusStrip.tsx    phase + IST clock + indices (client)
src/app/components/dashboard/NiftyCard.tsx  (client: live price overlay)
src/app/components/dashboard/SectorStrip.tsx
src/app/components/chart/PriceChart.tsx     lightweight-charts wrapper (client)
src/lib/view/shell.ts                       TABS, marketPhase
src/lib/view/nifty.ts                       buildNiftyCard
src/lib/view/chart.ts                       buildChartData, RANGES
supabase/migrations/0003_ema20.sql
src/lib/calc/indicators.ts, src/lib/db/{types,supabaseRepo,memoryRepo}.ts   (+ ema20)
tests/view/shell.test.ts | nifty.test.ts | chart.test.ts ; tests/calc/indicators.test.ts (+ema20)
```

---

### Task 1: Visual system and UI primitives

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/view/dashboard.ts` (`pctTone` only)
- Create: `src/app/components/ui.tsx`
- Test: `tests/view/dashboard.test.ts` (extend)

**Interfaces:**
- Produces: `pctTone(v: number | null): string` now returns `"text-[var(--up)]"`, `"text-[var(--down)]"` or `"text-[var(--muted)]"` (no `dark:` variants). In `ui.tsx`: `Panel({ title?, action?, children, className? })` (rounded-xl, `bg-[var(--panel)]`, 1px `--border`, p-5, optional header row with mono uppercase title and right-side action); `Label({ children })` (10px mono uppercase, tracking-wider, `--muted`); `Chip({ tone: "up" | "down" | "warn" | "neutral", children })` (mono 11px, tinted bg at 15% of tone colour, 1px border at 40%); `PctText({ value: number | null, className? })` (uses `fmtPct` + `pctTone`, mono tabular).

- [ ] **Step 1: Write the failing test** — `pctTone(0.01)` contains `var(--up)`, `pctTone(-0.01)` contains `var(--down)`, `pctTone(0)` and `pctTone(null)` contain `var(--muted)`, and none contain `"dark:"`.
- [ ] **Step 2: Run** `npm test -- tests/view/dashboard.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** `layout.tsx`: replace Geist with `Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400","500","600","700","800"], variable: "--font-jakarta" })` and `JetBrains_Mono({ subsets: ["latin"], weight: ["400","500","600","700"], variable: "--font-jbmono" })`; title "Nifty Pulse"; keep `suppressHydrationWarning`. `globals.css`: the palette tokens from Global Constraints on `:root` with `color-scheme: dark`; `@theme inline` maps `--font-sans`/`--font-mono` to the two font variables and exposes the palette as `--color-*`; body uses `--bg`, `--text`, `--font-sans`, `letter-spacing: -0.011em`; thin scrollbar (6px, thumb `rgba(148,163,184,.2)`). Delete the light/dark media block. Build `ui.tsx`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS (all existing 134 + new).
- [ ] **Step 5: Commit** `feat(ui): dark terminal visual system and primitives`

---

### Task 2: EMA 20 in the indicator pipeline

**Files:**
- Create: `supabase/migrations/0003_ema20.sql`
- Modify: `src/lib/db/types.ts`, `src/lib/calc/indicators.ts`, `src/lib/db/supabaseRepo.ts`, `src/lib/db/memoryRepo.ts`
- Test: `tests/calc/indicators.test.ts`, `tests/db/memoryRepo.test.ts` (extend)

**Interfaces:**
- Produces: `StoredDay.ema20: number | null` and `IndicatorRow.ema20: number | null`; `computeIndicators` fills it with `emaSeries(closes, 20)`; repos read/write `ema20` ↔ column `ema20` wherever `ema50` is handled.
- Migration: `alter table daily_prices add column if not exists ema20 numeric;`

- [ ] **Step 1: Write failing tests** — indicators on the existing 250-close fixture: `ema20` null at index 18, equals SMA of first 20 closes at index 19, non-null at 249. Memory repo: `upsertIndicators` with `ema20: 5` then `getDays` returns `ema20 === 5`, and `upsertCandles` afterwards leaves it intact.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** Add `ema20` to every place `ema50` appears in the four files (types, compute, column mapping, memory store). **Step 4: Run** `npm test`, `npm run typecheck` — PASS.
- [ ] **Step 5: Apply migration** to project Tracker1 (Supabase MCP `apply_migration` or SQL Editor). Verify: `select column_name from information_schema.columns where table_name='daily_prices' and column_name='ema20'` returns one row.
- [ ] **Step 6: Re-run back-fill** `npm run backfill -- --from 2015-01-01` (recomputes indicators over full history for indices and sectors). Verify: `select date, close, ema20 from daily_prices d join instruments i on i.id=d.instrument_id where i.key='NIFTY50' order by date desc limit 3` — `ema20` non-null and within ±5% of close. (Watchlist stocks get full-history EMA 20 in stage 2's Nifty 200 back-fill; the EOD job fills their latest 10 rows meanwhile.)
- [ ] **Step 7: Commit** `feat(calc): store EMA 20`

---

### Task 3: Shell — tabs, top bar, status strip, route group

**Files:**
- Create: `src/lib/view/shell.ts`, `src/app/(app)/layout.tsx`, `src/app/components/shell/TopBar.tsx`, `src/app/components/shell/StatusStrip.tsx`, `src/app/(app)/portfolio/page.tsx`, `src/app/(app)/alerts/page.tsx`
- Move: `src/app/page.tsx` → `src/app/(app)/page.tsx` (temporarily unchanged content minus header and strip, which move to the layout; rewritten in Task 6)
- Test: `tests/view/shell.test.ts`

**Interfaces:**
- Produces in `shell.ts`:
  - `TABS: { href: string; label: string }[]` = `/` Dashboard, `/portfolio` Portfolio, `/watchlist` Watchlist, `/sectors` Sector Analysis, `/market` Market, `/alerts` Alerts (this order).
  - `activeTab(pathname: string): string` — `"/"` only for exactly `/`; otherwise the tab whose href is a prefix of the path; unknown → `"/"`.
  - `type MarketPhase = "PRE-OPEN" | "OPEN" | "CLOSED"`; `marketPhase(now: Date): MarketPhase` — Mon–Fri IST: 09:00 ≤ t < 09:15 PRE-OPEN; 09:15 ≤ t ≤ 15:30 OPEN (same rule as `isMarketOpen`); else CLOSED; Sat/Sun CLOSED.
  - `istClock(now: Date): string` — `"HH:MM IST"`.
- `(app)/layout.tsx` (server, `dynamic = "force-dynamic"`): loads the three `STRIP_KEYS` instruments' last 10 days, last EOD run and Nifty days for `buildAsOf`, then renders `<TopBar/>`, `<QuotesProvider initialOpen>`, `<StatusStrip items asOf initialNow/>`, `{children}` inside `max-w-[1560px] mx-auto px-4 sm:px-6 py-6`.
- TopBar (client): sticky, `--panel` background, h-14, wordmark `NIFTY` + accent `PULSE` with mono sub-label `NSE TERMINAL`; tabs as `next/link` (active: `bg-slate-800 text-[var(--up)] border`); sign-out form (existing `signOut` action) at right. Under 1024 px the tabs render as a horizontally scrolling row below the bar.
- StatusStrip (client): phase chip (OPEN up / PRE-OPEN warn / CLOSED neutral) + `istClock` updated every 30 s; Nifty, Bank Nifty, VIX price and day % (live quote overlay from `useQuotes`, else stored); `AsOfBadge` restyled with Chip (`warn` when stale).
- Portfolio/Alerts pages: one `Panel` with "Coming soon".

- [ ] **Step 1: Write failing tests**

```ts
import { activeTab, marketPhase, istClock, TABS } from "@/lib/view/shell";
test("tabs order", () => expect(TABS.map((t) => t.label)).toEqual(["Dashboard","Portfolio","Watchlist","Sector Analysis","Market","Alerts"]));
test("activeTab", () => {
  expect(activeTab("/")).toBe("/");
  expect(activeTab("/sectors")).toBe("/sectors");
  expect(activeTab("/sectors/x")).toBe("/sectors");
  expect(activeTab("/nope")).toBe("/");
});
test("marketPhase boundaries (Fri 16 Oct 2026)", () => {
  expect(marketPhase(new Date("2026-10-16T03:29:00Z"))).toBe("CLOSED");   // 08:59
  expect(marketPhase(new Date("2026-10-16T03:30:00Z"))).toBe("PRE-OPEN"); // 09:00
  expect(marketPhase(new Date("2026-10-16T03:45:00Z"))).toBe("OPEN");     // 09:15
  expect(marketPhase(new Date("2026-10-16T10:00:00Z"))).toBe("OPEN");     // 15:30
  expect(marketPhase(new Date("2026-10-16T10:01:00Z"))).toBe("CLOSED");   // 15:31
  expect(marketPhase(new Date("2026-10-17T04:30:00Z"))).toBe("CLOSED");   // Saturday
});
test("istClock", () => expect(istClock(new Date("2026-10-16T09:35:00Z"))).toBe("15:05 IST"));
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** shell.ts, then layout, TopBar, StatusStrip, placeholder pages, and move `page.tsx` (drop its own header/LiveStrip/QuotesProvider, which the layout now provides; delete `LiveStrip.tsx` once nothing imports it).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` — PASS. `npm run dev`: signed in, all six tabs navigate, active tab highlighted, strip shows phase and three indices.
- [ ] **Step 5: Commit** `feat(ui): six-tab shell with market status strip`

---

### Task 4: Nifty card view model and component

**Files:**
- Create: `src/lib/view/nifty.ts`, `src/app/components/dashboard/NiftyCard.tsx`
- Test: `tests/view/nifty.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type EmaState = { value: number | null; above: boolean | null };
  type NiftyTrend = "above_all" | "mixed" | "below_all" | null;
  interface NiftyCardData {
    cmp: number | null; change: number | null; changePct: number | null; prevClose: number | null;
    dayHigh: number | null; dayLow: number | null; high52: number | null; low52: number | null;
    ema20: EmaState; ema50: EmaState; ema200: EmaState; trend: NiftyTrend; asOf: string | null;
  }
  function buildNiftyCard(days: StoredDay[], live?: { price: number; changePct: number } | null): NiftyCardData
  ```
  Rules: priced = rows with non-null close, ascending. Without `live`: `cmp` = last priced close; `prevClose` = previous priced close; `changePct` = last row's `pctChange ?? importedPct` (consistent with `buildTodaySummary`); `change` = `cmp - prevClose`. With `live`: `cmp = live.price`, `changePct = live.changePct`, `prevClose = live.price / (1 + live.changePct)`, `change = cmp - prevClose`. `dayHigh/dayLow` from the last priced row (`null` when live, since intraday high/low is not stored). `high52/low52` = max high / min low over the last 252 priced rows (null when fewer than 1 priced row; uses `close` where high/low are null). `above` = `cmp >= ema` (null when either is null). `trend`: all three `above` true → `above_all`; all false → `below_all`; any null → null; else `mixed`. EMAs from the last priced row.
- NiftyCard (client; props: `days`, uses `useQuotes()` for the `^NSEI` quote): left — mono label `BENCHMARK INDEX · NSE: ^NSEI`, price `text-4xl font-extrabold` mono, change with arrow and `(±x.xx%)`, row of prev close / day high (up colour) / day low (down colour) / 52W high / 52W low. Right — header `AUTOMATED EMA ANALYSIS` with trend Chip (above_all up, mixed warn, below_all down); three EMA cards (EMA 20 / 50 / 200 label + Above/Below, value) tinted up/down; on phones the right side stacks below.

- [ ] **Step 1: Write failing tests**
  - Stored only: last two priced closes 100 → 101 with `pctChange 0.01` → `cmp 101`, `prevClose 100`, `change 1`, `changePct 0.01`.
  - Last row imported-only (`close null`, `importedPct 0.02`) after a priced row of 100 → `cmp 100` (last priced), `changePct 0.02`.
  - Live `{ price: 110, changePct: 0.1 }` → `prevClose 100`, `change 10`, `dayHigh null`.
  - 300 rows (0-based i: high = i + 1, low = i + 0.5) → `high52` 300, `low52` 48.5 (only the last 252 rows, i = 48..299).
  - EMA states: ema20 105, ema50 95, ema200 90, cmp 100 → `[false, true, true]`, trend `mixed`; all below → `below_all`; ema200 null → trend null.
  - Empty input → every number null, trend null.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** builder, then component using `Panel`, `Label`, `Chip`, `PctText`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(dashboard): Nifty card with EMA 20/50/200 analysis`

---

### Task 5: Interactive price chart

**Files:**
- Create: `src/lib/view/chart.ts`, `src/app/components/chart/PriceChart.tsx`
- Test: `tests/view/chart.test.ts`

**Interfaces:**
- `npm i lightweight-charts@^5` (v5 API: `createChart`, `chart.addSeries(CandlestickSeries | LineSeries | HistogramSeries, options, paneIndex)`).
- Produces in `chart.ts`:
  ```ts
  type ChartRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";
  const RANGE_BARS: Record<ChartRange, number | null> = { "1D": 5, "1W": 10, "1M": 21, "3M": 63, "6M": 126, "1Y": 252, ALL: null };
  interface ChartData {
    candles: { time: string; open: number; high: number; low: number; close: number }[];
    volume: { time: string; value: number; up: boolean }[];
    volSma20: { time: string; value: number }[];
    ema20: { time: string; value: number }[]; ema50: …; ema200: …; rsi: { time: string; value: number }[];
  }
  function buildChartData(days: StoredDay[], range: ChartRange): ChartData
  ```
  Rules: use rows with non-null open/high/low/close, ascending; take the last `RANGE_BARS[range]` (all when null or when fewer exist). Line series include only points whose value is non-null. `volume.up` = close ≥ open. `volSma20` = SMA of the 20 volumes ending at and including the current bar (display overlay; distinct from stage 2's stored `vol_avg20`, which excludes today), starting at the 20th bar of the full priced series and computed before slicing so the first visible point is correct.
- PriceChart (client; props: `days: StoredDay[]`, `title: string`, `height?: number` default 420):
  - Toolbar: title + last close chip; range buttons (default `6M`); overlay toggles EMA 20 / EMA 50 / EMA 200 (chips in the EMA colours, all on by default); lower-pane toggle VOLUME / RSI.
  - OHLC strip above the chart: Date, O, H, L, C (coloured), Vol, EMA20, EMA50, EMA200 values for the crosshair bar (latest bar when no crosshair).
  - Chart options: background `--panel-2`, grid lines `rgba(148,163,184,.08)`, text `--muted`, mono font, right price scale, candles up `--up` / down `--down`, wick same. Lower pane index 1 at ~25% height: volume histogram coloured by `up` with `volSma20` line, or RSI line with 70/30 dashed guides.
  - Recreate series data when range or toggles change; dispose the chart on unmount; resize with `ResizeObserver`.
  - Fewer than 2 candles: render a Panel with "Not enough price history to chart" instead of a chart.

- [ ] **Step 1: Write failing tests**
  - 300 priced rows: `buildChartData(days, "6M").candles.length === 126`; `"ALL"` → 300; `"1D"` → 5.
  - 30 rows with `"1Y"` → 30 (range longer than data).
  - A row with `close null` (imported-only) is excluded.
  - `ema200` series omits null values; `ema20` length equals non-null count within the range.
  - `volSma20` on bar 19 (0-based) equals mean of volumes 0..19; on a `"1D"` slice of 300 rows its first point equals the mean of volumes 276..295.
  - `volume[i].up` true when close ≥ open.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** builder, then component.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` — PASS.
- [ ] **Step 5: Commit** `feat(chart): interactive candlestick chart with EMA overlays`

---

### Task 6: Dashboard page and moved tabs

**Files:**
- Rewrite: `src/app/(app)/page.tsx`
- Create: `src/app/components/dashboard/SectorStrip.tsx`, `src/app/(app)/watchlist/page.tsx`, `src/app/(app)/sectors/page.tsx`, `src/app/(app)/market/page.tsx`
- Restyle (dark tokens, mono numbers, `Panel`; no behaviour change): `WatchlistTable.tsx`, `AddStock.tsx`, `SectorHeatmap.tsx`, `ClaudeCard.tsx`, `TodaySummary.tsx` (delete if unused), `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `buildNiftyCard` (Task 4), `PriceChart` (Task 5), `buildSectorRows` (existing), `Panel`/`Chip`/`PctText` (Task 1).
- Dashboard data: Nifty days with limit 5000 (full history for the chart's ALL range), sector days (70) for the strip. Layout: `NiftyCard` → `PriceChart title="NIFTY 50"` → `SectorStrip`.
- SectorStrip: Panel titled `SECTORAL PULSE` with action link "All sectors →" to `/sectors`; grid `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` (11 tiles + nothing else; let the last row be partial); tile = sector name without the `Nifty ` prefix, day % with arrow, tinted up/down (emerald-950/30 or rose-950/30 with matching border), neutral when null; tile is a `next/link` to `/sectors?s=<KEY>`.
- Watchlist page: existing `AddStock` + `WatchlistTable` with the data loading moved from the old page (same `watchItems` construction).
- Sectors page: existing `SectorHeatmap` with the existing data loading.
- Market page: `ClaudeCard` for today's IST date.

- [ ] **Step 1: Implement** the pages and SectorStrip; restyle the listed components (replace neutral/`dark:` classes with tokens; table headers mono uppercase `--muted`; rows `hover:bg-slate-800/40`; inputs `bg-[var(--panel-2)] border-[var(--border)]`).
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — Expected: all PASS, existing tests unchanged.
- [ ] **Step 3: Verify manually** (`npm run dev`, signed in):
  - Dashboard: Nifty price and day % equal the latest stored Nifty row; EMA cards show values and Above/Below consistent with price; chart renders 6M by default, every range button changes the visible bars, EMA toggles hide/show lines, VOLUME/RSI switch works, crosshair updates the OHLC strip; 11 sector tiles link to `/sectors`.
  - Watchlist tab: add a stock, edit a level (M badge), clear it, remove the stock — all still work.
  - Market tab shows "Today by Claude" with "No summary for today".
  - Login page readable on the dark background.
  - Resize to 390 px: no horizontal page scroll; tabs scroll; EMA cards stack; chart fits width.
- [ ] **Step 4: Commit** `feat(dashboard): new dashboard; move watchlist, sectors, Claude card to tabs`

---

### Task 7: Owner check and docs

**Files:**
- Modify: `README.md` (new tabs, `lightweight-charts`, migration 0003 + back-fill note), `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md` is committed if not yet in git.

- [ ] **Step 1:** Update README; commit the redesign spec and this plan if untracked: `git add docs/superpowers && git commit -m "docs: redesign spec and stage 1 plan"`.
- [ ] **Step 2 (owner):** open `http://localhost:3000` signed in, check every tab at full width and at phone width, and confirm the look matches the reference before stage 2 is planned.
- [ ] **Step 3: Commit** `docs: stage 1 README updates`
