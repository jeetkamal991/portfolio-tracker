# Redesign Stage 4 — Sector Analysis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship redesign spec stage 4 (§4.6): the Sector Analysis tab with a tile grid of the 11 sectors (day %, score, RSI, colour by move), a hover preview of each sector's top 3 gainers and losers, a selected-sector detail panel (returns, trend, RS vs Nifty, "View chart", full constituent table), a rotation ranking with week-on-week rank change and an 8-week rank sparkline, and (owner request 2026-10-18) a **Daily Sector Log**: the owner's manual spreadsheet reproduced automatically, with month tabs for the last 6 months.

**Architecture:** One server loader (`loadSectorAnalysis`) reads, in a fixed small number of queries, each sector's last 70 days, every sector's constituents and all constituents' rows on the latest session. Pure builders turn that into tiles, constituent rows and rotation rows. The page is a server component; the grid is a client component for hover/focus previews; selection lives in `?s=KEY`. Rotation is computed on the fly from stored `rs_vs_nifty` at each week's last session, so no new job or table is needed.

**Tech Stack:** unchanged.

**Spec:** `docs/superpowers/specs/2026-10-17-nifty-dashboard-redesign-design.md` §4.6. Previous plans: stages 1–3 in `docs/superpowers/plans/`.

**Depends on:** stage 2 (`index_constituents`, scores, `StockLink`, `ScoreLabelChip`), stage 3 (`getDaysOn`, `Sparkline`, `emaTrend`). Constituent content needs the owner's niftyindices import; the 8 thin sectors need their history files for returns/trend/RS.

**Deviation from spec (deliberate):** spec §4.6 says rank change is "vs last week's Friday snapshot". This plan derives the same numbers from stored daily `rs_vs_nifty` at the **last session of each ISO week** (Friday, or the last trading day before a Friday holiday), so history is available immediately and nothing depends on a Friday job having run. `rotation_snapshots` stays unused.

## Global Constraints

- All earlier constraints hold (fractions, IST dates, dark tokens, mono numbers, no Claude API, Windows-compatible scripts).
- **Tile colour:** existing `heatColor(d1, "d1")` (saturates at 2%).
- **Day % precedence:** stored `pctChange` → `importedPct` (this page uses the last stored session; no live quotes).
- **Session date** for constituents = NIFTY50's latest priced date.
- **Week end:** for each ISO week (Monday-start, from the IST date string), the latest Nifty session date in that week. The "current" week end is the latest session even mid-week.
- **Rank:** among sectors with non-null `rsVsNifty` on that week-end date, descending RS → rank 1, 2, …; ties by sector key ascending; sectors with null RS get no rank that week.
- **Rank change** = previous week's rank − current rank (positive = moved up). Null when either rank is missing.
- **Query budget for the page:** at most 1 instruments query, 11 + 1 `getDays` calls (sectors + Nifty), 11 `listConstituents` calls (or one `listMemberships`), and 1 `getDaysOn` call. No per-stock queries.

## Review Focus

1. **Constituents not imported or a sector with no constituents** — tile still renders; preview and detail show "Constituents appear after the niftyindices import." Pinned in Task 1 and Task 4.
2. **Thin sector with 1–2 stored bars** — returns, trend and RS show "—"; it appears in rotation unranked ("—") at the bottom, never as rank 1. Pinned in Tasks 1 and 2.
3. **Holiday weeks and mid-week views** — a week whose Friday is a holiday uses Thursday's session; the current week uses the latest session. Pinned in Task 2.
4. **Constituent without a row on the session date** (suspended, newly added) — listed with "—" values at the bottom of the table, not dropped, not crashing sort. Pinned in Task 1.
5. **Unknown `?s=` value** — no sector selected and no error; the first tile is not auto-selected. Pinned in Task 4.

---

## File Structure

```
src/lib/view/sectors.ts            buildSectorTiles, buildConstituentRows
src/lib/calc/rotation.ts           weekEnds, buildRotation
src/lib/api/sectors.ts             loadSectorAnalysis (server loader)
src/app/(app)/sectors/page.tsx     rewritten
src/app/components/sectors/SectorGrid.tsx      (client: tiles + hover/focus preview)
src/app/components/sectors/SectorDetail.tsx
src/app/components/sectors/ConstituentTable.tsx
src/app/components/sectors/RotationPanel.tsx
src/lib/view/dailyLog.ts           buildDailyLog
src/app/components/sectors/DailyLog.tsx        (client: month tabs + heat table)
src/app/components/SectorHeatmap.tsx           (deleted when nothing imports it)
tests/view/sectors.test.ts, tests/calc/rotation.test.ts, tests/api/sectors.test.ts, tests/view/dailyLog.test.ts
```

---

### Task 1: Sector tiles and constituent rows

**Files:** Create `src/lib/view/sectors.ts`; Test `tests/view/sectors.test.ts`

**Interfaces:**
- Consumes: `buildSectorRows` / `SectorRow` (existing, gives d1/w1/m1/m3/trend), `emaTrend`, `StoredDay`, `ScoreLabel`.
- Produces:
  ```ts
  interface ConstituentRow {
    key: string; name: string; cmp: number | null; dayPct: number | null;
    score: number | null; scoreLabel: ScoreLabel | null; trend: EmaTrend | null; rsi: number | null;
  }
  interface SectorTile extends SectorRow {
    score: number | null; scoreLabel: ScoreLabel | null; rsi: number | null; rsVsNifty: number | null;
    constituentCount: number;
    topGainers: ConstituentRow[];   // up to 3, dayPct > 0, desc
    topLosers: ConstituentRow[];    // up to 3, dayPct < 0, asc
  }
  function buildConstituentRows(members: { key: string; name: string }[], dayOf: Map<string, StoredDay>): ConstituentRow[]
  function buildSectorTiles(rows: SectorRow[], latest: Map<string, StoredDay | null>, members: Map<string, ConstituentRow[]>): SectorTile[]
  ```
  `buildConstituentRows` sorts by `dayPct` desc, nulls last, ties by key; `cmp` = close; `trend` = `emaTrend(close, ema20, ema50, ema200)`. `buildSectorTiles` keeps `SECTOR_KEYS` order (from `rows`), takes score/RSI/RS from each sector's latest priced day, and derives gainers/losers from its members.

- [ ] **Step 1: Write failing tests**
  - Members A(+2%), B(+1%), C(0), D(−1%), E(no row) → rows ordered A, B, C, D, E; E has all-null values.
  - Tile with those members → `topGainers` keys `[A, B]`, `topLosers` keys `[D]`, `constituentCount 5`.
  - Sector whose latest day has `score 64`, `scoreLabel "Bullish"`, `rsi14 58.2`, `rsVsNifty 0.012` → copied onto the tile.
  - Sector with no members → empty gainers/losers, count 0; sector with no latest day → score/rsi/rs null.
  - Tile order equals the input `rows` order.
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(view): sector tiles and constituent rows`

---

### Task 2: Rotation ranking

**Files:** Create `src/lib/calc/rotation.ts`; Test `tests/calc/rotation.test.ts`

**Interfaces (Produces):**
```ts
function weekEnds(sessionDates: string[], weeks: number): string[]   // ascending, last `weeks` week-end dates
interface RotationRow { key: string; name: string; rs: number | null; rank: number | null; change: number | null; history: (number | null)[] } // history = ranks at each week end, oldest → newest
function buildRotation(sectors: { key: string; name: string; days: StoredDay[] }[], sessionDates: string[], weeks = 8): RotationRow[]
```
Rules per Global Constraints. `buildRotation` evaluates `weeks + 1` week ends (the extra one gives the current row's `change`), returns `history` for the last `weeks`, `rs` and `rank` at the latest week end, and orders rows by rank ascending with unranked rows last (by key).

- [ ] **Step 1: Write failing tests**
  - `weekEnds` on sessions Mon 2026-09-28 … Fri 2026-10-16 (weekdays, minus holiday Fri 2026-10-02) with `weeks = 3` → `["2026-10-01", "2026-10-09", "2026-10-16"]`.
  - Mid-week: sessions ending Wed 2026-10-14 → last week end `"2026-10-14"`.
  - Three sectors with RS on the last two week ends: this week `{IT: 0.03, BANK: 0.01, AUTO: −0.02}`, last week `{IT: 0.00, BANK: 0.02, AUTO: −0.01}` → ranks IT 1, BANK 2, AUTO 3; changes IT +1, BANK −1, AUTO 0; order IT, BANK, AUTO.
  - Tie on RS → lower key gets the better rank.
  - A thin sector with no RS → `rank null`, `change null`, listed last; `history` entries null for weeks it had no RS.
  - `history.length === 8` when 9+ week ends exist; shorter when fewer.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(calc): sector rotation ranking from weekly RS`

---

### Task 3: Sector Analysis loader

**Files:** Create `src/lib/api/sectors.ts`; Test `tests/api/sectors.test.ts`

**Interfaces:**
- Consumes: Repo (`listInstruments`, `getDays`, `listMemberships` or `listConstituents`, `getDaysOn`), `buildSectorRows`, Task 1 and Task 2 builders.
- Produces:
  ```ts
  interface SectorAnalysis {
    sessionDate: string | null;
    tiles: SectorTile[];
    constituents: Record<string, ConstituentRow[]>;  // by sector key
    rotation: RotationRow[];
    hasConstituents: boolean;                         // any sector has members
  }
  function loadSectorAnalysis(repo: Repo): Promise<SectorAnalysis>
  ```
  Steps: sector and NIFTY50 instruments; `getDays(id, 70)` for each sector and Nifty in parallel; memberships for the 11 sector keys; one `getDaysOn(allMemberIds, sessionDate)`; build tiles, constituent rows, rotation (`sessionDates` = Nifty priced dates).

- [ ] **Step 1: Write failing tests** (memory repo with NIFTY50, 2 sectors, 4 stocks, memberships): result has 2 tiles in `SECTOR_KEYS` order, constituents keyed by sector, `hasConstituents true`; with no memberships → `hasConstituents false`, empty constituent lists; `getDaysOn` called exactly once (spy).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(api): sector analysis loader`

---

### Task 4: Sector Analysis UI

**Files:** Create `src/app/components/sectors/{SectorGrid,SectorDetail,ConstituentTable,RotationPanel}.tsx`; Rewrite `src/app/(app)/sectors/page.tsx`; Delete `src/app/components/SectorHeatmap.tsx` (and its `heatColor`-only imports stay in `dashboard.ts`)

**Interfaces:**
- Page (server): `loadSectorAnalysis(getRepo())`; `selected = tiles.find(t => t.key === s) ?? null`. Layout top to bottom: header row (`SECTOR ANALYSIS` + `as of DD Mon YYYY`), `SectorGrid`, `SectorDetail` (only when selected; otherwise a one-line hint "Select a sector to see its stocks"), `RotationPanel`.
- SectorGrid (client): grid `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6`; each tile is a `next/link` to `/sectors?s=KEY` with `scroll={false}`; background `heatColor(d1, "d1")`; content: sector name without `Nifty `, day % large with arrow, `ScoreLabelChip` with score, `RSI 58.2` in mono `--muted`; selected tile has a 1px `--up` ring. Hover or keyboard focus (desktop, `@media (hover: hover)`) shows a floating preview card anchored below the tile: `TOP GAINERS` (3 rows: name, day %) and `TOP LOSERS` (3 rows); empty member list → the import message; preview hides on mouse leave / blur; touch devices skip the preview (tap selects).
- SectorDetail: Panel titled with the sector name and a `View chart` button (`StockLink` to the sector key, opens the pop-up). Stats row: 1D / 1W / 1M / 3M returns (`PctText`), trend vs EMA 50/200 (existing `SectorRow.trend` label), RS vs Nifty 4W (`PctText`), score chip. Then `ConstituentTable`.
- ConstituentTable: columns Stock (`StockLink`, key in mono below), CMP, Day %, Score (`ScoreLabelChip` + number), Trend (Chip as in the watchlist), RSI (warn colour > 70 / < 30). Already sorted by day % desc; rows with no data show "—". Wrapper `overflow-x-auto`. Empty → the import message.
- RotationPanel: Panel `SECTOR ROTATION · RS vs NIFTY (4W)`; rows: rank (`#1`), sector name (link to `/sectors?s=KEY`), RS (`PctText`), change (`▲2` up colour / `▼1` down colour / `–` muted / "new" when previous null), 8-week rank sparkline (reuse `Sparkline` with values `-rank` so rank 1 plots highest; nulls dropped; fewer than 2 points → "—").

- [ ] **Step 1: Implement** the page and components; remove `SectorHeatmap` once unused.
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS.
- [ ] **Step 3: Verify manually** (`npm run dev`, signed in):
  - 11 tiles with day %, score and RSI; colours match direction and size of move.
  - Hovering a tile shows its top 3 gainers/losers; keyboard Tab focus shows the same; leaving hides it.
  - Clicking a tile selects it (URL `?s=KEY`, page does not jump to top), detail panel shows returns, trend, RS, score and the constituent table sorted by day %; a stock row opens the pop-up; `View chart` opens the sector pop-up.
  - Dashboard sector strip tiles land on the right selection.
  - Rotation list ranks sectors with rank change arrows and sparklines; thin sectors without RS sit at the bottom with "—".
  - `?s=NOPE` → no selection, hint shown.
  - Before constituents are imported: tiles render, preview/detail show the import message.
  - 390 px: two tiles per row, tables scroll inside their panels, no page scroll.
- [ ] **Step 4: Commit** `feat(ui): Sector Analysis with constituents and rotation`

---

### Task 5: Daily Sector Log (owner's spreadsheet, automated)

Reproduces the owner's manual sheet (`data/history.xlsx` layout): one tab per month, a Total row, one row per trading day, a column per index, green/red heat cells.

**Files:** Create `src/lib/view/dailyLog.ts`, `src/app/components/sectors/DailyLog.tsx`; Modify `src/lib/api/sectors.ts` (load 140 days instead of 70 for Nifty and sectors, add `dailyLog` to `SectorAnalysis`), `src/app/(app)/sectors/page.tsx`; Test `tests/view/dailyLog.test.ts`, extend `tests/api/sectors.test.ts`

**Interfaces (Produces):**
```ts
const LOG_COLUMNS: { key: string; label: string }[] = [
  { key: "NIFTY50", label: "NIFTY" }, { key: "NIFTY_AUTO", label: "AUTO" }, { key: "NIFTY_BANK", label: "BANK" },
  { key: "NIFTY_FIN", label: "Financial" }, { key: "NIFTY_FMCG", label: "FMCG" }, { key: "NIFTY_IT", label: "IT" },
  { key: "NIFTY_MEDIA", label: "MEDIA" }, { key: "NIFTY_METAL", label: "METAL" }, { key: "NIFTY_PHARMA", label: "PHARMA" },
  { key: "NIFTY_PSU_BANK", label: "PSU BANK" }, { key: "NIFTY_PVT_BANK", label: "PVT BANK" }, { key: "NIFTY_HEALTHCARE", label: "HEALTHCARE" },
];
interface LogMonth {
  id: string;                    // "2026-10"
  label: string;                 // "OCT"  (add the year, e.g. "DEC 2025", only when the 6 months span two years)
  rows: { date: string; values: Record<string, number | null> }[];   // ascending by date
  totals: Record<string, { sum: number | null; compound: number | null }>;
}
function buildDailyLog(series: Record<string, StoredDay[]>, sessionDates: string[], now: Date, months = 6): LogMonth[]
function logCellColor(value: number | null, kind: "day" | "total"): string
```
Rules:
- Months: the current IST month and the 5 before it, **newest first**. A month with no sessions yet still appears with no rows.
- Rows: every Nifty session date (`sessionDates`) in that month, ascending. Cell value = that key's stored `pctChange ?? importedPct` on that date, else null.
- `sum` = sum of non-null values in the column for the month (matches the owner's sheet Total); `compound` = ∏(1 + v) − 1 over the same values; both null when the column has no values.
- `logCellColor`: null → transparent; otherwise green (`rgba(52,211,153,a)`) for ≥ 0 and red (`rgba(251,113,133,a)`) for < 0 with `a = 0.08 + 0.62 × min(|v| / S, 1)`, S = 0.03 for `day`, 0.10 for `total`.

- [ ] **Step 1: Write failing tests**
  - `now` = 2026-10-18 → month ids `["2026-10","2026-09","2026-08","2026-07","2026-06","2026-05"]`, labels `OCT … MAY`; `now` = 2026-02-10 → labels include the year (`FEB 2026`, `JAN 2026`, `DEC 2025`, …).
  - OCT rows follow `sessionDates` in October ascending; a sector with no row on a date → null; imported-only row (`pctChange null`, `importedPct 0.0123`) → 0.0123.
  - Totals on values `[0.01, −0.02, 0.005]` → `sum −0.005`, `compound` = 1.01 × 0.98 × 1.005 − 1 (≈ −0.005249); an all-null column → both null.
  - Fixture with Nifty October values `[−0.0088, 0.0060, 0.0098, −0.0076, −0.0164, 0.0130, −0.0070, 0.0160, −0.0044, 0.0166, 0.0065]` → `sum` 0.0237 (the owner's OCT sheet Total, 2.37%).
  - `logCellColor(0.03, "day")` equals `logCellColor(0.05, "day")` (saturated); `logCellColor(null, "day")` is transparent; negative values are red.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** the builder; extend the loader (140 days, `dailyLog: buildDailyLog(series, niftyPricedDates, new Date())`); then the component.
- [ ] **Step 4: DailyLog component** (client), placed on the Sectors page below the rotation panel, Panel titled `DAILY SECTOR LOG`:
  - Month tabs along the bottom edge of the panel styled like spreadsheet sheet tabs (active tab `--up` text with a top border), newest first; selected month kept in `?m=2026-10` (default current month; unknown value → current).
  - Table: sticky first column `Date` (formatted `16 Oct`), 12 value columns in `LOG_COLUMNS` order; header row mono uppercase; first body row `Total` (bold, sum shown; hover title `Compounded: +2.33%`), then one row per session. Cells: mono tabular `±0.00%`, background `logCellColor`, "—" for null. Wrapper `overflow-x-auto`; on phones the Date column stays pinned.
  - A month with no rows → "No trading days recorded for this month yet."
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` — PASS.
- [ ] **Step 6: Verify manually:** OCT tab matches the owner's sheet day by day for the imported dates (e.g. 08 Oct NIFTY −1.64%, METAL −3.55%) and its Total row shows NIFTY +2.37%; SEP and AUG match their sheet tabs (note the three days the manual log lacked — 28 Aug, 21 Sep, 22 Sep — now appear filled from Yahoo, so those months' Totals can differ slightly from the sheet); older months fill from Yahoo / niftyindices history (thin sectors show "—" until their history files are imported); tabs switch without a page jump; 390 px scrolls inside the panel.
- [ ] **Step 7: Commit** `feat(ui): daily sector log with month tabs`

---

### Task 6: Docs and owner check

- [ ] **Step 1:** README: Sector Analysis features, the rotation rule (week-end sessions from stored RS), the Daily Sector Log, and that thin sectors need the niftyindices history files. Commit `docs: stage 4`.
- [ ] **Step 2 (owner):** check the Sector Analysis tab at full width and phone width before stage 5 (Portfolio) is planned.
