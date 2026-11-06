# Market Structure Engine, Stage 1 (design)

Date: 2026-11-06. Branch: `feature/structure-engine`. Stages 2 (relative strength + base detection) and 3 (Structure Score + backtest) come later and reuse this module.

## Goal

A price-action module that reads stored daily candles and says, per instrument and per timeframe (daily, weekly): which way the trend is, when it last broke or changed character, and where the nearest support and resistance sit. Stage 1 computes it, stores it nightly (plus a full-history backfill for Stage 3) and shows it in the stock pop-up. No alerts, screener or score yet.

## Hard rules (from the owner)

- The existing indicator engine (EMA, RSI, MACD, Bollinger, volume average, Technical Score, alerts) is untouched in behaviour. Structure is a separate module.
- No new libraries. Pure, tested functions.
- **No lookahead.** A swing counts only once N bars after it have closed.
- Breaks are decided on **closes**, not wicks.
- **Manual watchlist levels always win** over computed ones.
- Migration first, RLS on, no policies. The owner applies it before the code deploys.
- No push, no deploy, no git-config change. Local commits on `feature/structure-engine`.

## Findings that shaped the design

| Fact in the code | Consequence |
| --- | --- |
| `0015` is taken; migrations run to `0019`; an unapplied `0016_drop_holdings_target2.sql` exists | New migration is **`0020_structure.sql`** |
| `src/lib/calc/swing.ts` is used by the Portfolio form (`handleHoldingPrefill`) and by EOD (`setAutoLevels`, stocks only). It looks at the last 60 bars, treats a flat plateau as no pivot, merges within 1% | Pivot test moves into the structure module; `swing.ts` calls it. Its output stays identical (existing tests plus new equivalence tests) |
| `weekEnds()` in `src/lib/calc/rotation.ts` is exported and returns the latest session of each ISO week | Weekly bars reuse it (`weekEnds(dates, Infinity)`); `rotation.ts` is not changed |
| EOD already loads every instrument's full stored history in `recomputeFromBars` | Structure hooks in there with an **optional callback**; no extra reads |
| Hobby plan: two crons, both used | No separate cron. Structure runs as a guarded step inside EOD |
| Production DB is 165 MB; `daily_prices` is 431k rows | Storage design below keeps structure to about 90 MB |

## Decisions (confirmed by the owner on 2026-11-06)

1. Chart work is committed first on the branch; structure work follows in separate commits.
2. History: **daily rows for every session; weekly rows at week-end sessions** (and on the latest session).
3. Structure S/R is shown **only in the pop-up**. The Watchlist and Portfolio auto levels (`swing.ts`) are unchanged.
4. Structure runs **inside EOD** as a guarded step, after the owner times EOD (see Timing). If EOD would pass about 4 minutes, split it out first.

## Module layout: `src/lib/calc/structure/`

All pure; each file has its constants at the top.

| File | Purpose |
| --- | --- |
| `pivots.ts` | `findPivots(bars, side)` returns confirmed swing highs and lows. `SWING_SIDE_DAILY = 5`, `SWING_SIDE_WEEKLY = 3`. A pivot at index `i` is confirmed at index `i + side`. Tie rule is the current `swing.ts` rule: highest-or-equal of the `side` bars each way, and not a flat plateau |
| `weekly.ts` | `weeklyBars(daily)`: groups by `weekEnds(dates, Infinity)`; open = first session's open, high/low = extremes, close = last close, date = the week-end session. The newest bar can be partial |
| `engine.ts` | `structureSeries(bars, params)`: one forward pass producing a point per bar: trend, last two swing highs and lows, latest BOS/CHoCH event, levels. Params carry `side`, `mergeTol`, `levelBars`, so Stage 3 can run 3/5/8 |
| `levels.ts` | `structureLevels(pivots, close, params)`: clusters swing highs **and** lows within `LEVEL_MERGE_TOL = 0.015`, strength = number of touches, nearest support below and resistance above the close, distance %, plus the all-time high of the stored history |
| `index.ts` | `structureForInstrument(dailyBars)`: latest D and W rows; `structureHistory(dailyBars, fromDate)`: all D rows and W rows at week ends, for the backfill |

`swing.ts` change: `swingLevelList` calls `findPivots` and the shared `clusterLevels` (exported, returns price and touch count). `lookback = 60` and `mergeTol = 1%` stay in `swing.ts`.

### Rules

- **Trend**, from the last two confirmed swing highs (H1, H2) and lows (L1, L2): UP if H2 > H1 and L2 > L1; DOWN if both lower; RANGE otherwise. With fewer than two confirmed highs or lows the trend is `null` (no state), not RANGE.
- **Events**, evaluated at each bar on its close, using the trend and pivots confirmed up to and including that bar:
  - UP and close > last swing high: bullish BOS.
  - DOWN and close < last swing low: bearish BOS.
  - UP and close < last (higher) low: bearish CHoCH.
  - DOWN and close > last (lower) high: bullish CHoCH.
  - A given broken pivot fires once. The latest event (type, direction, date, broken level) stays until a newer one fires.
- **Levels**: pivots confirmed within the last `LEVEL_BARS_DAILY = 250` daily or `LEVEL_BARS_WEEKLY = 130` weekly bars. All-time high = highest stored high (stored history starts 2015 for indices and 2019 for most stocks, so it is "highest in stored data").
- **Weekly alignment**: the weekly point for week-end bar `k` uses only bars up to `k`. The partial current week can trigger an event (its close is known) but can never be a pivot.

## Storage: `supabase/migrations/0020_structure.sql`

Table `structure_daily` (name per the owner), primary key `(instrument_id, session_date, timeframe)`:

`instrument_id` (FK, cascade), `session_date`, `timeframe` ('D'/'W'), `swing_n` (the N used), `trend` ('UP'/'DOWN'/'RANGE', null allowed), `last_swing_high`, `last_swing_high_date`, `last_swing_low`, `last_swing_low_date`, `event_type` ('BOS'/'CHOCH'), `event_direction` ('bullish'/'bearish'), `event_date`, `event_level`, `support`, `support_strength`, `resistance`, `resistance_strength`, `ath`, `computed_at`. Index on `(session_date, timeframe)` for Stage 3. RLS enabled, no policies. Distance % is computed at read time from the close, not stored.

Size estimate: about 430k daily rows plus about 86k weekly rows at roughly 170 bytes, so about 90 MB on a 165 MB database.

Repo (`repo.ts`, `supabaseRepo.ts`, `memoryRepo.ts`): `upsertStructure(rows)` (chunked) and `getLatestStructure(instrumentId)` returning the newest D and W rows.

## Writing

- **EOD**: `recomputeFromBars` gains an optional `onBars(inst, stored)` callback (additive; indicator behaviour unchanged). EOD uses it to compute the latest D and W rows per instrument from the bars already in memory, collects them, and writes one batched upsert at the end. Scope: indices and sectors (not INDIAVIX, which is a volatility gauge) plus the stock universe (Nifty 200, sector constituents, watchlist, holdings). A structure failure never undoes ingest or scores; it downgrades the run to `partial` and is named in the run message (`structure N, structure failed N`).
- **Backfill**: `npm run backfill-structure -- --from 2019-01-01 [--key KEY]` loads each instrument's full history, computes with warm-up before `--from`, and upserts the D rows for every session and the W rows at week ends. Idempotent.

## Pop-up

`handleInstrumentGet` reads `getLatestStructure(inst.id)` in its existing parallel group. `buildPopupData` adds a `structure` block. `IndicatorTab` gets a "Structure" section under the indicator table, same row style:

- Daily trend and weekly trend.
- Latest BOS or CHoCH per timeframe: "Bullish BOS · 3 Nov · 24,350".
- Nearest support and resistance (daily) with distance % from the latest close and touch count, plus the all-time high. If a **manual** level exists for that instrument it is shown instead, marked M.
- "Appears after the nightly run" when nothing is stored yet.

## Timing (before the EOD step is switched on)

The README's EOD run has not been timed over the full universe. The owner times it first (PowerShell):

```powershell
Measure-Command { curl.exe -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/eod }
```

The structure step adds CPU in the milliseconds per instrument plus one batched upsert of about 500 rows, so it should add seconds. If the measured EOD run is already over about 4 minutes, the two-part EOD split comes first (Task 8 of `docs/superpowers/plans/2026-10-18-redesign-stage2-score-universe-popup.md`), or structure moves to its own route kicked from the delivery cron like the snapshots.

## Reuse by Stages 2 and 3

`structureSeries` returns a point per bar, so Stage 3 can join a structure state to any past session without lookahead and run N = 3/5/8 in memory. `weeklyBars` and `findPivots` are the base for relative-strength pivots and base detection in Stage 2.

## Tests

Hand-made candle series for: pivot confirmation delay (a pivot is absent until `side` bars have closed), the plateau tie rule, equivalence of `swingLevelList` before and after the refactor; trend UP/DOWN/RANGE/null; each of BOS up/down and CHoCH up/down on closes (a wick alone does not fire), fire-once per pivot; weekly aggregation incl. a Friday holiday and a partial last week; level clustering at the 1.5% boundary, touch counts, nearest support/resistance and ATH; `structureHistory` rows equal `structureForInstrument` on truncated input (no lookahead); a memory-repo round trip.

## Out of scope

Alerts, screeners, a Structure Score, changing Watchlist or Portfolio auto levels, chart overlays, intraday data.

## Assumptions to check on review

1. Trend is `null` rather than RANGE when there are fewer than two confirmed highs or lows.
2. Levels use both swing highs and swing lows for both sides (a broken resistance can become support).
3. The newest weekly bar may be partial; it can trigger an event but not be a pivot.
4. INDIAVIX is excluded.
